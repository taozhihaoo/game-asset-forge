import type { UnderstandInvocation, VisionProvider } from '../types.js';

/**
 * Mock provider (V3 Feature 7): deterministic, zero-network. Used by tests
 * and CI — never calls out. The returned asset type varies with the source
 * name hash so reports stay interesting while remaining reproducible.
 */

function nameHash(name: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < name.length; i++) {
    hash ^= name.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

const MOCK_TYPES = ['character', 'item', 'environment'] as const;

export class MockVisionProvider implements VisionProvider {
  readonly id = 'mock';
  readonly model = 'mock-1';

  /** Number of times understand() was invoked — tests assert cache behavior
   *  by asserting this counter stops growing on cache hits. */
  calls = 0;

  async understand(invocation: UnderstandInvocation): Promise<unknown> {
    this.calls += 1;
    const type = MOCK_TYPES[nameHash(invocation.name) % MOCK_TYPES.length];
    return {
      assetType: type,
      category: type === 'character' ? 'humanoid' : type,
      description: `mock understanding of ${invocation.name}`,
      confidence: 0.5,
    };
  }
}

/**
 * Scripted provider for tests: returns canned responses in order (or the
 * same response repeatedly), and can simulate provider failures.
 */
export class ScriptedVisionProvider implements VisionProvider {
  readonly id: string;
  readonly model: string;
  calls = 0;
  private index = 0;

  constructor(
    private readonly responses: readonly { value?: unknown; error?: Error }[],
    options: { id?: string; model?: string } = {},
  ) {
    this.id = options.id ?? 'scripted';
    this.model = options.model ?? 'scripted-1';
  }

  async understand(): Promise<unknown> {
    this.calls += 1;
    const response = this.responses[Math.min(this.index, this.responses.length - 1)];
    this.index += 1;
    if (response.error !== undefined) throw response.error;
    return response.value;
  }
}
