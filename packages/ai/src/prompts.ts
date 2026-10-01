import type { UnderstandInvocation } from './types.js';

/**
 * Versioned prompt templates (V3 Feature 8 — no hardcoded prompts at call
 * sites). Carried as TS constants instead of .md files so the exact same
 * module serves the CLI (Node) and the GUI renderer (browser) — the version
 * constant travels with the template and feeds the cache key (C4).
 */

export const PROMPT_VERSION = '1.0';

export type PromptKind = 'understand';

const TEMPLATES: Record<PromptKind, string> = {
  understand: [
    'You are analyzing a 2D game asset image.',
    'Respond with ONLY a JSON object (no markdown, no prose) shaped exactly like:',
    '{"assetType":"character|monster|item|weapon|environment|ui|unknown",',
    ' "category":"<short subcategory, e.g. humanoid|slime|sword|tree|button>",',
    ' "description":"<one short sentence>",',
    ' "confidence":<number between 0 and 1>}',
    'Judge from the pixels; the filename may be misleading.',
  ].join(' '),
};

export function getPromptText(kind: PromptKind): string {
  return TEMPLATES[kind];
}

export function renderInvocationPrompt(invocation: UnderstandInvocation): string {
  return invocation.prompt;
}
