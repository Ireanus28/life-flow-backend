import { z } from "zod";
import type {
  AIProvider,
  AIResponse,
  ChatMessage,
  ExtractedMemory,
  ExtractedReminder,
  ExtractedTask,
} from "./provider.js";

// Dates are validated loosely (any string) and parsed leniently below rather
// than with zod's strict `.datetime()` — models don't reliably emit exact
// RFC3339/Z-suffixed timestamps, and a single malformed date shouldn't fail
// the entire response.
const extractedTaskSchema = z.object({
  title: z.string().min(1),
  dueDate: z.string().nullable().optional(),
  priority: z.enum(["LOW", "MEDIUM", "HIGH", "URGENT"]).nullable().optional(),
});

const extractedReminderSchema = z.object({
  title: z.string().min(1),
  remindAt: z.string(),
});

const extractedMemorySchema = z.object({
  content: z.string().min(1),
  category: z.enum(["PREFERENCE", "FACT", "RELATIONSHIP", "CONTEXT"]),
  confidence: z.number().min(0).max(1).optional(),
});

const modelResponseSchema = z.object({
  reply: z.string().min(1),
  tasks: z.array(extractedTaskSchema).optional().default([]),
  reminders: z.array(extractedReminderSchema).optional().default([]),
  memories: z.array(extractedMemorySchema).optional().default([]),
});

const SYSTEM_PROMPT = `You are LifeFlow, an AI-powered personal operating system that manages the user's tasks, reminders, and long-term memory through natural conversation.

The current date/time is {{NOW}} (ISO 8601, UTC).

Reply ONLY with a single JSON object (no markdown fences, no commentary outside the JSON) matching exactly this shape:
{
  "reply": string,                 // your natural-language reply to the user, shown in the chat
  "tasks": [{ "title": string, "dueDate": string | null, "priority": "LOW"|"MEDIUM"|"HIGH"|"URGENT" | null }],
  "reminders": [{ "title": string, "remindAt": string }],  // remindAt is a required ISO 8601 datetime
  "memories": [{ "content": string, "category": "PREFERENCE"|"FACT"|"RELATIONSHIP"|"CONTEXT", "confidence": number }]
}

Rules:
- Only populate "tasks" when the user is clearly asking to track a to-do/action item.
- Only populate "reminders" when the user asks to be reminded/notified at a specific or inferable time — resolve relative times ("tomorrow", "tonight", "at 5pm") against the current date/time above and always emit a full ISO 8601 datetime.
- Only populate "memories" when the user shares a durable fact, preference, or relationship worth remembering long-term (not one-off chit-chat).
- Leave any array empty ([]) when nothing qualifies — do not invent entries.
- Keep "reply" concise, warm, and specific to what was created (or just conversational if nothing was created).`;

type ChatCompletionMessage = { role: "system" | "user" | "assistant"; content: string };

/**
 * QwenCloud (Alibaba DashScope, OpenAI-compatible mode) backed provider.
 * Activated by src/lib/ai/index.ts once QWEN_API_KEY is set — see that file
 * for the provider-selection logic. No other code depends on this file
 * directly; everything talks to the AIProvider interface.
 */
export class QwenCloudProvider implements AIProvider {
  name = "qwen";

  private baseUrl: string;
  private apiKey: string;
  private chatModel: string;
  private embeddingModel: string;

  constructor() {
    this.baseUrl = (process.env.QWEN_BASE_URL ?? "https://dashscope-intl.aliyuncs.com/compatible-mode/v1").replace(/\/+$/, "");
    this.apiKey = process.env.QWEN_API_KEY ?? "";
    this.chatModel = process.env.QWEN_CHAT_MODEL ?? "qwen-plus";
    this.embeddingModel = process.env.QWEN_EMBEDDING_MODEL ?? "text-embedding-v3";
  }

  async chat(messages: ChatMessage[]): Promise<AIResponse> {
    const chatMessages: ChatCompletionMessage[] = [
      { role: "system", content: SYSTEM_PROMPT.replace("{{NOW}}", new Date().toISOString()) },
      ...messages.map((m) => ({ role: m.role, content: m.content })),
    ];

    try {
      const res = await fetch(`${this.baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({
          model: this.chatModel,
          messages: chatMessages,
          response_format: { type: "json_object" },
          temperature: 0.4,
        }),
      });

      if (!res.ok) {
        console.error(`QwenCloud chat request failed: ${res.status} ${await res.text()}`);
        return this.fallbackResponse();
      }

      const data = (await res.json()) as any;
      const raw = data?.choices?.[0]?.message?.content;
      if (typeof raw !== "string") return this.fallbackResponse();

      const parsed = modelResponseSchema.safeParse(JSON.parse(raw));
      if (!parsed.success) {
        console.error("QwenCloud response failed schema validation:", parsed.error.flatten());
        return this.fallbackResponse();
      }

      const tasks: ExtractedTask[] = parsed.data.tasks.map((t) => {
        const dueDate = t.dueDate ? new Date(t.dueDate) : undefined;
        return {
          title: t.title,
          // An unparseable due date shouldn't drop the task — just create it without one.
          dueDate: dueDate && !isNaN(dueDate.getTime()) ? dueDate : undefined,
          priority: t.priority ?? undefined,
        };
      });
      const reminders: ExtractedReminder[] = parsed.data.reminders
        .map((r) => ({ title: r.title, remindAt: new Date(r.remindAt) }))
        // remindAt is required, so an unparseable one means dropping just this reminder.
        .filter((r): r is ExtractedReminder => !isNaN(r.remindAt.getTime()));
      const memories: ExtractedMemory[] = parsed.data.memories.map((m) => ({
        content: m.content,
        category: m.category,
        confidence: m.confidence ?? 0.8,
      }));

      return { reply: parsed.data.reply, tasks, reminders, memories };
    } catch (err) {
      console.error("QwenCloud chat request threw:", err);
      return this.fallbackResponse();
    }
  }

  async embed(text: string): Promise<number[]> {
    try {
      const res = await fetch(`${this.baseUrl}/embeddings`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({ model: this.embeddingModel, input: text }),
      });

      if (!res.ok) {
        console.error(`QwenCloud embeddings request failed: ${res.status} ${await res.text()}`);
        return [];
      }

      const data = (await res.json()) as any;
      const embedding = data?.data?.[0]?.embedding;
      return Array.isArray(embedding) ? embedding : [];
    } catch (err) {
      console.error("QwenCloud embeddings request threw:", err);
      return [];
    }
  }

  private fallbackResponse(): AIResponse {
    return {
      reply: "I'm having trouble reaching the AI service right now — please try again in a moment.",
      tasks: [],
      reminders: [],
      memories: [],
    };
  }
}
