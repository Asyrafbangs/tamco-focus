import 'server-only';

import { createGroqProvider } from '@/server/ai/providers/groq';
import { createOpenAiProvider } from '@/server/ai/providers/openai';
import type { AiProvider } from '@/server/ai/providers/types';
import { aiConfig, type AiConfig } from '@/server/ai/config';

/**
 * Which provider is running the assistant.
 *
 * Two, as of v297, and the claim the interface made has now been tested:
 * adding OpenAI was a case in this switch and a file beside `groq.ts`. The
 * investigation loop, the tools, the prompt, the budget and the stored
 * conversations were not touched.
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
    case 'openai':
      return createOpenAiProvider({
        apiKey: config.apiKey,
        model: config.model,
        tier: config.tier,
        organization: config.organization,
        project: config.project,
      });
    default:
      return null;
  }
}

export type { AiProvider } from '@/server/ai/providers/types';
