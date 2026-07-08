export type ChatRole = "user" | "assistant" | "system";

export interface ChatMessage {
  role: ChatRole;
  content: string;
}

export interface ExtractedTask {
  title: string;
  dueDate?: Date;
  priority?: "LOW" | "MEDIUM" | "HIGH" | "URGENT";
}

export interface ExtractedReminder {
  title: string;
  remindAt: Date;
}

export interface ExtractedMemory {
  content: string;
  category: "PREFERENCE" | "FACT" | "RELATIONSHIP" | "CONTEXT";
  confidence: number;
}

export interface AIResponse {
  reply: string;
  tasks: ExtractedTask[];
  reminders: ExtractedReminder[];
  memories: ExtractedMemory[];
}

/**
 * Provider-agnostic interface so the app can swap QwenCloud, OpenAI, or a mock
 * without touching call sites — no single point of AI-vendor failure.
 */
export interface AIProvider {
  name: string;
  chat(messages: ChatMessage[]): Promise<AIResponse>;
  embed(text: string): Promise<number[]>;
}
