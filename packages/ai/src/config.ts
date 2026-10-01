import { AiDisabledError } from './types.js';
import type { VisionProvider } from './types.js';
import { LocalVisionProvider } from './providers/local.js';
import { MockVisionProvider } from './providers/mock.js';
import { OpenAiVisionProvider } from './providers/openai.js';
import { PROMPT_VERSION } from './prompts.js';

/**
 * AI configuration (amendment C3): lives OUTSIDE the pipeline preset —
 * an ai.config.json file plus environment overrides. "same preset = same
 * output" is untouched by AI settings because AI results are sidecar
 * artifacts. AI is disabled by default (charter: off by default, avoid
 * accidental API spend).
 */

export type AiProviderId = 'mock' | 'openai' | 'local';

export interface AiConfig {
  /** Default false — the charter requires no accidental API spend. The
   *  built-in mock provider is always allowed regardless of this flag. */
  readonly enabled: boolean;
  readonly provider: AiProviderId;
  readonly model?: string;
  /** NAME of the environment variable holding the API key (never the key). */
  readonly apiKeyEnv?: string;
  readonly promptVersion?: string;
}

export const DEFAULT_AI_CONFIG: AiConfig = {
  enabled: false,
  provider: 'mock',
};

export type GetEnv = (name: string) => string | undefined;

export const nodeGetEnv: GetEnv = (name) =>
  typeof process === 'undefined' ? undefined : process.env?.[name];

/** Merges a raw (partially specified) config with environment overrides. */
export function resolveAiConfig(
  raw: Partial<AiConfig> | undefined,
  env: GetEnv = nodeGetEnv,
): AiConfig {
  const base: AiConfig = {
    enabled: raw?.enabled ?? DEFAULT_AI_CONFIG.enabled,
    provider: raw?.provider ?? DEFAULT_AI_CONFIG.provider,
    model: raw?.model ?? env('AI_MODEL') ?? undefined,
    apiKeyEnv: raw?.apiKeyEnv ?? 'OPENAI_API_KEY',
    promptVersion: raw?.promptVersion ?? PROMPT_VERSION,
  };
  const envProvider = env('AI_PROVIDER');
  const provider = (
    envProvider === 'mock' || envProvider === 'openai' || envProvider === 'local'
      ? envProvider
      : base.provider
  ) as AiProviderId;
  const envEnabled = env('AI_ENABLED');
  return {
    ...base,
    provider,
    enabled: envEnabled === undefined ? base.enabled : envEnabled === 'true' || envEnabled === '1',
  };
}

/** Builds the configured provider. Throws AiDisabledError for disabled
 *  cloud/local usage; the mock is always allowed (it never leaves the
 *  machine and never costs money). */
export function createProvider(config: AiConfig, env: GetEnv = nodeGetEnv): VisionProvider {
  switch (config.provider) {
    case 'mock':
      return new MockVisionProvider();
    case 'local':
      if (!config.enabled) throw new AiDisabledError();
      return new LocalVisionProvider();
    case 'openai': {
      if (!config.enabled) throw new AiDisabledError();
      const keyName = config.apiKeyEnv ?? 'OPENAI_API_KEY';
      const apiKey = env(keyName);
      if (apiKey === undefined || apiKey === '') {
        throw new AiDisabledError(`API key environment variable ${keyName} is not set`);
      }
      return new OpenAiVisionProvider({
        apiKey,
        model: config.model ?? 'gpt-4o-mini',
      });
    }
  }
}
