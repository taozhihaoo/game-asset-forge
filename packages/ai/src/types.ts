import type { RasterImage } from '@gameasset-forge/core';

/**
 * AI-assisted asset understanding (V3).
 *
 * Charter invariants (amendments C2–C6):
 * - lives OUTSIDE core; core's zero-network lint ban is untouched;
 * - AI results are advisory sidecar artifacts — they never enter the
 *   deterministic pipeline outputs;
 * - providers are injectable; tests and CI only ever use the mock;
 * - cloud providers upload user assets — callers must surface the privacy
 *   notice before enabling them.
 */

/** Deterministic asset types (also the rig-template selectors for V4+). */
export const ASSET_TYPES = [
  'character',
  'monster',
  'item',
  'weapon',
  'environment',
  'ui',
  'unknown',
] as const;
export type AssetType = (typeof ASSET_TYPES)[number];

export interface UnderstandingResult {
  readonly assetType: AssetType;
  /** Free-form subcategory, e.g. 'humanoid' | 'slime' | 'sword'. */
  readonly category: string;
  readonly description: string;
  /** 0..1 self-reported confidence from the provider. */
  readonly confidence: number;
}

export interface UnderstandInvocation {
  readonly image: RasterImage;
  /** '/'-normalized source name, for providers that use it (e.g. mock). */
  readonly name: string;
  /** Fully rendered prompt text (prompts.ts). */
  readonly prompt: string;
  readonly promptVersion: string;
}

export interface VisionProvider {
  /** 'mock' | 'openai' | 'local' — stable id used in reports and cache keys. */
  readonly id: string;
  /** Model identifier for reports and cache keys ('mock' for the mock). */
  readonly model: string;
  /** Returns the provider's raw JSON-shaped response; schema validation is
   *  a separate layer (schemas/understanding.ts). */
  understand(invocation: UnderstandInvocation): Promise<unknown>;
}

export class AiError extends Error {
  readonly code: string;

  constructor(code: string, message: string, cause?: unknown) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = new.target.name;
    this.code = code;
  }
}

/** The provider could not be reached or returned a transport-level failure. */
export class AiProviderError extends AiError {
  constructor(providerId: string, message: string, cause?: unknown) {
    super('AI_PROVIDER_FAILED', `${providerId}: ${message}`, cause);
  }
}

/** The provider responded, but the payload failed schema validation. */
export class AiResponseError extends AiError {
  constructor(problems: readonly string[]) {
    super('AI_RESPONSE_INVALID', `AI response failed validation: ${problems.join('; ')}`);
  }
}

/** AI features are disabled by configuration (charter: off by default). */
export class AiDisabledError extends AiError {
  constructor(message = 'AI assistance is disabled (enable it in ai.config.json)') {
    super('AI_DISABLED', message);
  }
}
