import { Router, type Response } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { getAIProvider } from "../lib/ai/index.js";
import { requireAuth } from "../middleware/auth.js";

export const chatRouter = Router();
chatRouter.use(requireAuth);

function sseStart(res: Response) {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders();
}

function sseSend(res: Response, event: Record<string, unknown>) {
  res.write(`data: ${JSON.stringify(event)}\n\n`);
}

/**
 * Streams a fresh assistant reply for `conversationId` from the current
 * message history, persists the reply plus any extracted tasks/reminders/
 * memories, and ends the SSE response. Shared by new messages, edits, and
 * regenerations — each just prepares the message table differently before
 * calling this.
 */
async function streamAssistantReply(
  res: Response,
  conversationId: string,
  userId: string,
  startExtra?: Record<string, unknown>
) {
  sseStart(res);
  sseSend(res, { type: "start", conversationId, ...startExtra });

  const [history, memories] = await Promise.all([
    prisma.message.findMany({
      where: { conversationId },
      orderBy: { createdAt: "asc" },
      take: 20,
    }),
    // Extracted memories are otherwise write-only from chat's perspective —
    // stored but never recalled — which is why the model, unprompted, falls
    // back to a generic "I don't retain memory" disclaimer. Feeding them back
    // in as context is what actually makes the memory feature functional.
    prisma.memory.findMany({
      where: { userId },
      orderBy: { confidence: "desc" },
      take: 20,
    }),
  ]);

  const memoryContext = memories.length
    ? [
        {
          role: "system" as const,
          content:
            "Remembered facts about this user from past conversations:\n" +
            memories.map((m) => `- (${m.category}) ${m.content}`).join("\n"),
        },
      ]
    : [];

  const ai = getAIProvider();
  let streamErrored = false;
  const result = await ai
    .chatStream(
      [
        ...memoryContext,
        ...history.map((m) => ({ role: m.role.toLowerCase() as "user" | "assistant" | "system", content: m.content })),
      ],
      (token) => sseSend(res, { type: "token", token })
    )
    .catch((err) => {
      console.error("Streaming chat failed:", err);
      streamErrored = true;
      const reply = "Something went wrong generating a reply. Please try again.";
      sseSend(res, { type: "token", token: reply });
      return { reply, tasks: [], reminders: [], memories: [] };
    });

  const [createdTasks, createdReminders] = await Promise.all([
    Promise.all(
      result.tasks.map((t) =>
        prisma.task.create({
          data: { userId, title: t.title, dueDate: t.dueDate, priority: t.priority ?? "MEDIUM" },
        })
      )
    ),
    Promise.all(
      result.reminders.map((r) =>
        prisma.reminder.create({ data: { userId, title: r.title, remindAt: r.remindAt } })
      )
    ),
  ]);

  if (result.memories.length) {
    await Promise.all(
      result.memories.map(async (m) => {
        const embedding = await ai.embed(m.content);
        return prisma.memory.create({
          data: { userId, content: m.content, category: m.category, confidence: m.confidence, embedding },
        });
      })
    );
  }

  const assistantMessage = await prisma.message.create({
    data: { conversationId, role: "ASSISTANT", content: result.reply },
  });

  await prisma.user.update({
    where: { id: userId },
    data: { messagesUsedThisMonth: { increment: 1 } },
  });

  sseSend(res, {
    type: "done",
    conversationId,
    messageId: assistantMessage.id,
    createdTasks,
    createdReminders,
    error: streamErrored,
  });
  res.end();
}

chatRouter.post("/", async (req, res) => {
  const userId = req.userId!;
  const { message, conversationId } = req.body as { message: string; conversationId?: string };
  if (!message?.trim()) {
    return res.status(400).json({ error: "message is required" });
  }

  const conversation = conversationId
    ? await prisma.conversation.findFirst({ where: { id: conversationId, userId } })
    : await prisma.conversation.create({
        data: { userId, title: message.slice(0, 60) },
      });

  if (!conversation) {
    return res.status(404).json({ error: "Conversation not found" });
  }

  const userMessage = await prisma.message.create({
    data: { conversationId: conversation.id, role: "USER", content: message },
  });

  await streamAssistantReply(res, conversation.id, userId, { userMessageId: userMessage.id });
});

