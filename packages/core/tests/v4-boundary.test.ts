import { describe, expect, it } from 'vitest';
import {
  composeLayers,
  createRasterImage,
  createMask,
  extractAndVerify,
  extractLayer,
  maskFromRect,
  setPixel,
  sourceOccupancy,
  unionMasks,
  validateRig,
  computeWeights,
  gridMeshFromMask,
} from '../src/index.js';

const A: [number, number, number, number] = [255, 0, 0, 255];
const B: [number, number, number, number] = [0, 255, 0, 255];
const CLEAR: [number, number, number, number] = [0, 0, 0, 0];

function solid(w: number, h: number, color = A) {
  const image = createRasterImage(w, h, { hasAlpha: true });
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) setPixel(image, x, y, color);
  return image;
}

// --- composeLayers z 序 ---

describe('composeLayers z-order', () => {
  it('higher index draws on top at overlap', () => {
    const srcA = solid(4, 4, A);
    const srcB = solid(4, 4, B);
    const mask = maskFromRect(4, 4, { x: 0, y: 0, width: 4, height: 4 });
    const lA = extractLayer(srcA, { id: 'a', mask }, { dilation: 0 });
    const lB = extractLayer(srcB, { id: 'b', mask }, { dilation: 0 });
    expect(composeLayers(4, 4, [lA, lB]).data[0]).toBe(B[0]);
    expect(composeLayers(4, 4, [lB, lA]).data[0]).toBe(A[0]);
  });

  it('three layers stack: last wins at overlap', () => {
    const mask = maskFromRect(4, 4, { x: 0, y: 0, width: 4, height: 4 });
    const layers = [A, B, [0, 0, 255, 255] as typeof A].map((color, i) =>
      extractLayer(solid(4, 4, color), { id: `l${i}`, mask }, { dilation: 0 }),
    );
    const composed = composeLayers(4, 4, layers);
    expect(composed.data[2]).toBe(255); // blue from last layer
  });
});

// --- extractLayer 边界 ---

describe('extractLayer boundaries', () => {
  it('fully transparent source produces transparent layer', () => {
    const source = solid(4, 4, CLEAR);
    const mask = maskFromRect(4, 4, { x: 0, y: 0, width: 4, height: 4 });
    const layer = extractLayer(source, { id: 't', mask }, { dilation: 0 });
    expect(layer.raster.data[3]).toBe(0);
  });

  it('multi-mask overlap: extraction per mask is independent', () => {
    const source = solid(8, 8, A);
    const mA = maskFromRect(8, 8, { x: 0, y: 0, width: 4, height: 8 });
    const mB = maskFromRect(8, 8, { x: 4, y: 0, width: 4, height: 8 });
    setPixel(source, 6, 4, B);
    const lA = extractLayer(source, { id: 'a', mask: mA }, { dilation: 0 });
    const lB = extractLayer(source, { id: 'b', mask: mB }, { dilation: 0 });
    expect(lA.raster.data[0]).toBe(A[0]);
    expect(lB.raster.data[(4 * 4 + 2) * 4]).toBe(B[0]);
  });
});

// --- occupancy ---

describe('occupancy (source + cell space)', () => {
  it('sourceOccupancy maps cell masks to source space', () => {
    const source = solid(8, 8);
    const mask = maskFromRect(8, 8, { x: 2, y: 2, width: 4, height: 4 });
    const layer = extractLayer(source, { id: 't', mask }, { dilation: 0 });
    const occupied = sourceOccupancy(8, 8, [layer]);
    expect(occupied.data[2 * 8 + 2]).toBe(255);
    expect(occupied.data[0]).toBe(0);
  });

  it('occupancy union includes L1 dilation ring pixels', () => {
    const source = solid(8, 8);
    const mask = maskFromRect(8, 8, { x: 2, y: 2, width: 4, height: 4 });
    const layer = extractLayer(source, { id: 't', mask }, { dilation: 2 });
    const occupied = unionMasks(8, 8, [layer.mask]);
    let covered = 0;
    for (let i = 0; i < occupied.data.length; i++) {
      if (occupied.data[i] !== 0) covered++;
    }
    expect(covered).toBeGreaterThan(0);
  });

  it('empty layer list produces empty occupancy', () => {
    expect(unionMasks(4, 4, []).data.every((v) => v === 0)).toBe(true);
    expect(sourceOccupancy(4, 4, []).data.every((v) => v === 0)).toBe(true);
  });
});

// --- reconstruction multi-layer ---

