import { describe, expect, it } from 'vitest';
import { applyBleed, applyPadding } from '../src/bleed.js';
import { calculatePivot } from '../src/pivot.js';
import { resizeRaster } from '../src/resize.js';
import { computeContentBounds, trimRaster } from '../src/trim.js';
import { makeImage, put, RED, TRANSPARENT } from './helpers.js';

describe('trim', () => {
  it('finds the tight bounding box of foreground pixels', () => {
    const sheet = makeImage(8, 8);
    put(sheet, 3, 2, RED);
    put(sheet, 6, 5, RED);
    const bounds = computeContentBounds(sheet.image, 8);
    expect(bounds).toEqual({ x: 3, y: 2, width: 4, height: 4 });
  });

  it('returns null for fully transparent rasters', () => {
    const sheet = makeImage(4, 4);
    expect(computeContentBounds(sheet.image, 8)).toBeNull();
    expect(trimRaster(sheet.image, 8)).toBeNull();
  });

  it('trims to the content and reports bounds in input space', () => {
    const sheet = makeImage(6, 6);
    for (let y = 2; y < 5; y++) for (let x = 1; x < 4; x++) put(sheet, x, y, RED);
    const result = trimRaster(sheet.image, 8);
    expect(result).not.toBeNull();
    expect(result?.contentRect).toEqual({ x: 1, y: 2, width: 3, height: 3 });
    expect(result?.raster.width).toBe(3);
    expect(result?.raster.height).toBe(3);
    expect(result?.raster.data[3]).toBe(255); // top-left of crop is opaque red
  });

  it('respects the alpha threshold', () => {
    const sheet = makeImage(4, 4);
    put(sheet, 1, 1, [255, 0, 0, 5]);
    expect(computeContentBounds(sheet.image, 8)).toBeNull();
    const bounds = computeContentBounds(sheet.image, 5);
    expect(bounds).toEqual({ x: 1, y: 1, width: 1, height: 1 });
  });
});

describe('resize', () => {
  it('returns the input unchanged at scale 1', () => {
    const sheet = makeImage(3, 3);
    put(sheet, 1, 1, RED);
    expect(resizeRaster(sheet.image, 1, 'nearest')).toBe(sheet.image);
  });

  it('nearest 2x replicates each source pixel into a 2x2 block', () => {
    const sheet = makeImage(2, 2);
    put(sheet, 0, 0, RED);
    const out = resizeRaster(sheet.image, 2, 'nearest');
    expect(out.width).toBe(4);
    expect(out.height).toBe(4);
    expect(out.data[0]).toBe(255); // r
    expect(out.data[3]).toBe(255); // a — top-left 2x2 block is red
    expect(out.data[(3 * 4 + 3) * 4 + 3]).toBe(0); // dst (3,3) samples src (1,1): still transparent
  });

  it('nearest 0.5x picks every second pixel (center sampling)', () => {
    const sheet = makeImage(4, 1);
    put(sheet, 0, 0, RED);
    put(sheet, 1, 0, TRANSPARENT);
    put(sheet, 2, 0, RED);
    put(sheet, 3, 0, TRANSPARENT);
    const out = resizeRaster(sheet.image, 0.5, 'nearest');
    expect(out.width).toBe(2);
    // dst x=0 -> src floor(0.5/0.5)=1 (transparent), dst x=1 -> src floor(1.5/0.5)=3 (transparent)
    expect(out.data[3]).toBe(0);
    expect(out.data[7]).toBe(0);
  });

  it('linear 2x interpolates a gradient', () => {
    const sheet = makeImage(2, 1);
    put(sheet, 0, 0, [0, 0, 0, 255]);
    put(sheet, 1, 0, [100, 0, 0, 255]);
    const out = resizeRaster(sheet.image, 2, 'linear');
    expect(out.width).toBe(4);
    const r = (x: number): number => out.data[x * 4];
    // centers at src -0.25, 0.25, 0.75, 1.25 (clamped weights)
    expect(r(0)).toBe(0); // clamp: both samples are pixel 0
    expect(r(1)).toBe(25);
    expect(r(2)).toBe(75);
    expect(r(3)).toBe(100); // clamp: both samples are pixel 1
  });

  it('handles non-integer output rounding (3px at 1.5x -> 5px)', () => {
    const sheet = makeImage(3, 1);
    const out = resizeRaster(sheet.image, 1.5, 'nearest');
    expect(out.width).toBe(Math.round(3 * 1.5));
    expect(out.width).toBe(5);
  });

  it('rejects invalid scales', () => {
    const sheet = makeImage(2, 2);
    expect(() => resizeRaster(sheet.image, 0, 'nearest')).toThrowError(/scale/);
    expect(() => resizeRaster(sheet.image, -1, 'linear')).toThrowError(/scale/);
    expect(() => resizeRaster(sheet.image, Number.POSITIVE_INFINITY, 'nearest')).toThrowError(
      /scale/,
    );
  });
});

describe('bleed / padding', () => {
  it('bleed 0 returns the input unchanged', () => {
    const sheet = makeImage(2, 2);
    expect(applyBleed(sheet.image, 0)).toBe(sheet.image);
    expect(applyPadding(sheet.image, 0)).toBe(sheet.image);
  });

  it('bleed grows the raster and replicates edge pixels incl. corners', () => {
    const sheet = makeImage(2, 2);
    put(sheet, 0, 0, RED); // only the top-left content pixel is opaque
    const out = applyBleed(sheet.image, 2);
    expect(out.width).toBe(6);
    expect(out.height).toBe(6);
    // content sits at (2,2); corner (0,0) replicates content corner (0,0) = red
    expect(out.data[3]).toBe(255);
    // outside the content on the far right edge replicates content (1,y) which is transparent
    expect(out.data[(2 * 6 + 5) * 4 + 3]).toBe(0);
    // just left of content replicates content column 0 -> red alpha
    expect(out.data[(2 * 6 + 1) * 4 + 3]).toBe(255);
  });

  it('padding grows the raster with a transparent margin around the content', () => {
    const sheet = makeImage(2, 1);
    put(sheet, 0, 0, RED);
    put(sheet, 1, 0, RED);
    const out = applyPadding(sheet.image, 2);
    expect(out.width).toBe(6);
    expect(out.height).toBe(5);
    expect(out.data[3]).toBe(0); // margin transparent
    expect(out.data[(2 * 6 + 2) * 4 + 3]).toBe(255); // content at (2,2)
  });

  it('composes: bleed then padding yields cell = content + 2*(bleed+padding)', () => {
    const sheet = makeImage(4, 4);
    const bled = applyBleed(sheet.image, 2);
    const cell = applyPadding(bled, 1);
    expect(cell.width).toBe(4 + 2 * (2 + 1));
    expect(cell.height).toBe(4 + 2 * (2 + 1));
  });
});

describe('pivot', () => {
  it('maps the three modes to normalized content-space coordinates', () => {
    expect(calculatePivot({ mode: 'center' })).toEqual({ x: 0.5, y: 0.5 });
    expect(calculatePivot({ mode: 'bottom-center' })).toEqual({ x: 0.5, y: 1.0 });
    expect(calculatePivot({ mode: 'manual', x: 0.25, y: 0.75 })).toEqual({ x: 0.25, y: 0.75 });
  });
});
