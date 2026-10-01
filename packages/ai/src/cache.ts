import { PROMPT_VERSION } from './prompts.js';

/**
 * Result cache (V3 Feature 12 / amendment C4): results are keyed by
 * (image hash, promptVersion, provider, model) so re-running analysis
 * costs zero API calls. Storage is an interface — the CLI provides a
 * JSON-file store, tests use memory.
 */

export interface CacheKeyParts {
  readonly imageHash: string;
  readonly providerId: string;
  readonly model: string;
  readonly promptVersion?: string;
}

export function cacheKey(parts: CacheKeyParts): string {
  const promptVersion = parts.promptVersion ?? PROMPT_VERSION;
  return `${parts.providerId}/${parts.model}/v${promptVersion}/${parts.imageHash}`;
}

export interface AiCacheStore {
  get(key: string): unknown | null;
  set(key: string, value: unknown): void;
}

export class MemoryCacheStore implements AiCacheStore {
  private readonly entries = new Map<string, unknown>();

  get(key: string): unknown | null {
    const value = this.entries.get(key);
    return value === undefined ? null : value;
  }

  set(key: string, value: unknown): void {
    this.entries.set(key, value);
  }

  get size(): number {
    return this.entries.size;
  }
}
