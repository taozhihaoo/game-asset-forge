import type { UnderstandingResult } from './types.js';

/**
 * Deterministic suggestion derivation (V3 Features 4/6): AI understanding
 * results are converted into concrete, human-reviewable suggestions.
 * Pure functions — no network, no randomness.
 */

export interface NamedResult {
  readonly name: string;
  readonly result: UnderstandingResult;
}

export interface NamingSuggestion {
  readonly source: string;
  readonly suggestedName: string;
  readonly reason: string;
}

export interface PivotSuggestion {
  readonly source: string;
  /** Normalized, relative to the trimmed (content) rect. */
  readonly pivot: { readonly x: number; readonly y: number };
  readonly reason: string;
}

export interface AnimationSuggestion {
  readonly source: string;
  readonly recommended: readonly string[];
  readonly reason: string;
}

export interface SuggestionSet {
  readonly naming: readonly NamingSuggestion[];
  readonly pivot: readonly PivotSuggestion[];
  readonly animation: readonly AnimationSuggestion[];
}

const FEET = { x: 0.5, y: 1.0 };
const TYPES_THAT_ANCHOR_AT_FEET: readonly string[] = ['character', 'monster'];

const ANIMATION_TEMPLATES: readonly {
  readonly match: readonly string[];
  readonly moves: readonly string[];
}[] = [
  { match: ['humanoid'], moves: ['idle', 'walk', 'attack'] },
  { match: ['monster', 'animal', 'slime'], moves: ['idle', 'run', 'bite'] },
  { match: ['item', 'weapon', 'sword'], moves: ['rotate', 'float'] },
];

function sanitize(value: string): string {
  return (
    value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '') || 'asset'
  );
}

export function deriveSuggestions(results: readonly NamedResult[]): SuggestionSet {
  const naming: NamingSuggestion[] = [];
  const pivot: PivotSuggestion[] = [];
  const animation: AnimationSuggestion[] = [];
  const usedNames = new Map<string, number>();

  for (const { name, result } of results) {
    if (result.assetType === 'unknown') continue;

    // naming: '<type>_<category>_<NN>.png' with per (type_category) counters
    const categoryPart =
      result.category !== '' && result.category !== 'unknown'
        ? `_${sanitize(result.category)}`
        : '';
    const base = `${sanitize(result.assetType)}${categoryPart}`;
    const occurrence = (usedNames.get(base) ?? 0) + 1;
    usedNames.set(base, occurrence);
    const suggestedName = `${base}_${String(occurrence).padStart(2, '0')}.png`;
    if (suggestedName !== name) {
      naming.push({
        source: name,
        suggestedName,
        reason:
          `understood as ${result.assetType}${categoryPart === '' ? '' : ` (${result.category})`}` +
          ` (confidence ${result.confidence})`,
      });
    }

    // pivot: feet-anchored types get the bottom-center suggestion
    if (TYPES_THAT_ANCHOR_AT_FEET.includes(result.assetType)) {
      pivot.push({
        source: name,
        pivot: { ...FEET },
        reason: `${result.assetType} sprites typically anchor at the feet`,
      });
    }

    // animation: template recommendation by category, falling back to type
    const template = ANIMATION_TEMPLATES.find((entry) =>
      entry.match.includes(result.category.toLowerCase()),
    );
    const moves =
      template?.moves ??
      (result.assetType === 'character' || result.assetType === 'monster'
        ? ['idle', 'move']
        : result.assetType === 'item' || result.assetType === 'weapon'
          ? ['rotate', 'float']
          : result.assetType === 'environment' || result.assetType === 'ui'
            ? []
            : ['idle']);
    if (moves.length > 0) {
      animation.push({
        source: name,
        recommended: moves,
        reason: `recommended templates for ${result.assetType}/${result.category}`,
      });
    }
  }

  return { naming, pivot, animation };
}
