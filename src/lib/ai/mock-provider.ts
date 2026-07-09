import type {
  AIProvider,
  AIResponse,
  ChatMessage,
  ExtractedMemory,
  ExtractedReminder,
  ExtractedTask,
} from "./provider.js";

function nextOccurrenceOf(hour: number, minute = 0, dayOffset = 0): Date {
  const d = new Date();
  d.setDate(d.getDate() + dayOffset);
  d.setHours(hour, minute, 0, 0);
  if (dayOffset === 0 && d.getTime() < Date.now()) d.setDate(d.getDate() + 1);
  return d;
}

function parseRoughDate(text: string): Date {
  const lower = text.toLowerCase();
  if (lower.includes("tomorrow")) return nextOccurrenceOf(9, 0, 1);
  if (lower.includes("tonight")) return nextOccurrenceOf(19, 0, 0);
  const at = lower.match(/\bat (\d{1,2})(?::(\d{2}))?\s*(am|pm)?/);
  if (at) {
    let hour = parseInt(at[1], 10);
    const minute = at[2] ? parseInt(at[2], 10) : 0;
    if (at[3] === "pm" && hour < 12) hour += 12;
    if (at[3] === "am" && hour === 12) hour = 0;
    return nextOccurrenceOf(hour, minute, 0);
  }
  return nextOccurrenceOf(9, 0, 1);
}

function extractTasks(text: string): ExtractedTask[] {
  const lower = text.toLowerCase();
  const taskPatterns = [
    /(?:add (?:a )?task(?: to)?|i need to|todo:?|don't forget to)\s+(.+)/i,
  ];
  for (const pattern of taskPatterns) {
    const match = text.match(pattern);
    if (match?.[1]) {
      const title = match[1].replace(/[.!]+$/, "").trim();
      const priority = /urgent|asap|critical/.test(lower) ? "HIGH" : "MEDIUM";
      const hasDate = /tomorrow|tonight|\bat \d/.test(lower);
      return [
        {
          title: title.charAt(0).toUpperCase() + title.slice(1),
          priority,
          dueDate: hasDate ? parseRoughDate(text) : undefined,
        },
      ];
    }
  }
  return [];
}

function extractReminders(text: string): ExtractedReminder[] {
  const match = text.match(/remind me (?:to |about )?(.+)/i);
  if (!match?.[1]) return [];
  const title = match[1].replace(/[.!]+$/, "").trim();
  return [
    {
      title: title.charAt(0).toUpperCase() + title.slice(1),
      remindAt: parseRoughDate(text),
    },
  ];
}

function extractMemories(text: string): ExtractedMemory[] {
  const patterns: Array<{ re: RegExp; category: ExtractedMemory["category"] }> = [
    { re: /\bi (?:really )?(?:like|love|enjoy|prefer) (.+)/i, category: "PREFERENCE" },
    { re: /\bi (?:am|work as|work at) (.+)/i, category: "FACT" },
    { re: /\bmy (wife|husband|partner|son|daughter|kid|mom|dad|manager|boss) (.+)/i, category: "RELATIONSHIP" },
  ];
  const memories: ExtractedMemory[] = [];
  for (const { re, category } of patterns) {
    const match = text.match(re);
    if (match) {
      memories.push({
        content: match[0].replace(/[.!]+$/, "").trim(),
        category,
        confidence: 0.7,
      });
    }
  }
  return memories;
}

/**
 * Deterministic, offline stand-in for a real LLM provider. Good enough to
 * exercise the full chat -> task/reminder/memory pipeline without an API key.
 */
export class MockAIProvider implements AIProvider {
  name = "mock";

  async chat(messages: ChatMessage[]): Promise<AIResponse> {
    const last = [...messages].reverse().find((m) => m.role === "user");
    const text = last?.content ?? "";

    const tasks = extractTasks(text);
    const reminders = extractReminders(text);
    const memories = extractMemories(text);

    let reply: string;
    if (tasks.length) {
      reply = `Added "${tasks[0].title}" to your tasks${
        tasks[0].dueDate ? ` for ${tasks[0].dueDate.toLocaleString()}` : ""
      }.`;
    } else if (reminders.length) {
      reply = `I'll remind you to "${reminders[0].title}" on ${reminders[0].remindAt.toLocaleString()}.`;
    } else if (memories.length) {
      reply = `Got it, I'll remember that: ${memories[0].content}.`;
    } else if (text.trim()) {
      reply =
        "I hear you. I'm running in offline demo mode right now, so I can create tasks (\"add task ...\"), reminders (\"remind me to ...\"), and remember facts about you (\"I like ...\"), but general conversation is limited until a real AI provider is connected.";
    } else {
      reply = "How can I help you stay on top of things today?";
    }

    return { reply, tasks, reminders, memories };
  }

  async chatStream(messages: ChatMessage[], onToken: (token: string) => void): Promise<AIResponse> {
    const result = await this.chat(messages);
    // No real token stream to relay in offline mode — split on word boundaries
    // and drip-feed it so the UI's streaming path still has something non-trivial
    // to exercise locally without a QWEN_API_KEY.
    const words = result.reply.split(/(?<=\s)/);
    for (const word of words) {
      await new Promise((resolve) => setTimeout(resolve, 15));
      onToken(word);
    }
    return result;
  }

  async embed(text: string): Promise<number[]> {
    // Deterministic pseudo-embedding (hashed bag-of-chars) purely so semantic
    // search code paths have something non-trivial to operate on in dev.
    const dims = 32;
    const vector = new Array(dims).fill(0);
    for (let i = 0; i < text.length; i++) {
      vector[i % dims] += text.charCodeAt(i) / 255;
    }
    const norm = Math.sqrt(vector.reduce((s, v) => s + v * v, 0)) || 1;
    return vector.map((v) => v / norm);
  }
}
