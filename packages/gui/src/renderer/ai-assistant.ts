import {
  deriveSuggestions,
  MockVisionProvider,
  understandAsset,
  type UnderstandingResult,
  type VisionProvider,
} from '@gameasset-forge/ai';
import type { RasterImage } from '@gameasset-forge/core';

/**
 * AI Assistant page (V3 Feature 11): understanding + suggestions with
 * Apply/Ignore, backed ONLY by the local mock provider in this build —
 * zero data leaves the machine. Cloud providers are CLI-configured
 * (privacy amendment C5: the banner states where data goes before any
 * cloud provider can be enabled). Pure module — no hidden page state;
 * the caller owns and re-renders the entry list.
 */

export interface AiPageSource {
  readonly name: string;
  readonly raster: RasterImage;
  readonly byteSize: number;
}

export function getMockProvider(): VisionProvider {
  return new MockVisionProvider();
}

export interface AiUnderstanding {
  readonly source: string;
  readonly result: UnderstandingResult;
}

export async function runUnderstanding(
  sources: readonly AiPageSource[],
  provider: VisionProvider,
): Promise<readonly AiUnderstanding[]> {
  const out: AiUnderstanding[] = [];
  for (const source of sources) {
    const result = await understandAsset({ image: source.raster, name: source.name }, provider);
    out.push({ source: source.name, result });
  }
  return out;
}

export interface AiSuggestionSet {
  readonly naming: readonly { source: string; suggestedName: string; reason: string }[];
  readonly pivot: readonly { source: string; pivot: { x: number; y: number }; reason: string }[];
  readonly animation: readonly { source: string; recommended: readonly string[]; reason: string }[];
}

export function deriveFrom(results: readonly NamedResultInput[]): AiSuggestionSet {
  return deriveSuggestions(results.map((entry) => ({ name: entry.name, result: entry.result })));
}

export interface NamedResultInput {
  readonly name: string;
  readonly result: UnderstandingResult;
}

export type AiEntryKind = 'naming' | 'pivot' | 'animation';
export type AiEntryStatus = 'open' | 'applied' | 'ignored';

export interface AiEntryState {
  readonly kind: AiEntryKind;
  readonly source: string;
  readonly text: string;
  readonly detail: string;
  readonly status: AiEntryStatus;
}

export function describeSuggestions(suggestions: AiSuggestionSet): AiEntryState[] {
  const out: AiEntryState[] = [];
  for (const suggestion of suggestions.naming) {
    out.push({
      kind: 'naming',
      source: suggestion.source,
      text: `Rename to ${suggestion.suggestedName}`,
      detail: suggestion.reason,
      status: 'open',
    });
  }
  for (const suggestion of suggestions.pivot) {
    out.push({
      kind: 'pivot',
      source: suggestion.source,
      text: `Set pivot to (${suggestion.pivot.x}, ${suggestion.pivot.y})`,
      detail: suggestion.reason,
      status: 'open',
    });
  }
  for (const suggestion of suggestions.animation) {
    out.push({
      kind: 'animation',
      source: suggestion.source,
      text: `Animation templates: ${suggestion.recommended.join(', ')}`,
      detail: suggestion.reason,
      status: 'open',
    });
  }
  return out;
}

export function renderAiResults(
  host: HTMLElement,
  states: readonly AiEntryState[],
  callbacks: { onApply: (index: number) => void; onIgnore: (index: number) => void },
): void {
  host.replaceChildren();
  if (states.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'hint';
    empty.textContent = 'No suggestions — load assets and run Analyze.';
    host.append(empty);
    return;
  }
  const list = document.createElement('ul');
  list.className = 'quality-list';
  states.forEach((entry, index) => {
    const item = document.createElement('li');
    item.className = `quality-asset ai-entry-${entry.status}`;
    const title = document.createElement('div');
    title.className = 'asset-name';
    title.textContent = `${entry.source} — ${entry.text}`;
    const detail = document.createElement('div');
    detail.className = 'asset-meta';
    detail.textContent = entry.detail;
    item.append(title, detail);

    if (entry.status === 'open') {
      const apply = document.createElement('button');
      apply.textContent = 'Apply';
      apply.addEventListener('click', () => callbacks.onApply(index));
      const ignore = document.createElement('button');
      ignore.textContent = 'Ignore';
      ignore.addEventListener('click', () => callbacks.onIgnore(index));
      item.append(apply, ignore);
    } else {
      const status = document.createElement('span');
      status.className = 'asset-meta';
      status.textContent = entry.status;
      item.append(status);
    }
    list.append(item);
  });
  host.append(list);
}
