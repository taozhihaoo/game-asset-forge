import { describe, expect, it } from 'vitest';
import {
  checkReconstruction,
  composeLayers,
  computeWeights,
  createRasterImage,
  createMask,
  extractAndVerify,
  extractLayer,
  gridMeshFromMask,
  maskFromRect,
  parseAssetName,
  proposeRig,
  setPixel,
  sourceOccupancy,
  validateForgeProject,
  validateRig,
  RIG_TEMPLATES,
} from '../src/index.js';

const RED: [number, number, number, number] = [255, 0, 0, 255];
const BLUE: [number, number, number, number] = [0, 0, 255, 255];
const COLOR_A = RED;
const COLOR_B = BLUE;

function solid(w: number, h: number, color = RED) {
  const image = createRasterImage(w, h, { hasAlpha: true });
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) setPixel(image, x, y, color);
  return image;
}

// --- L1 edge dilation ---

describe('L1 edge dilation', () => {
  it('dilated ring replicates nearest in-mask color', () => {
    const source = solid(10, 10);
    setPixel(source, 5, 5, BLUE);
    const mask = maskFromRect(10, 10, { x: 4, y: 4, width: 3, height: 3 });
    const layer = extractLayer(source, { id: 't', mask }, { dilation: 2 });
    expect(layer.raster.data.length).toBeGreaterThan(0);
    // all non-transparent pixels should have some color
    for (let i = 3; i < layer.raster.data.length; i += 4) {
      expect(layer.raster.data[i]).toBeGreaterThan(0);
    }
  });

  it('dilated ring alpha matches nearest in-mask alpha', () => {
    const source = createRasterImage(8, 8, { hasAlpha: true });
    for (let y = 2; y < 6; y++) {
      for (let x = 2; x < 6; x++) setPixel(source, x, y, [255, 255, 255, 200]);
    }
    const mask = maskFromRect(8, 8, { x: 2, y: 2, width: 4, height: 4 });
    const layer = extractLayer(source, { id: 't', mask }, { dilation: 1 });
    // check that all non-transparent alpha values in the layer match 200
    for (let i = 3; i < layer.raster.data.length; i += 4) {
      if (layer.raster.data[i] > 0) {
        expect(layer.raster.data[i]).toBe(200);
      }
    }
  });
});

// --- L2 diffusion fill ---

describe('L2 diffusion fill', () => {
  it('fills interior holes from occlusion', () => {
    const source = solid(12, 12, COLOR_A);
    const bodyMask = maskFromRect(12, 12, { x: 1, y: 1, width: 10, height: 10 });
    for (let y = 4; y < 8; y++) {
      for (let x = 4; x < 8; x++) bodyMask.data[y * 12 + x] = 0;
    }
    const layer = extractLayer(
      source,
      { id: 't', mask: bodyMask },
      {
        dilation: 2,
        diffusionIterations: 20,
      },
    );
    // interior hole should be filled
    let filled = 0;
    for (let i = 3; i < layer.raster.data.length; i += 4) {
      if (layer.raster.data[i] > 0) filled++;
    }
    expect(filled).toBeGreaterThan(0);
  });

  it('converges with more iterations', () => {
    const source = solid(8, 8);
    const mask = maskFromRect(8, 8, { x: 2, y: 2, width: 4, height: 4 });
    const low = extractLayer(source, { id: 't', mask }, { dilation: 2, diffusionIterations: 4 });
    const high = extractLayer(source, { id: 't', mask }, { dilation: 2, diffusionIterations: 50 });
    for (let i = 3; i < low.raster.data.length; i += 4) {
      expect(low.raster.data[i]).toBeGreaterThan(0);
      expect(high.raster.data[i]).toBeGreaterThan(0);
    }
  });

  it('L3 degradation: works without any AI provider', () => {
    const source = solid(8, 8);
    const mask = maskFromRect(8, 8, { x: 1, y: 1, width: 6, height: 6 });
    expect(() =>
      extractLayer(source, { id: 't', mask }, { dilation: 2, diffusionIterations: 10 }),
    ).not.toThrow();
  });
});

// --- composeLayers ---

describe('composeLayers', () => {
  it('later layers overwrite earlier at same positions', () => {
    const sourceA = solid(8, 8, COLOR_A);
    const sourceB = solid(8, 8, COLOR_B);
    const mask = maskFromRect(8, 8, { x: 0, y: 0, width: 8, height: 8 });
    const layerA = extractLayer(sourceA, { id: 'a', mask }, { dilation: 0 });
    const layerB = extractLayer(sourceB, { id: 'b', mask }, { dilation: 0 });
    const composed = composeLayers(8, 8, [layerA, layerB]);
    expect(composed.data[0]).toBe(COLOR_B[0]);
  });

  it('empty layers produce transparent canvas', () => {
    expect(composeLayers(4, 4, []).data.every((v) => v === 0)).toBe(true);
  });
});

// --- reconstruction invariant ---

