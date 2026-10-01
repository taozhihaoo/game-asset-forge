import { describe, expect, it } from 'vitest';
import { createRasterImage } from '@gameasset-forge/core';
import {
  LocalVisionProvider as LocalProvider,
  deriveSuggestions,
  getPromptText,
  PROMPT_VERSION,
  understandAsset,
} from '../src/index.js';

/**
 * Additional V3 coverage: prompts, the local provider placeholder,
 * config edge cases, and suggestion derivation edges.
 */

describe('prompts', () => {
  it('pins the prompt version and the JSON output contract', () => {
    expect(PROMPT_VERSION).toBe('1.0');
    const prompt = getPromptText('understand');
    expect(prompt).toContain('assetType');
    expect(prompt).toContain('category');
    expect(prompt).toContain('confidence');
    expect(prompt).toContain('Respond with ONLY a JSON object');
  });
});

describe('local provider placeholder', () => {
  it('always refuses: it is a reserved interface, not a runtime', async () => {
    const provider = new LocalProvider();
    await expect(
      provider.understand({
        image: createRasterImage(1, 1, { hasAlpha: true }),
        name: 'a.png',
        prompt: 'p',
        promptVersion: PROMPT_VERSION,
      }),
    ).rejects.toThrowError(/reserved/);
    expect(provider.id).toBe('local');
  });
});

describe('C6 — AI failure isolation', () => {
  it('the deterministic pipeline is untouched by AI failures', async () => {
    const provider = new LocalProvider();
    const image = createRasterImage(4, 4, { hasAlpha: true });

    let aiFailed = false;
    try {
      await understandAsset({ image, name: 'a.png' }, provider);
    } catch {
      aiFailed = true;
    }
    expect(aiFailed).toBe(true);

    // suggestions derivation never runs on failed understandings
    const set = deriveSuggestions([]);
    expect(set.naming).toEqual([]);
    expect(set.pivot).toEqual([]);
    expect(set.animation).toEqual([]);
  });
});

describe('suggestion derivation edges', () => {
  it('sanitizes categories into filename-safe segments', () => {
    const set = deriveSuggestions([
      {
        name: 'mystery.png',
        result: { assetType: 'item', category: 'Gold! Coin?', description: '', confidence: 0.5 },
      },
    ]);
    expect(set.naming[0].suggestedName).toBe('item_gold_coin_01.png');
  });

  it('dedupes indexes across entries of the same base', () => {
    const set = deriveSuggestions([
      {
        name: 'a.png',
        result: { assetType: 'item', category: 'coin', description: '', confidence: 0.1 },
      },
      {
        name: 'b.png',
        result: { assetType: 'item', category: 'coin', description: '', confidence: 0.9 },
      },
    ]);
    expect(set.naming.map((n) => n.suggestedName)).toEqual([
      'item_coin_01.png',
      'item_coin_02.png',
    ]);
  });
});