describe('reconstruction invariant multi-layer', () => {
  it('three non-overlapping layers reconstruct correctly', () => {
    const source = solid(30, 30);
    const masks = [
      maskFromRect(30, 30, { x: 0, y: 0, width: 10, height: 10 }),
      maskFromRect(30, 30, { x: 10, y: 10, width: 10, height: 10 }),
      maskFromRect(30, 30, { x: 20, y: 20, width: 10, height: 10 }),
    ];
    const { reconstruction } = extractAndVerify(
      source,
      masks.map((mask, i) => ({ id: `l${i}`, mask })),
    );
    expect(reconstruction.pass).toBe(true);
  });

  it('extreme size 1x1 passes', () => {
    const source = solid(1, 1);
    const mask = maskFromRect(1, 1, { x: 0, y: 0, width: 1, height: 1 });
    const { reconstruction } = extractAndVerify(source, [{ id: 't', mask }], { dilation: 0 });
    expect(reconstruction.pass).toBe(true);
  });

  it('extreme size 64x64 with non-rectangular mask passes', () => {
    const source = solid(64, 64);
    const mask = createMask(64, 64);
    for (let x = 0; x < 32; x++) mask.data[x] = 255;
    for (let y = 32; y < 64; y++) {
      for (let x = 0; x < 64; x++) mask.data[y * 64 + x] = 255;
    }
    const { reconstruction } = extractAndVerify(source, [{ id: 'l', mask }], { dilation: 2 });
    expect(reconstruction.pass).toBe(true);
  });
});

// --- skeleton ---

describe('skeleton validation', () => {
  it('empty bones pass validation', () => {
    expect(validateRig([])).toEqual([]);
  });

  it('deep chain (10 bones) validates', () => {
    const bones = [];
    for (let i = 0; i < 10; i++) {
      bones.push({
        id: `b${i}`,
        name: `b${i}`,
        parent: i === 0 ? null : `b${i - 1}`,
        x: 0.5,
        y: 0.5,
      });
    }
    expect(validateRig(bones)).toEqual([]);
  });

  it('deep cycle is detected', () => {
    const bones = [];
    for (let i = 0; i < 5; i++) {
      bones.push({
        id: `b${i}`,
        name: `b${i}`,
        parent: i === 0 ? 'b4' : `b${i - 1}`,
        x: 0.5,
        y: 0.5,
      });
    }
    expect(validateRig(bones).length).toBeGreaterThan(0);
  });
});

// --- weights ---

describe('computeWeights', () => {
  it('single bone gives weight 1 to all vertices', () => {
    const vertices = [
      { x: 0.1, y: 0.2 },
      { x: 0.9, y: 0.8 },
    ];
    const bones = [{ id: 'only', name: 'only', parent: null, x: 0.5, y: 0.5 }];
    const result = computeWeights(vertices, bones);
    for (const v of result.vertices) {
      expect(v.weights).toHaveLength(1);
      expect(v.weights[0].weight).toBe(1);
    }
  });

  it('vertex at exact bone position gets maximum weight (zero distance)', () => {
    const vertices = [{ x: 0.5, y: 0.5 }];
    const bones = [
      { id: 'near', name: 'near', parent: null, x: 0.5, y: 0.5 },
      { id: 'far', name: 'far', parent: null, x: 0.9, y: 0.9 },
    ];
    const result = computeWeights(vertices, bones);
    const w = result.vertices[0].weights;
    expect(w[0].bone).toBe('near');
    expect(w[0].weight).toBeGreaterThan(w[1]?.weight ?? 0);
  });

  it('empty vertices produce empty result', () => {
    const bones = [{ id: 'a', name: 'a', parent: null, x: 0.5, y: 0.5 }];
    expect(computeWeights([], bones).vertices).toHaveLength(0);
  });
});

// --- grid mesh ---

describe('gridMeshFromMask', () => {
  it('single-cell mask produces 2 triangles', () => {
    const mask = maskFromRect(8, 8, { x: 0, y: 0, width: 8, height: 8 });
    const mesh = gridMeshFromMask(mask, 8);
    expect(mesh.triangles).toHaveLength(2);
  });

  it('empty mask produces 0 triangles', () => {
    const mask = createMask(8, 8);
    expect(gridMeshFromMask(mask, 4).triangles).toHaveLength(0);
  });

  it('is deterministic', () => {
    const mask = maskFromRect(16, 16, { x: 0, y: 0, width: 16, height: 16 });
    expect(gridMeshFromMask(mask, 8)).toEqual(gridMeshFromMask(mask, 8));
  });
});
