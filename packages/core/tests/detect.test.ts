import { describe, expect, it } from 'vitest';
import { detectSprites } from '../src/detect.js';
import { NoAlphaChannelError, NoSpritesFoundError } from '../src/errors.js';
import type { DetectConfig } from '../src/types.js';
import { makeImage, put, RED } from './helpers.js';

const ALPHA_CC = (
  over: Partial<Extract<DetectConfig, { mode: 'alpha-connected-components' }>> = {},
): DetectConfig => ({
  mode: 'alpha-connected-components',
  alphaThreshold: 8,
  minPixels: 4,
  connectivity: 8,
  ...over,
});

describe('detectSprites — alpha-connected-components', () => {
  it('finds two separated sprites in y-then-x order', () => {
    const sheet = makeImage(20, 20);
    for (let y = 2; y < 6; y++) for (let x = 12; x < 16; x++) put(sheet, x, y, RED); // top-right
    for (let y = 10; y < 14; y++) for (let x = 1; x < 5; x++) put(sheet, x, y, RED); // bottom-left

    const found = detectSprites(sheet.image, ALPHA_CC());
    expect(found.map((f) => f.rect)).toEqual([
      { x: 12, y: 2, width: 4, height: 4 },
      { x: 1, y: 10, width: 4, height: 4 },
    ]);
  });

  it('same row orders left-to-right', () => {
    const sheet = makeImage(30, 8);
    for (let y = 2; y < 5; y++) {
      for (let x = 20; x < 23; x++) put(sheet, x, y, RED);
      for (let x = 4; x < 7; x++) put(sheet, x, y, RED);
    }
    const found = detectSprites(sheet.image, ALPHA_CC());
    expect(found[0].rect.x).toBe(4);
    expect(found[1].rect.x).toBe(20);
  });

  it('8-connectivity joins diagonal pixels; 4-connectivity keeps them apart', () => {
    const make = (): ReturnType<typeof makeImage> => {
      const sheet = makeImage(4, 4);
      put(sheet, 1, 1, RED);
      put(sheet, 2, 2, RED);
      return sheet;
    };
    const eight = detectSprites(make().image, ALPHA_CC({ connectivity: 8, minPixels: 1 }));
    expect(eight).toHaveLength(1);
    expect(eight[0].rect).toEqual({ x: 1, y: 1, width: 2, height: 2 });

    const four = detectSprites(make().image, ALPHA_CC({ connectivity: 4, minPixels: 1 }));
    expect(four).toHaveLength(2);
  });

  it('drops components below minPixels', () => {
    const sheet = makeImage(10, 10);
    for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) put(sheet, x, y, RED); // 16 px
    put(sheet, 9, 9, RED); // 1 px
    const found = detectSprites(sheet.image, ALPHA_CC({ minPixels: 4 }));
    expect(found).toHaveLength(1);
    expect(found[0].rect).toEqual({ x: 0, y: 0, width: 4, height: 4 });
  });

  it('respects alphaThreshold (alpha 7 is background at threshold 8, foreground at 7)', () => {
    const make = (): ReturnType<typeof makeImage> => {
      const sheet = makeImage(4, 4);
      for (let y = 1; y < 3; y++) for (let x = 1; x < 3; x++) put(sheet, x, y, [0, 0, 0, 7]);
      return sheet;
    };
    expect(() => detectSprites(make().image, ALPHA_CC())).toThrowError(NoSpritesFoundError);
    const found = detectSprites(make().image, ALPHA_CC({ alphaThreshold: 7, minPixels: 1 }));
    expect(found).toHaveLength(1);
  });

  it('bounding box spans the full component including interior holes', () => {
    const sheet = makeImage(6, 4); // top row + right column: one L-shaped component
    for (let x = 0; x < 6; x++) put(sheet, x, 0, RED);
    for (let y = 1; y < 4; y++) put(sheet, 5, y, RED);
    const found = detectSprites(sheet.image, ALPHA_CC());
    expect(found).toHaveLength(1);
    expect(found[0].rect).toEqual({ x: 0, y: 0, width: 6, height: 4 });
  });

  it('throws NoSpritesFoundError on an empty sheet', () => {
    const sheet = makeImage(8, 8);
    expect(() => detectSprites(sheet.image, ALPHA_CC())).toThrowError(NoSpritesFoundError);
  });

  it('throws NoAlphaChannelError on RGB sources and points at grid/manual', () => {
    const sheet = makeImage(8, 8, false);
    try {
      detectSprites(sheet.image, ALPHA_CC(), { source: 'a.png' });
      throw new Error('expected throw');
    } catch (e) {
      expect(e).toBeInstanceOf(NoAlphaChannelError);
      expect((e as NoAlphaChannelError).source).toBe('a.png');
      expect((e as NoAlphaChannelError).message).toMatch(/grid or manual/);
    }
  });

  it('is deterministic across runs', () => {
    const build = (): ReturnType<typeof makeImage> => {
      const sheet = makeImage(16, 16);
      for (let y = 1; y < 4; y++) for (let x = 1; x < 4; x++) put(sheet, x, y, RED);
      for (let y = 8; y < 12; y++) for (let x = 8; x < 12; x++) put(sheet, x, y, RED);
      return sheet;
    };
    expect(detectSprites(build().image, ALPHA_CC())).toEqual(
      detectSprites(build().image, ALPHA_CC()),
    );
  });
});

