import type { AIProvider } from "./provider.js";
import { MockAIProvider } from "./mock-provider.js";
import { QwenCloudProvider } from "./qwen-provider.js";

let provider: AIProvider | null = null;

/**
 * Single call site for the rest of the app. Returns a QwenCloud-backed
 * provider once QWEN_API_KEY is set, otherwise falls back to the offline
 * mock provider. No other code depends on which provider is active.
 */
export function getAIProvider(): AIProvider {
  if (provider) return provider;

  provider = process.env.QWEN_API_KEY ? new QwenCloudProvider() : new MockAIProvider();
  return provider;
}

export type * from "./provider.js";
