import { describe, expect, it } from 'vitest';
import { validateForgeProject } from '../src/index.js';
import {
  createRasterImage,
  createMask,
  dilateMask,
  erodeMask,
  extractLayer,
  gridMeshFromMask,
  invertMask,
  maskBounds,
  maskFromRect,
  overlayMask,
  setPixel,
  unionMasks,
  proposeRig,
  sourceOccupancy,
  extractAndVerify,
} from '../src/index.js';

const SOLID = [200, 100, 50, 255] as [number, number, number, number];

function solid(w: number, h: number, color: typeof SOLID = SOLID) {
  const image = createRasterImage(w, h, { hasAlpha: true });
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) setPixel(image, x, y, color);
  return image;
}

// --- mask boundary cases ---

describe('mask boundary cases', () => {
  it('dilate radius 0 returns identical mask', () => {
    const mask = maskFromRect(8, 8, { x: 2, y: 2, width: 4, height: 4 });
    expect(dilateMask(mask, 0)).toEqual(mask);
  });

  it('dilate at image edge clamps correctly', () => {
    const mask = maskFromRect(4, 4, { x: 0, y: 0, width: 2, height: 2 });
    const dilated = dilateMask(mask, 1);
    expect(dilated.data[0]).toBe(255); // corner
    expect(dilated.data[3 * 4 + 3]).toBe(0); // far corner untouched
  });

  it('erode radius larger than mask empties it', () => {
    const mask = maskFromRect(4, 4, { x: 0, y: 0, width: 2, height: 2 });
    const eroded = erodeMask(mask, 5);
    expect(eroded.data.every((v) => v === 0)).toBe(true);
  });

  it('erode radius 0 returns identical mask', () => {
    const mask = maskFromRect(8, 8, { x: 2, y: 2, width: 4, height: 4 });
    expect(erodeMask(mask, 0)).toEqual(mask);
  });

  it('invert twice returns original', () => {
    const mask = maskFromRect(4, 4, { x: 1, y: 1, width: 2, height: 2 });
    expect(invertMask(invertMask(mask))).toEqual(mask);
  });

  it('union of no masks is all zero', () => {
    const result = unionMasks(4, 4, []);
    expect(result.data.every((v) => v === 0)).toBe(true);
  });

  it('overlay preserves base where top is empty', () => {
    const base = maskFromRect(4, 4, { x: 0, y: 0, width: 2, height: 4 });
    const top = maskFromRect(4, 4, { x: 2, y: 0, width: 2, height: 4 });
    const result = overlayMask(base, top);
    expect(result.data[0]).toBe(255);
    expect(result.data[3]).toBe(255);
  });

  it('maskBounds on full-coverage mask returns full rect', () => {
    const mask = maskFromRect(4, 4, { x: 0, y: 0, width: 4, height: 4 });
    expect(maskBounds(mask)).toEqual({ x: 0, y: 0, width: 4, height: 4 });
  });
});

// --- extraction extreme cases ---

