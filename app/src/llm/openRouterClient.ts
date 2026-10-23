// src/llm/openRouterClient.ts
// OpenRouter API client — uses the OpenAI-compatible endpoint
// Free tier models (no cost, just need an OpenRouter account):
//   - meta-llama/llama-3.3-70b-instruct:free  ← primary (great at code)
//   - qwen/qwen-2.5-72b-instruct:free          ← fallback
//   - openrouter/auto                           ← let OpenRouter pick a free one
//
// Get your free API key at: https://openrouter.ai/settings/keys

import OpenAI from 'openai';
import { config } from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

// Auto-load .env from the app/ directory
const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: join(__dirname, '..', '..', '.env') });


const API_KEY = process.env.OPENROUTER_API_KEY ?? '';

if (!API_KEY) {
  console.warn(
    '[openrouter] Warning: OPENROUTER_API_KEY not set.\n' +
    '  Get a free key at https://openrouter.ai/settings/keys\n' +
    '  Then set: $env:OPENROUTER_API_KEY="sk-or-v1-..."'
  );
}

// OpenRouter is 100% OpenAI API-compatible — just swap the base URL
const client = new OpenAI({
  baseURL: 'https://openrouter.ai/api/v1',
  apiKey: API_KEY,
  defaultHeaders: {
    // Optional but recommended by OpenRouter docs
    'HTTP-Referer': 'https://github.com/tech-news-agent',
    'X-Title': 'TechNewsAgent Code Mode Demo',
  },
});

// Active free tier models on OpenRouter
export const FREE_MODELS = {
  primary: 'openrouter/free',                        // Dynamic auto-router to current best active free model
  fast: 'nvidia/nemotron-3.5-lightning:free',       // Fast reasoning fallback
  codeFocused: 'cohere/north-mini-code:free',        // Specialized fallback
} as const;

export const FALLBACK_CHAIN = [
  'openrouter/free',
  'nvidia/nemotron-3.5-lightning:free',
  'cohere/north-mini-code:free',
];

export type ModelKey = keyof typeof FREE_MODELS;

export interface GenerateOptions {
  temperature?: number;      // 0 = deterministic (good for code), 1 = creative
  maxTokens?: number;
  model?: string;            // override model
}

export interface GenerateResult {
  text: string;
  model: string;             // which model actually responded
  promptTokens: number;
  outputTokens: number;
  totalTokens: number;
}

/**
 * Generate text via OpenRouter free tier with automatic fallback.
 * Returns the response text AND token usage for the Direct vs Code Mode comparison.
 */
export async function generate(
  systemPrompt: string,
  userMessage: string,
  options: GenerateOptions = {}
): Promise<GenerateResult> {
  const modelsToTry = options.model ? [options.model] : FALLBACK_CHAIN;
  let lastError: unknown = null;

  for (const model of modelsToTry) {
    try {
      const response = await client.chat.completions.create({
        model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userMessage },
        ],
        temperature: options.temperature ?? 0.2,   // low temp = consistent code output
        max_tokens: options.maxTokens ?? 4096,
      });

      const choice = response.choices[0];
      const usage = response.usage;

      return {
        text: choice.message.content ?? '',
        model: response.model ?? model,
        promptTokens: usage?.prompt_tokens ?? 0,
        outputTokens: usage?.completion_tokens ?? 0,
        totalTokens: usage?.total_tokens ?? 0,
      };
    } catch (err: any) {
      lastError = err;
      console.warn(`[openrouter] Model ${model} failed (${err?.message ?? err}). Trying next in chain...`);
    }
  }

  throw new Error(`All free models failed. Last error: ${lastError instanceof Error ? lastError.message : String(lastError)}`);
}

/**
 * Estimate token count for a string.
 * OpenRouter doesn't expose a dedicated count endpoint, so we use a rough
 * heuristic: ~1 token per 4 characters (close enough for comparison purposes).
 */
export function countTokensEstimate(text: string): number {
  return Math.ceil(text.length / 4);
}

/**
 * Alias for the estimate function — keeps the same interface as the old geminiClient.
 */
export async function countTokens(text: string): Promise<number> {
  return countTokensEstimate(text);
}

/**
 * Quick health-check: list available free models from OpenRouter.
 */
export async function listFreeModels(): Promise<Array<{ id: string; name: string }>> {
  const models = await client.models.list();
  return models.data
    .filter((m) => m.id.endsWith(':free'))
    .map((m) => ({ id: m.id, name: m.id }))
    .sort((a, b) => a.id.localeCompare(b.id));
}
