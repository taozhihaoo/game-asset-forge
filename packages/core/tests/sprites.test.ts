import { describe, expect, it } from 'vitest';
import { buildSprites } from '../src/sprites.js';
import { parsePreset } from '../src/preset.js';
import { makeImage, put, RED } from './helpers.js';

function defaultPipeline(): ReturnType<typeof parsePreset> {
  return parsePreset({ schemaVersion: 1, padding: { pixels: 1 }, bleed: { pixels: 1 } });
}

describe('buildSprites', () => {
  it('runs the full pre-atlas pipeline: detect -> trim -> margins -> pivot', () => {
    const sheet = makeImage(16, 16);
    // sprite A with a transparent border to trim: content 3x3 at (2,2)
    for (let y = 2; y < 5; y++) for (let x = 2; x < 5; x++) put(sheet, x, y, RED);
    // sprite B: content 2x4 at (10,8)
    for (let y = 8; y < 12; y++) for (let x = 10; x < 12; x++) put(sheet, x, y, RED);

    const { sprites, skipped } = buildSprites(sheet.image, defaultPipeline(), {
      sourcePath: 'assets/sheet.png',
    });
    expect(skipped).toEqual([]);

    expect(sprites.map((s) => s.id)).toEqual([
      'assets/sheet.png#sprite-0001',
      'assets/sheet.png#sprite-0002',
    ]);
    expect(sprites[0].sourceRect).toEqual({ x: 2, y: 2, width: 3, height: 3 });
    expect(sprites[0].trimmedRect).toEqual({ x: 2, y: 2, width: 3, height: 3 }); // already tight
    expect(sprites[1].sourceRect).toEqual({ x: 10, y: 8, width: 2, height: 4 });

    // cell raster = content + 2*(bleed 1 + padding 1)
    expect(sprites[0].raster.width).toBe(3 + 4);
    expect(sprites[0].raster.height).toBe(3 + 4);
    // default pivot bottom-center, normalized against content
    expect(sprites[0].pivot).toEqual({ x: 0.5, y: 1.0 });
  });

  it('trim shifts trimmedRect into source space and shrinks the cell', () => {
    const sheet = makeImage(12, 12);
    for (let y = 4; y < 6; y++) for (let x = 4; x < 6; x++) put(sheet, x, y, RED); // 2x2 inside a 4x4 region
    const pipeline = parsePreset({
      schemaVersion: 1,
      detect: { mode: 'manual', rects: [{ x: 3, y: 3, width: 4, height: 4 }] },
      padding: { pixels: 0 },
      bleed: { pixels: 0 },
    });
    const { sprites } = buildSprites(sheet.image, pipeline, { sourcePath: 's.png' });
    expect(sprites[0].sourceRect).toEqual({ x: 3, y: 3, width: 4, height: 4 });
    expect(sprites[0].trimmedRect).toEqual({ x: 4, y: 4, width: 2, height: 2 });
    expect(sprites[0].raster.width).toBe(2);
  });

  it('skips fully transparent sprites and keeps stable ids for the rest', () => {
    const sheet = makeImage(16, 8);
    for (let y = 1; y < 4; y++) for (let x = 1; x < 4; x++) put(sheet, x, y, RED); // rect 1: content
    // rect 2 (x 5..8) intentionally empty — manual rects are not dropped at detection
    for (let y = 1; y < 4; y++) for (let x = 9; x < 12; x++) put(sheet, x, y, RED); // rect 3: content
    const pipeline = parsePreset({
      schemaVersion: 1,
      detect: {
        mode: 'manual',
        rects: [
          { x: 0, y: 0, width: 4, height: 4 },
          { x: 5, y: 0, width: 4, height: 4 },
          { x: 8, y: 0, width: 4, height: 4 },
        ],
      },
      padding: { pixels: 1 },
      bleed: { pixels: 1 },
    });
    const { sprites, skipped } = buildSprites(sheet.image, pipeline, { sourcePath: 's.png' });

    expect(skipped).toEqual([
      {
        id: 's.png#sprite-0002',
        sourceRect: { x: 5, y: 0, width: 4, height: 4 },
        reason: 'fully-transparent',
      },
    ]);
    expect(sprites.map((s) => s.id)).toEqual(['s.png#sprite-0001', 's.png#sprite-0003']);
  });

  it('applies resize before margins (scale 2 doubles content dims)', () => {
    const sheet = makeImage(8, 8);
    for (let y = 1; y < 3; y++) for (let x = 1; x < 3; x++) put(sheet, x, y, RED); // 2x2 content
    const pipeline = parsePreset({
      schemaVersion: 1,
      resize: { enabled: true, scale: 2, filter: 'nearest' },
      padding: { pixels: 0 },
      bleed: { pixels: 0 },
    });
    const { sprites } = buildSprites(sheet.image, pipeline, { sourcePath: 's.png' });
    expect(sprites[0].raster.width).toBe(4);
    expect(sprites[0].raster.height).toBe(4);
    // trimmedRect stays in SOURCE space even though the cell doubled
    expect(sprites[0].trimmedRect).toEqual({ x: 1, y: 1, width: 2, height: 2 });
  });

  it('uses manual rect ids in sprite ids', () => {
    const sheet = makeImage(8, 8);
    put(sheet, 1, 1, RED);
    const pipeline = parsePreset({
      schemaVersion: 1,
      detect: { mode: 'manual', rects: [{ x: 0, y: 0, width: 4, height: 4, id: 'sword' }] },
      padding: { pixels: 0 },
      bleed: { pixels: 0 },
    });
    const { sprites } = buildSprites(sheet.image, pipeline, { sourcePath: 'w.png' });
    expect(sprites[0].id).toBe('w.png#sword');
  });

  it('is deterministic: identical input and pipeline produce identical output', () => {
    const make = (): ReturnType<typeof makeImage> => {
      const sheet = makeImage(12, 12);
      for (let y = 1; y < 4; y++) for (let x = 1; x < 4; x++) put(sheet, x, y, RED);
      for (let y = 6; y < 9; y++) for (let x = 6; x < 9; x++) put(sheet, x, y, RED);
      return sheet;
    };
    const a = buildSprites(make().image, defaultPipeline(), { sourcePath: 's.png' });
    const b = buildSprites(make().image, defaultPipeline(), { sourcePath: 's.png' });
    expect(a).toEqual(b);
  });
});