chatRouter.post("/messages/:id/edit", async (req, res) => {
  const userId = req.userId!;
  const { id } = req.params;
  const { content } = req.body as { content: string };
  if (!content?.trim()) return res.status(400).json({ error: "content is required" });

  const message = await prisma.message.findFirst({
    where: { id, conversation: { userId } },
  });
  if (!message || message.role !== "USER") return res.status(404).json({ error: "Not found" });

  await prisma.$transaction([
    prisma.message.update({ where: { id }, data: { content } }),
    prisma.message.deleteMany({
      where: { conversationId: message.conversationId, createdAt: { gt: message.createdAt } },
    }),
  ]);

  await streamAssistantReply(res, message.conversationId, userId);
});

chatRouter.post("/messages/:id/regenerate", async (req, res) => {
  const userId = req.userId!;
  const { id } = req.params;

  const message = await prisma.message.findFirst({
    where: { id, conversation: { userId } },
  });
  if (!message || message.role !== "ASSISTANT") return res.status(404).json({ error: "Not found" });

  await prisma.message.deleteMany({
    where: { conversationId: message.conversationId, createdAt: { gte: message.createdAt } },
  });

  await streamAssistantReply(res, message.conversationId, userId);
});

chatRouter.get("/", async (req, res) => {
  const userId = req.userId!;
  const conversationId = typeof req.query.conversationId === "string" ? req.query.conversationId : undefined;

  if (!conversationId) {
    // Includes archived conversations — the frontend buckets everything into
    // Pinned/Recent/Older/Archived sections itself rather than needing a
    // separate endpoint per section.
    const conversations = await prisma.conversation.findMany({
      where: { userId },
      orderBy: [{ pinned: "desc" }, { updatedAt: "desc" }],
    });
    return res.json({ conversations });
  }

  const take = Math.min(Math.max(Number(req.query.take) || 30, 1), 100);
  const before = typeof req.query.before === "string" ? req.query.before : undefined;
  let cursorDate: Date | undefined;
  if (before) {
    const cursorMessage = await prisma.message.findUnique({ where: { id: before } });
    cursorDate = cursorMessage?.createdAt;
  }

  // Fetch one extra row to distinguish "exactly `take` rows left" from
  // "there's more after this page" instead of assuming a full page implies more.
  const page = await prisma.message.findMany({
    where: { conversationId, conversation: { userId }, ...(cursorDate ? { createdAt: { lt: cursorDate } } : {}) },
    orderBy: { createdAt: "desc" },
    take: take + 1,
  });
  const hasMore = page.length > take;
  const messages = (hasMore ? page.slice(0, take) : page).reverse();

  res.json({ messages, hasMore });
});

const updateConversationSchema = z.object({
  title: z.string().trim().min(1).max(100).optional(),
  pinned: z.boolean().optional(),
  archived: z.boolean().optional(),
});

chatRouter.patch("/conversations/:id", async (req, res) => {
  const { id } = req.params;
  const existing = await prisma.conversation.findFirst({ where: { id, userId: req.userId! } });
  if (!existing) return res.status(404).json({ error: "Not found" });

  const parsed = updateConversationSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const conversation = await prisma.conversation.update({ where: { id }, data: parsed.data });
  res.json({ conversation });
});

chatRouter.delete("/conversations/:id", async (req, res) => {
  const { id } = req.params;
  const existing = await prisma.conversation.findFirst({ where: { id, userId: req.userId! } });
  if (!existing) return res.status(404).json({ error: "Not found" });

  await prisma.conversation.delete({ where: { id } });
  res.json({ ok: true });
});
