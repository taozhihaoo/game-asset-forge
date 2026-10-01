import { describe, expect, it } from 'vitest';
import { runPipeline } from '../src/pipeline.js';
import { NoAlphaChannelError } from '../src/errors.js';
import { parsePreset } from '../src/preset.js';
import type { Pipeline } from '../src/types.js';
import { fillRect, makeImage, RED } from './helpers.js';

function twoSpritePipeline(): Pipeline {
  return parsePreset({
    schemaVersion: 1,
    padding: { pixels: 1 },
    bleed: { pixels: 1 },
  });
}

describe('runPipeline', () => {
  it('runs detect → trim → margins → pack → manifest end to end', () => {
    const sheet = makeImage(24, 12);
    fillRect(sheet, 2, 2, 4, 4, RED); // sprite A (tight 4x4)
    fillRect(sheet, 12, 4, 6, 3, RED); // sprite B (tight 6x3)

    const result = runPipeline(sheet.image, twoSpritePipeline(), { sourcePath: 'assets/demo.png' });
    expect(result.skipped).toEqual([]);
    expect(result.sprites.map((s) => s.id)).toEqual([
      'assets/demo.png#sprite-0001',
      'assets/demo.png#sprite-0002',
    ]);

    // cell raster = content + 2*(padding 1 + bleed 1)
    expect(result.sprites[0].raster.width).toBe(8);
    expect(result.atlas.pages).toHaveLength(1);
    // page trimmed to used extent: A cell 8 wide at x=0, B cell 10 wide at x=10 → 20; height 8
    expect(result.atlas.pages[0].width).toBe(20);
    expect(result.atlas.pages[0].height).toBe(8);

    expect(result.pages).toHaveLength(1);
    expect(result.pages[0].width).toBe(20);
    // first cell raster has opaque content at (2,2) after margins
    expect(result.pages[0].data[(2 * 20 + 2) * 4 + 3]).toBe(255);

    expect(result.manifest).toMatchObject({
      schemaVersion: 1,
      generator: { name: 'gameasset-forge', version: '0.1.0' },
      source: 'assets/demo.png',
      pages: [{ file: 'atlas-0.png', width: 20, height: 8 }],
    });
    expect(result.manifest.sprites).toHaveLength(2);
    expect(result.manifest.sprites[0]).toMatchObject({
      id: 'assets/demo.png#sprite-0001',
      page: 0,
      rect: { x: 0, y: 0, width: 8, height: 8 },
      sourceRect: { x: 2, y: 2, width: 4, height: 4 },
      trimmedRect: { x: 2, y: 2, width: 4, height: 4 },
      pivot: { x: 0.5, y: 1 },
    });
  });

  it('produces an empty (but valid) result when every sprite is skipped', () => {
    const sheet = makeImage(8, 8);
    const pipeline = parsePreset({
      schemaVersion: 1,
      detect: { mode: 'manual', rects: [{ x: 1, y: 1, width: 4, height: 4 }] },
    });
    const result = runPipeline(sheet.image, pipeline, { sourcePath: 'empty.png' });
    expect(result.sprites).toEqual([]);
    expect(result.skipped).toHaveLength(1);
    expect(result.atlas.pages).toEqual([]);
    expect(result.pages).toEqual([]);
    expect(result.manifest.pages).toEqual([]);
    expect(result.manifest.sprites).toEqual([]);
  });

  it('propagates the no-alpha contract error with the source attached', () => {
    const sheet = makeImage(8, 8, false);
    try {
      runPipeline(sheet.image, twoSpritePipeline(), { sourcePath: 'rgb.png' });
      throw new Error('expected throw');
    } catch (e) {
      expect(e).toBeInstanceOf(NoAlphaChannelError);
      expect((e as NoAlphaChannelError).source).toBe('rgb.png');
    }
  });

  it('is deterministic: identical input and pipeline produce identical results', () => {
    const make = (): ReturnType<typeof makeImage> => {
      const sheet = makeImage(24, 12);
      fillRect(sheet, 2, 2, 4, 4, RED);
      fillRect(sheet, 12, 4, 6, 3, RED);
      return sheet;
    };
    const a = runPipeline(make().image, twoSpritePipeline(), { sourcePath: 'assets/demo.png' });
    const b = runPipeline(make().image, twoSpritePipeline(), { sourcePath: 'assets/demo.png' });
    expect(a).toEqual(b);
  });
});
