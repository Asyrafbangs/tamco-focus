import 'server-only';

import { createGroqProvider } from '@/server/ai/providers/groq';
import type { AiProvider } from '@/server/ai/providers/types';
import { aiConfig, type AiConfig } from '@/server/ai/config';

/**
 * Which provider is running the assistant.
 *
 * One today. The reason this is a function rather than a constant is the
 * reason the interface exists at all: adding Anthropic, or a second Groq
 * model for cheap work, is a case in this switch and a file beside `groq.ts`,
 * not a change to the investigation loop.
 */
export function providerFor(config: AiConfig = aiConfig()): AiProvider | null {
  if (!config.apiKey) return null;
  switch (config.provider) {
    case 'groq':
      return createGroqProvider({
        apiKey: config.apiKey,
        model: config.model,
        tier: config.tier,
      });
    default:
      return null;
  }
}

export type { AiProvider } from '@/server/ai/providers/types';
