import { describe, expect, it } from 'vitest';
import { composeAtlasPages, packAtlas } from '../src/atlas.js';
import { AtlasPackingError } from '../src/errors.js';
import type { Sprite } from '../src/index.js';
import { makeSprite } from './helpers.js';

const CONFIG = {
  maxWidth: 64,
  maxHeight: 64,
  algorithm: 'maxrects',
  spacing: 0,
} as const;

describe('packAtlas', () => {
  it('places sprites in input order, packed left-to-right top-to-bottom', () => {
    const sprites = [makeSprite('a', 10, 10), makeSprite('b', 10, 10), makeSprite('c', 10, 10)];
    const atlas = packAtlas(sprites, CONFIG);
    expect(atlas.pages).toHaveLength(1);
    expect(atlas.pages[0].placements.map((p) => p.rect)).toEqual([
      { x: 0, y: 0, width: 10, height: 10 },
      { x: 10, y: 0, width: 10, height: 10 },
      { x: 20, y: 0, width: 10, height: 10 },
    ]);
    // page trimmed to used extent
    expect(atlas.pages[0].width).toBe(30);
    expect(atlas.pages[0].height).toBe(10);
  });

  it('reuses L-shaped free space (MaxRects behavior)', () => {
    const atlas = packAtlas([makeSprite('big', 8, 8), makeSprite('small', 2, 2)], {
      ...CONFIG,
      maxWidth: 10,
      maxHeight: 10,
    });
    expect(atlas.pages[0].placements[0].rect).toEqual({ x: 0, y: 0, width: 8, height: 8 });
    // the 2x2 fits the tightest leftover; BSSF picks the earliest tied free rect (right strip)
    expect(atlas.pages[0].placements[1].rect.x).toBe(8);
    expect(atlas.pages[0].placements[1].rect.y).toBe(0);
  });

  it('keeps at least `spacing` transparent gap between placements', () => {
    const sprites = [makeSprite('a', 10, 10), makeSprite('b', 10, 10)];
    const atlas = packAtlas(sprites, { ...CONFIG, maxWidth: 24, spacing: 2 });
    expect(atlas.pages).toHaveLength(1);
    const [a, b] = atlas.pages[0].placements;
    expect(a.rect.x).toBe(0);
    expect(b.rect.x).toBe(12); // 10 wide + 2 gap
    expect(atlas.pages[0].width).toBe(22);
  });

  it('opens a new page when the current one is full', () => {
    const sprites = [makeSprite('a', 10, 10), makeSprite('b', 10, 10), makeSprite('c', 10, 10)];
    const atlas = packAtlas(sprites, { ...CONFIG, maxWidth: 20, maxHeight: 10 });
    expect(atlas.pages).toHaveLength(2);
    expect(atlas.pages[0].placements).toHaveLength(2);
    expect(atlas.pages[1].placements).toHaveLength(1);
    expect(atlas.pages[1].placements[0].spriteId).toBe('c.png#s');
  });

  it('rejects sprites whose cell (raster + spacing) exceeds the page', () => {
    expect(() =>
      packAtlas([makeSprite('huge', 30, 10)], { ...CONFIG, maxWidth: 20, maxHeight: 20 }),
    ).toThrowError(AtlasPackingError);
    expect(() =>
      packAtlas([makeSprite('edge', 10, 10)], { ...CONFIG, maxWidth: 12, spacing: 3 }),
    ).toThrowError(/exceeds the page limit/);
  });

  it('returns an atlas with zero pages for zero sprites', () => {
    const atlas = packAtlas([], CONFIG);
    expect(atlas.pages).toHaveLength(0);
  });

  it('is deterministic across runs', () => {
    const make = (): Sprite[] => [
      makeSprite('a', 12, 8),
      makeSprite('b', 8, 12),
      makeSprite('c', 5, 5),
      makeSprite('d', 20, 3),
    ];
    const config = { ...CONFIG, maxWidth: 32, spacing: 1 };
    expect(packAtlas(make(), config)).toEqual(packAtlas(make(), config));
  });
});

describe('composeAtlasPages', () => {
  it('blits sprite rasters at their placements; page trimmed to used extent', () => {
    const sprite = makeSprite('a', 2, 2, [7, 8, 9, 255]);
    const atlas = packAtlas([sprite], { ...CONFIG, maxWidth: 16, spacing: 0 });
    const pages = composeAtlasPages(atlas, [sprite]);
    expect(pages).toHaveLength(1);
    expect(pages[0].width).toBe(2);
    expect(pages[0].height).toBe(2);
    expect(Array.from(pages[0].data)).toEqual([
      7, 8, 9, 255, 7, 8, 9, 255, 7, 8, 9, 255, 7, 8, 9, 255,
    ]);
  });

  it('places two sprites at distinct offsets on one page', () => {
    const a = makeSprite('a', 2, 2, [255, 0, 0, 255]);
    const b = makeSprite('b', 2, 2, [0, 255, 0, 255]);
    const atlas = packAtlas([a, b], { ...CONFIG, spacing: 0 });
    const pages = composeAtlasPages(atlas, [a, b]);
    expect(pages[0].width).toBe(4);
    const alphaAt = (x: number, y: number): number => pages[0].data[(y * 4 + x) * 4 + 3];
    expect(alphaAt(0, 0)).toBe(255); // a
    expect(alphaAt(2, 0)).toBe(255); // b
    expect(pages[0].data[0]).toBe(255); // red channel of a
    expect(pages[0].data[(0 * 4 + 2) * 4]).toBe(0); // red channel of b at x=2
  });

  it('rejects placements referencing unknown sprites', () => {
    const atlas = packAtlas([makeSprite('a', 2, 2)], CONFIG);
    expect(() => composeAtlasPages(atlas, [makeSprite('other', 2, 2)])).toThrowError(
      /unknown sprite/,
    );
  });
});

describe('makeSprite (test helper) sanity', () => {
  it('creates a solid sprite with the expected id', () => {
    const sprite = makeSprite('x', 3, 4, [1, 2, 3, 255]);
    expect(sprite.id).toBe('x.png#s');
    expect(sprite.raster.width).toBe(3);
    expect(sprite.raster.height).toBe(4);
  });
});
