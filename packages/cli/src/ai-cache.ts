import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { resolveAiConfig, type AiCacheStore, type AiConfig } from '@gameasset-forge/ai';

/**
 * AI configuration + file-backed cache store for the CLI layer (C3: AI
 * config is independent from the pipeline preset; C4: results are cached by
 * imageHash+promptVersion+provider+model so re-runs cost zero API calls).
 */

export function loadAiConfig(
  configFile: string | undefined,
  env: (name: string) => string | undefined,
): AiConfig {
  let raw: unknown = {};
  if (configFile !== undefined) {
    if (!existsSync(configFile)) {
      throw new Error(`ai config not found: ${configFile}`);
    }
    raw = JSON.parse(readFileSync(configFile, 'utf8'));
  }
  return resolveAiConfig(raw as Partial<AiConfig>, env);
}

/** JSON-file-backed cache store (deterministic key → result map on disk). */
export class JsonFileCacheStore implements AiCacheStore {
  private readonly entries = new Map<string, unknown>();
  private dirty = false;

  constructor(private readonly file: string) {
    if (existsSync(file)) {
      const parsed: unknown = JSON.parse(readFileSync(file, 'utf8'));
      if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) {
        for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
          this.entries.set(key, value);
        }
      }
    }
  }

  get(key: string): unknown | null {
    const value = this.entries.get(key);
    return value === undefined ? null : value;
  }

  set(key: string, value: unknown): void {
    this.entries.set(key, value);
    this.dirty = true;
    this.flush();
  }

  flush(): void {
    if (!this.dirty) return;
    const file = this.file;
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, `${JSON.stringify(Object.fromEntries(this.entries), null, 2)}\n`, 'utf8');
    this.dirty = false;
  }
}
