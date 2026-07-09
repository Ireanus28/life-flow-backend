import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { getAIProvider } from "../lib/ai/index.js";
import { requireAuth } from "../middleware/auth.js";

export const chatRouter = Router();
chatRouter.use(requireAuth);

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

  await prisma.message.create({
    data: { conversationId: conversation.id, role: "USER", content: message },
  });

  const history = await prisma.message.findMany({
    where: { conversationId: conversation.id },
    orderBy: { createdAt: "asc" },
    take: 20,
  });

  const ai = getAIProvider();
  const result = await ai.chat(
    history.map((m) => ({ role: m.role.toLowerCase() as "user" | "assistant" | "system", content: m.content }))
  );

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

  await prisma.message.create({
    data: { conversationId: conversation.id, role: "ASSISTANT", content: result.reply },
  });

  await prisma.user.update({
    where: { id: userId },
    data: { messagesUsedThisMonth: { increment: 1 } },
  });

  res.json({
    conversationId: conversation.id,
    reply: result.reply,
    createdTasks,
    createdReminders,
  });
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

  const messages = await prisma.message.findMany({
    where: { conversationId, conversation: { userId } },
    orderBy: { createdAt: "asc" },
  });
  res.json({ messages });
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