describe('extraction extreme cases', () => {
  it('zero dilation means cell == mask bounds', () => {
    const source = solid(20, 20);
    const mask = maskFromRect(20, 20, { x: 5, y: 5, width: 4, height: 4 });
    const layer = extractLayer(source, { id: 't', mask }, { dilation: 0 });
    expect(layer.cellRect).toEqual({ x: 5, y: 5, width: 4, height: 4 });
  });

  it('large dilation clamps to image bounds', () => {
    const source = solid(10, 10);
    const mask = maskFromRect(10, 10, { x: 4, y: 4, width: 2, height: 2 });
    const layer = extractLayer(source, { id: 't', mask }, { dilation: 50 });
    expect(layer.cellRect.x).toBe(0);
    expect(layer.cellRect.y).toBe(0);
    expect(layer.cellRect.width).toBe(10);
    expect(layer.cellRect.height).toBe(10);
  });

  it('extraction copies correct source colors inside mask', () => {
    const source = solid(8, 8, [255, 0, 0, 255]);
    setPixel(source, 3, 3, [0, 255, 0, 255]);
    const mask = maskFromRect(8, 8, { x: 0, y: 0, width: 8, height: 8 });
    const layer = extractLayer(source, { id: 't', mask }, { dilation: 0 });
    expect(layer.raster.data[(3 * 8 + 3) * 4]).toBe(0); // green channel
    expect(layer.raster.data[(3 * 8 + 3) * 4 + 1]).toBe(255);
  });

  it('L1 dilation ring replicates nearest in-mask pixel', () => {
    const source = solid(8, 8, [255, 0, 0, 255]);
    setPixel(source, 3, 3, [0, 0, 255, 255]); // only one blue pixel
    const mask = maskFromRect(8, 8, { x: 0, y: 0, width: 1, height: 1 });
    mask.data[0] = 255; // only (0,0) is in mask
    const layer = extractLayer(source, { id: 't', mask }, { dilation: 2 });
    // cell = (0,0) to (2,2); pixel (2,2) is outside mask, nearest is (0,0) distance 2
    expect(layer.raster.data[(2 * 3 + 2) * 4]).toBe(255); // red replicated
    // pixel (2,0): nearest is (0,0) distance 2, also blue
    expect(layer.raster.data[(0 * 3 + 2) * 4]).toBe(255);
  });

  it('L2 diffusion fills interior holes from dilated ring', () => {
    const source = solid(12, 12, [100, 100, 100, 255]);
    const mask = maskFromRect(12, 12, { x: 2, y: 2, width: 8, height: 8 });
    const layer = extractLayer(
      source,
      { id: 't', mask },
      {
        dilation: 2,
        diffusionIterations: 20,
      },
    );
    // all pixels in the cell should now be non-transparent
    for (let i = 3; i < layer.raster.data.length; i += 4) {
      expect(layer.raster.data[i]).toBeGreaterThan(0);
    }
  });

  it('diffusion iteration stability: more iterations converge', () => {
    const source = solid(8, 8, [50, 50, 50, 255]);
    const mask = maskFromRect(8, 8, { x: 2, y: 2, width: 4, height: 4 });
    const low = extractLayer(source, { id: 't', mask }, { dilation: 2, diffusionIterations: 4 });
    const high = extractLayer(source, { id: 't', mask }, { dilation: 2, diffusionIterations: 50 });
    // both should fill all alpha channels
    for (let i = 3; i < low.raster.data.length; i += 4) {
      expect(low.raster.data[i]).toBeGreaterThan(0);
      expect(high.raster.data[i]).toBeGreaterThan(0);
    }
  });

  it('extraction with 1x1 mask works', () => {
    const source = solid(4, 4);
    const mask = maskFromRect(4, 4, { x: 2, y: 2, width: 1, height: 1 });
    const layer = extractLayer(source, { id: 't', mask }, { dilation: 0 });
    expect(layer.cellRect).toEqual({ x: 2, y: 2, width: 1, height: 1 });
    expect(layer.raster.width).toBe(1);
  });
});

// --- reconstruction invariant: multi-layer and non-rectangular ---

describe('reconstruction invariant (multi-layer / non-rectangular)', () => {
  it('three overlapping layers reconstruct correctly', () => {
    const source = solid(20, 20);
    const masks = [
      maskFromRect(20, 20, { x: 0, y: 0, width: 10, height: 20 }),
      maskFromRect(20, 20, { x: 10, y: 0, width: 10, height: 10 }),
      maskFromRect(20, 20, { x: 0, y: 10, width: 20, height: 10 }),
    ];
    const { reconstruction } = extractAndVerify(
      source,
      masks.map((mask, i) => ({ id: `l${i}`, mask })),
    );
    expect(reconstruction.pass).toBe(true);
    expect(reconstruction.coveredPixels).toBe(20 * 20);
  });

  it('non-rectangular (L-shaped) masks reconstruct correctly', () => {
    const source = solid(16, 16);
    const mask = createMask(16, 16);
    for (let x = 0; x < 8; x++) mask.data[x] = 255;
    for (let y = 0; y < 8; y++) mask.data[8 + y * 16] = 255;
    const { reconstruction } = extractAndVerify(source, [{ id: 'l', mask }]);
    expect(reconstruction.pass).toBe(true);
  });

  it('extreme sizes: 1x1 and 64x64 both pass', () => {
    const tiny = solid(1, 1);
    const m1 = maskFromRect(1, 1, { x: 0, y: 0, width: 1, height: 1 });
    expect(extractAndVerify(tiny, [{ id: 't', mask: m1 }]).reconstruction.pass).toBe(true);

    const large = solid(64, 64);
    const m2 = maskFromRect(64, 64, { x: 10, y: 10, width: 44, height: 44 });
    expect(extractAndVerify(large, [{ id: 'l', mask: m2 }]).reconstruction.pass).toBe(true);
  });

  it('overlapping masks reconstruct correctly (later layer wins)', () => {
    const source = solid(16, 16);
    const maskA = maskFromRect(16, 16, { x: 0, y: 0, width: 10, height: 10 });
    const maskB = maskFromRect(16, 16, { x: 5, y: 5, width: 10, height: 10 });
    const { reconstruction } = extractAndVerify(source, [
      { id: 'a', mask: maskA },
      { id: 'b', mask: maskB },
    ]);
    expect(reconstruction.pass).toBe(true);
  });
});

