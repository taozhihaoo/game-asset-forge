import type { RasterImage } from '@gameasset-forge/core';
import { getPromptText, PROMPT_VERSION } from './prompts.js';
import { validateUnderstanding } from './schemas/understanding.js';
import type { UnderstandingResult, VisionProvider } from './types.js';

/**
 * understand(): prompt → provider → schema-validated result (V3 Feature 1).
 * The provider returns raw unknown JSON; this layer owns the trust boundary.
 */

export interface UnderstandInput {
  readonly image: RasterImage;
  /** '/'-normalized source name (providers may use it; the prompt says pixels win). */
  readonly name: string;
}

export interface UnderstandOptions {
  /** Overrides the prompt version reported to the provider and used in the
   *  cache key. There is a single versioned template today; the value is
   *  still propagated so reports and cache keys never disagree. */
  readonly promptVersion?: string;
}

export async function understandAsset(
  input: UnderstandInput,
  provider: VisionProvider,
  options: UnderstandOptions = {},
): Promise<UnderstandingResult> {
  const promptVersion = options.promptVersion ?? PROMPT_VERSION;
  const raw = await provider.understand({
    image: input.image,
    name: input.name,
    prompt: getPromptText('understand'),
    promptVersion,
  });
  return validateUnderstanding(raw);
}

export { PROMPT_VERSION };
