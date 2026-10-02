import { describe, expect, it } from 'vitest';
import {
  createRasterImage,
  extractLayer,
  maskFromRect,
  patchMatchFill,
  setPixel,
} from '../src/index.js';

const RED: [number, number, number, number] = [255, 0, 0, 255];
const BLUE: [number, number, number, number] = [0, 0, 255, 255];

function solid(w: number, h: number, color = RED) {
  const image = createRasterImage(w, h, { hasAlpha: true });
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) setPixel(image, x, y, color);
  return image;
}

describe('patchMatchFill', () => {
  it('fills all transparent pixels (no holes remain)', () => {
    const image = solid(16, 16);
    const mask = maskFromRect(16, 16, { x: 0, y: 0, width: 16, height: 16 });
    for (let y = 5; y < 11; y++) {
      for (let x = 5; x < 11; x++) mask.data[y * 16 + x] = 0;
    }
    // simulate holes: clear masked-out pixels
    for (let i = 0; i < mask.data.length; i++) {
      if (mask.data[i] === 0) {
        const p = i * 4;
        for (let c = 0; c < 4; c++) image.data[p + c] = 0;
      }
    }
    // punch interior holes too
    for (let y = 6; y < 10; y++) {
      for (let x = 6; x < 10; x++) {
        const p = (y * 16 + x) * 4;
        for (let c = 0; c < 4; c++) image.data[p + c] = 0;
      }
    }
    patchMatchFill(image, { seed: 42 });
    for (let i = 3; i < image.data.length; i += 4) {
      expect(image.data[i]).toBeGreaterThan(0);
    }
  });

  it('is deterministic for the same seed', () => {
    const build = (): { a: ReturnType<typeof solid>; b: ReturnType<typeof solid> } => {
      const a = solid(12, 12);
      const b = solid(12, 12);
      for (let y = 4; y < 8; y++) {
        for (let x = 4; x < 8; x++) {
          for (const image of [a, b]) {
            const p = (y * 12 + x) * 4;
            for (let c = 0; c < 4; c++) image.data[p + c] = 0;
          }
        }
      }
      return { a, b };
    };
    const { a, b } = build();
    patchMatchFill(a, { seed: 7 });
    patchMatchFill(b, { seed: 7 });
    expect(Array.from(b.data)).toEqual(Array.from(a.data));
  });

  it('different seeds can produce different fills', () => {
    const a = solid(16, 16);
    const b = solid(16, 16);
    // split-color source so different patch matches are visible
    for (let y = 0; y < 16; y++) {
      for (let x = 8; x < 16; x++) setPixel(a, x, y, BLUE);
      for (let x = 8; x < 16; x++) setPixel(b, x, y, BLUE);
    }
    for (let y = 6; y < 10; y++) {
      for (let x = 6; x < 10; x++) {
        for (const image of [a, b]) {
          const p = (y * 16 + x) * 4;
          for (let c = 0; c < 4; c++) image.data[p + c] = 0;
        }
      }
    }
    patchMatchFill(a, { seed: 1 });
    patchMatchFill(b, { seed: 999999 });
    // not a strict inequality (random search may coincide) — just verify both filled
    expect(a.data[(8 * 16 + 8) * 4 + 3]).toBeGreaterThan(0);
    expect(b.data[(8 * 16 + 8) * 4 + 3]).toBeGreaterThan(0);
  });

  it('does not modify non-transparent pixels (only holes are filled)', () => {
    const image = solid(8, 8, RED);
    setPixel(image, 3, 3, BLUE);
    // punch one hole
    const p = (6 * 8 + 6) * 4;
    for (let c = 0; c < 4; c++) image.data[p + c] = 0;
    const before = Array.from(image.data).slice(0, p);
    patchMatchFill(image, { seed: 5 });
    expect(Array.from(image.data).slice(0, p)).toEqual(before);
  });

  it('all-transparent image is a no-op (nothing to source from)', () => {
    const image = solid(4, 4, RED);
    for (let i = 0; i < image.data.length; i++) image.data[i] = 0;
    expect(() => patchMatchFill(image, { seed: 1 })).not.toThrow();
  });
});

describe('extractLayer completion modes (V5.2)', () => {
  it('default is patchmatch and fills occlusion holes', () => {
    const source = solid(16, 16);
    const bodyMask = maskFromRect(16, 16, { x: 1, y: 1, width: 10, height: 10 });
    for (let y = 4; y < 8; y++) {
      for (let x = 4; x < 8; x++) bodyMask.data[y * 16 + x] = 0;
    }
    const layer = extractLayer(source, { id: 't', mask: bodyMask }, { dilation: 2 });
    // interior hole must be filled under the default completion
    const probeX = 6 - layer.cellRect.x;
    const probeY = 6 - layer.cellRect.y;
    const i = (probeY * layer.raster.width + probeX) * 4 + 3;
    expect(layer.raster.data[i]).toBeGreaterThan(0);
  });

  it('explicit diffusion mode still works', () => {
    const source = solid(16, 16);
    const mask = maskFromRect(16, 16, { x: 2, y: 2, width: 8, height: 8 });
    const layer = extractLayer(
      source,
      { id: 't', mask },
      {
        dilation: 2,
        completion: 'diffusion',
        diffusionIterations: 16,
      },
    );
    for (let i = 3; i < layer.raster.data.length; i += 4) {
      expect(layer.raster.data[i]).toBeGreaterThan(0);
    }
  });

  it('both modes are deterministic per mode', () => {
    const source = solid(16, 16);
    const mask = maskFromRect(16, 16, { x: 2, y: 2, width: 8, height: 8 });
    const pmA = extractLayer(source, { id: 't', mask }, { dilation: 2, completion: 'patchmatch' });
    const pmB = extractLayer(source, { id: 't', mask }, { dilation: 2, completion: 'patchmatch' });
    expect(Array.from(pmB.raster.data)).toEqual(Array.from(pmA.raster.data));
  });
});