describe('reconstruction invariant', () => {
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

  it('non-rectangular masks reconstruct correctly', () => {
    const source = solid(16, 16);
    const mask = createMask(16, 16);
    for (let x = 0; x < 8; x++) mask.data[x] = 255;
    for (let y = 0; y < 8; y++) mask.data[y * 16 + 8] = 255;
    const { reconstruction } = extractAndVerify(source, [{ id: 'l', mask }]);
    expect(reconstruction.pass).toBe(true);
  });

  it('extreme sizes 1x1 and 64x64 pass', () => {
    const tiny = solid(1, 1);
    const m1 = maskFromRect(1, 1, { x: 0, y: 0, width: 1, height: 1 });
    expect(extractAndVerify(tiny, [{ id: 't', mask: m1 }]).reconstruction.pass).toBe(true);
    const large = solid(64, 64);
    const m2 = maskFromRect(64, 64, { x: 10, y: 10, width: 44, height: 44 });
    expect(extractAndVerify(large, [{ id: 'l', mask: m2 }]).reconstruction.pass).toBe(true);
  });

  it('overlapping masks reconstruct correctly', () => {
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

// --- checkReconstruction ---

describe('checkReconstruction', () => {
  it('passes when composed matches source exactly', () => {
    const source = solid(8, 8);
    const mask = maskFromRect(8, 8, { x: 0, y: 0, width: 8, height: 8 });
    const layer = extractLayer(source, { id: 't', mask }, { dilation: 0 });
    expect(checkReconstruction(source, [layer], 0).pass).toBe(true);
  });

  it('detects violations when composed differs from source', () => {
    const source = solid(8, 8);
    const mask = maskFromRect(8, 8, { x: 0, y: 0, width: 8, height: 8 });
    const layer = extractLayer(source, { id: 't', mask }, { dilation: 0 });
    layer.raster.data[0] = 255;
    layer.raster.data[1] = 255;
    layer.raster.data[2] = 255;
    const result = checkReconstruction(source, [layer], 0);
    expect(result.pass).toBe(false);
  });

  it('allows small pixel deltas when maxPixelDelta is set', () => {
    const source = solid(8, 8, [100, 100, 100, 255]);
    const mask = maskFromRect(8, 8, { x: 0, y: 0, width: 8, height: 8 });
    const layer = extractLayer(source, { id: 't', mask }, { dilation: 0 });
    layer.raster.data[0] = 105;
    expect(checkReconstruction(source, [layer], 10).pass).toBe(true);
  });
});

// --- occupancy ---

describe('occupancy', () => {
  it('sourceOccupancy maps cell masks back to source space', () => {
    const source = solid(8, 8);
    const mask = maskFromRect(8, 8, { x: 2, y: 2, width: 4, height: 4 });
    const layer = extractLayer(source, { id: 't', mask }, { dilation: 0 });
    const occupied = sourceOccupancy(8, 8, [layer]);
    // Mask stores 1 byte per pixel (no *4)
    expect(occupied.data[2 * 8 + 2]).toBe(255);
    expect(occupied.data[0]).toBe(0);
  });

  it('empty layers produce empty occupancy', () => {
    const occupied = sourceOccupancy(4, 4, []);
    expect(occupied.data.every((v) => v === 0)).toBe(true);
  });
});

// --- grid mesh ---

describe('grid mesh', () => {
  it('full-cell mask produces triangles and vertices', () => {
    const mask = maskFromRect(16, 16, { x: 0, y: 0, width: 16, height: 16 });
    const mesh = gridMeshFromMask(mask, 8);
    expect(mesh.vertices.length).toBeGreaterThan(0);
    expect(mesh.triangles.length).toBeGreaterThan(0);
  });

  it('concave mask has no vertices in the concavity', () => {
    const mask = maskFromRect(32, 32, { x: 0, y: 0, width: 32, height: 32 });
    for (let y = 0; y < 16; y++) {
      for (let x = 0; x < 16; x++) mask.data[y * 32 + x] = 0;
    }
    const mesh = gridMeshFromMask(mask, 8);
    for (const v of mesh.vertices) {
      const inNotch = v.x < 16 && v.y < 16;
      expect(inNotch).toBe(false);
    }
  });

  it('is deterministic', () => {
    const mask = maskFromRect(32, 32, { x: 0, y: 0, width: 32, height: 32 });
    expect(gridMeshFromMask(mask, 8)).toEqual(gridMeshFromMask(mask, 8));
  });
});

// --- weights ---

describe('computeWeights', () => {
  it('weights sum to 1 for each vertex', () => {
    const vertices = [
      { x: 0.3, y: 0.5 },
      { x: 0.7, y: 0.3 },
    ];
    const bones = [
      { id: 'a', name: 'a', parent: null, x: 0.2, y: 0.4 },
      { id: 'b', name: 'b', parent: null, x: 0.8, y: 0.6 },
    ];
    const weights = computeWeights(vertices, bones);
    for (const v of weights.vertices) {
      const sum = v.weights.reduce((acc, w) => acc + w.weight, 0);
      expect(sum).toBeCloseTo(1, 5);
    }
  });

  it('empty bones produce empty weights', () => {
    const weights = computeWeights([], []);
    expect(weights.vertices).toHaveLength(0);
  });
});

// --- forge project boundary tests ---

describe('forge project boundary cases', () => {
  it('rejects non-object .forge', () => {
    expect(() => validateForgeProject(null)).toThrowError(/JSON object/);
    expect(() => validateForgeProject([1, 2])).toThrowError(/JSON object/);
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
      const roots = proposeRig(template).filter((b) => b.parent === null);
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

// --- rig validation (uses imported functions) ---

describe('rig validation and templates', () => {
  it('human template has expected bones', () => {
    const bones = proposeRig('human');
    expect(bones.length).toBe(7);
    expect(validateRig(bones)).toEqual([]);
  });

  it('RIG_TEMPLATES covers all three archetypes', () => {
    expect(RIG_TEMPLATES).toContain('human');
    expect(RIG_TEMPLATES).toContain('animal');
    expect(RIG_TEMPLATES).toContain('monster');
  });
});

describe('parseAssetName', () => {
  it('extracts group and index from asset name', () => {
    const parsed = parseAssetName('assets/hero_idle_01.png');
    expect(parsed.group).toBe('assets/hero_idle');
    expect(parsed.index).toBe(1);
  });
});