describe('detectSprites — grid', () => {
  it('rows+columns form: cell size = floor(size/n), remainder ignored', () => {
    const sheet = makeImage(10, 6); // 2 cols -> cw 5, 2 rows -> ch 3
    for (const [cx, cy] of [
      [0, 0],
      [5, 0],
      [0, 3],
      [5, 3],
    ] as const) {
      put(sheet, cx + 1, cy + 1, RED); // one foreground pixel per cell
    }
    const found = detectSprites(sheet.image, {
      mode: 'grid',
      rows: 2,
      columns: 2,
      alphaThreshold: 8,
    });
    expect(found.map((f) => f.rect)).toEqual([
      { x: 0, y: 0, width: 5, height: 3 },
      { x: 5, y: 0, width: 5, height: 3 },
      { x: 0, y: 3, width: 5, height: 3 },
      { x: 5, y: 3, width: 5, height: 3 },
    ]);
  });

  it('cellWidth+cellHeight form: counts = floor(size/cell), right/bottom remainder ignored', () => {
    const sheet = makeImage(10, 7); // cw 4 -> 2 cols, ch 3 -> 2 rows; 2x2 remainder strip ignored
    for (const [cx, cy] of [
      [0, 0],
      [4, 0],
      [0, 3],
      [4, 3],
    ] as const) {
      put(sheet, cx + 1, cy + 1, RED);
    }
    const found = detectSprites(sheet.image, {
      mode: 'grid',
      cellWidth: 4,
      cellHeight: 3,
      alphaThreshold: 8,
    });
    expect(found.map((f) => f.rect)).toEqual([
      { x: 0, y: 0, width: 4, height: 3 },
      { x: 4, y: 0, width: 4, height: 3 },
      { x: 0, y: 3, width: 4, height: 3 },
      { x: 4, y: 3, width: 4, height: 3 },
    ]);
  });

  it('drops empty cells but keeps the scan order', () => {
    const sheet = makeImage(8, 8); // 2x2 grid of 4x4 cells
    for (let y = 0; y < 3; y++) for (let x = 0; x < 3; x++) put(sheet, x, y, RED); // cell (0,0)
    for (let y = 4; y < 7; y++) for (let x = 4; x < 7; x++) put(sheet, x, y, RED); // cell (1,1)
    const found = detectSprites(sheet.image, {
      mode: 'grid',
      rows: 2,
      columns: 2,
      alphaThreshold: 8,
    });
    expect(found.map((f) => f.rect)).toEqual([
      { x: 0, y: 0, width: 4, height: 4 },
      { x: 4, y: 4, width: 4, height: 4 },
    ]);
  });

  it('no-alpha sources keep every cell (no dropping)', () => {
    const sheet = makeImage(8, 8, false);
    const found = detectSprites(sheet.image, {
      mode: 'grid',
      rows: 2,
      columns: 2,
      alphaThreshold: 8,
    });
    expect(found).toHaveLength(4);
  });

  it('rejects degenerate grids (cell smaller than 1px)', () => {
    const sheet = makeImage(4, 4);
    expect(() =>
      detectSprites(sheet.image, { mode: 'grid', rows: 1, columns: 8, alphaThreshold: 8 }),
    ).toThrowError(/grid degenerates/);
  });

  it('throws NoSpritesFoundError when every cell is empty', () => {
    const sheet = makeImage(8, 8);
    expect(() =>
      detectSprites(sheet.image, { mode: 'grid', rows: 2, columns: 2, alphaThreshold: 8 }),
    ).toThrowError(NoSpritesFoundError);
  });
});

describe('detectSprites — manual', () => {
  it('preserves user order and ids', () => {
    const sheet = makeImage(10, 10);
    const found = detectSprites(sheet.image, {
      mode: 'manual',
      rects: [
        { x: 5, y: 5, width: 2, height: 2, id: 'sword' },
        { x: 0, y: 0, width: 3, height: 3 },
      ],
    });
    expect(found.map((f) => f.id)).toEqual(['sword', 'sprite-0002']);
    expect(found[1].rect).toEqual({ x: 0, y: 0, width: 3, height: 3 });
  });

  it('rejects out-of-bounds and duplicate ids', () => {
    const sheet = makeImage(8, 8);
    expect(() =>
      detectSprites(sheet.image, { mode: 'manual', rects: [{ x: 6, y: 6, width: 4, height: 4 }] }),
    ).toThrowError(/past image/);
    expect(() =>
      detectSprites(sheet.image, {
        mode: 'manual',
        rects: [
          { x: 0, y: 0, width: 1, height: 1, id: 'x' },
          { x: 2, y: 2, width: 1, height: 1, id: 'x' },
        ],
      }),
    ).toThrowError(/duplicate manual rect id/);
  });
});