// --- .forge project boundary tests ---

describe('forge project boundary cases', () => {
  it('rejects non-object .forge', () => {
    expect(() => validateForgeProject(null)).toThrowError(/JSON object/);
    expect(() => validateForgeProject([1, 2])).toThrowError(/JSON object/);
    expect(() => validateForgeProject('str')).toThrowError(/JSON object/);
  });

  it('accepts empty arrays for layers/bones/mesh/weights', () => {
    const project = validateForgeProject({
      forgeVersion: 1,
      asset: { source: 'a.png', width: 1, height: 1 },
      layers: [],
      bones: [],
      mesh: [],
      weights: [],
      animationTemplates: [],
    });
    expect(project.layers).toEqual([]);
  });

  it('rejects bones with self-referencing parent', () => {
    expect(() =>
      validateForgeProject({
        forgeVersion: 1,
        asset: { source: 'a.png', width: 1, height: 1 },
        bones: [{ id: 'a', name: 'a', parent: 'a', x: 0, y: 0 }],
      }),
    ).toThrowError(/cycle/);
  });

  it('accepts valid bone chain parent→child', () => {
    const project = validateForgeProject({
      forgeVersion: 1,
      asset: { source: 'a.png', width: 1, height: 1 },
      bones: [
        { id: 'root', name: 'root', parent: null, x: 0.5, y: 1 },
        { id: 'body', name: 'body', parent: 'root', x: 0.5, y: 0.5 },
      ],
    });
    expect(project.bones).toHaveLength(2);
  });
});

// --- rig template edge cases ---

describe('rig template edge cases', () => {
  it('all templates produce unique bone ids', () => {
    for (const template of ['human', 'animal', 'monster'] as const) {
      const bones = proposeRig(template);
      const ids = bones.map((b) => b.id);
      expect(new Set(ids).size).toBe(ids.length);
    }
  });

  it('exactly one root per template', () => {
    for (const template of ['human', 'animal', 'monster'] as const) {
      const bones = proposeRig(template);
      const roots = bones.filter((b) => b.parent === null);
      expect(roots).toHaveLength(1);
    }
  });

  it('all positions are within [0, 1]', () => {
    for (const template of ['human', 'animal', 'monster'] as const) {
      for (const bone of proposeRig(template)) {
        expect(bone.x).toBeGreaterThanOrEqual(0);
        expect(bone.x).toBeLessThanOrEqual(1);
        expect(bone.y).toBeGreaterThanOrEqual(0);
        expect(bone.y).toBeLessThanOrEqual(1);
      }
    }
  });
});

// --- grid mesh edge cases ---

describe('grid mesh edge cases', () => {
  it('single-cell mask produces exactly 2 triangles and 4 vertices', () => {
    const mask = maskFromRect(8, 8, { x: 0, y: 0, width: 8, height: 8 });
    const mesh = gridMeshFromMask(mask, 8);
    expect(mesh.vertices).toHaveLength(4);
    expect(mesh.triangles).toHaveLength(2);
  });

  it('step 1 on a 1x1 mask produces exactly 2 triangles', () => {
    const mask = maskFromRect(1, 1, { x: 0, y: 0, width: 1, height: 1 });
    const mesh = gridMeshFromMask(mask, 1);
    expect(mesh.triangles).toHaveLength(2);
  });

  it('empty mask produces 0 triangles', () => {
    const mask = maskFromRect(8, 8, { x: 0, y: 0, width: 0, height: 0 });
    const mesh = gridMeshFromMask(mask, 4);
    expect(mesh.triangles).toHaveLength(0);
  });
});

// --- source occupancy ---

describe('sourceOccupancy', () => {
  it('returns source-space occupancy for layers', () => {
    const source = solid(16, 16);
    const maskA = maskFromRect(16, 16, { x: 0, y: 0, width: 8, height: 16 });
    const maskB = maskFromRect(16, 16, { x: 8, y: 0, width: 8, height: 16 });
    const layerA = extractLayer(source, { id: 'a', mask: maskA }, { dilation: 0 });
    const layerB = extractLayer(source, { id: 'b', mask: maskB }, { dilation: 0 });
    const occupied = sourceOccupancy(16, 16, [layerA, layerB]);
    expect(occupied.data[0]).toBe(255);
    expect(occupied.data[15 * 16 + 15]).toBe(255);
    expect(occupied.data.every((v) => v === 255)).toBe(true); // full coverage
  });
});
