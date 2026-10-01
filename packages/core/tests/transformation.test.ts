import { describe, expect, it } from 'vitest';
import {
  composeLayers,
  createRasterImage,
  createMask,
  dilateMask,
  erodeMask,
  extractAndVerify,
  extractLayer,
  gridMeshFromMask,
  invertMask,
  maskBounds,
  maskFromRect,
  sourceOccupancy,
  overlayMask,
  proposeRig,
  setPixel,
  unionMasks,
  validateRig,
  RIG_TEMPLATES,
  type ExtractedLayer,
} from '../src/index.js';

const SOLID = [200, 100, 50, 255] as [number, number, number, number];

describe('mask ops', () => {
  it('dilate expands, erode shrinks, both compose back', () => {
    const mask = maskFromRect(10, 10, { x: 4, y: 4, width: 2, height: 2 });
    const dilated = dilateMask(mask, 2);
    expect(dilated.data[4 * 10 + 2]).toBe(255); // 2px left of the rect edge
    const eroded = erodeMask(dilated, 2);
    expect(eroded.data[4 * 10 + 4]).toBe(255);
    expect(eroded.data[4 * 10 + 2]).toBe(0);
  });

  it('invert flips, overlay unions', () => {
    const a = maskFromRect(4, 4, { x: 0, y: 0, width: 2, height: 2 });
    const b = maskFromRect(4, 4, { x: 2, y: 2, width: 2, height: 2 });
    const inverted = invertMask(a);
    expect(inverted.data[0]).toBe(0);
    expect(inverted.data[3 * 4 + 3]).toBe(255);
    const union = overlayMask(a, b);
    expect(union.data[0]).toBe(255);
    expect(union.data[3 * 4 + 3]).toBe(255);
  });

  it('unionMasks requires matching sizes', () => {
    expect(() => unionMasks(4, 4, [createMask(8, 8)])).toThrowError(/size/);
  });

  it('maskBounds finds the tight box', () => {
    const mask = createMask(10, 10);
    mask.data[3 * 10 + 7] = 255;
    expect(maskBounds(mask)).toEqual({ x: 7, y: 3, width: 1, height: 1 });
    expect(maskBounds(createMask(4, 4))).toBeNull();
  });
});

function solid(w: number, h: number, color: [number, number, number, number]) {
  const image = createRasterImage(w, h, { hasAlpha: true });
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) setPixel(image, x, y, color);
  }
  return image;
}

function layerFrom(id: string, mask: ReturnType<typeof createMask>, dilation = 2): ExtractedLayer {
  return extractLayer(solid(20, 20, SOLID), { id, mask }, { dilation });
}

describe('layer extraction + reconstruction invariant (D10)', () => {
  it('extracted cell matches mask bounds expanded by dilation', () => {
    const mask = maskFromRect(20, 20, { x: 6, y: 6, width: 4, height: 4 });
    const layer = layerFrom('a', mask, 3);
    expect(layer.cellRect).toEqual({ x: 3, y: 3, width: 10, height: 10 });
  });

  it('invariant: composing layers reproduces the source wherever any mask covers', () => {
    const source = solid(16, 16, SOLID);
    setPixel(source, 15, 15, [1, 2, 3, 255]); // corner detail
    const maskA = maskFromRect(16, 16, { x: 0, y: 0, width: 8, height: 16 });
    const maskB = maskFromRect(16, 16, { x: 8, y: 0, width: 8, height: 16 });

    const layerA = extractLayer(source, { id: 'a', mask: maskA }, { dilation: 2 });
    const layerB = extractLayer(source, { id: 'b', mask: maskB }, { dilation: 2 });
    const composed = composeLayers(16, 16, [layerA, layerB]);
    for (let i = 0; i < 16 * 16 * 4; i += 4) {
      expect(Array.from(composed.data.slice(i, i + 4))).toEqual(
        Array.from(source.data.slice(i, i + 4)),
      );
    }
  });

  it('invariant via checkReconstruction: covered == source, uncovered transparent', () => {
    const source = solid(16, 16, SOLID);
    const maskA = maskFromRect(16, 16, { x: 0, y: 0, width: 8, height: 16 });
    const maskB = maskFromRect(16, 16, { x: 8, y: 0, width: 8, height: 16 });
    const { layers, reconstruction } = extractAndVerify(source, [
      { id: 'a', mask: maskA },
      { id: 'b', mask: maskB },
    ]);
    expect(reconstruction.pass).toBe(true);
    expect(reconstruction.coveredPixels).toBe(16 * 16);
    expect(layers).toHaveLength(2);
  });

  it('occlusion: moving a layer does not expose holes inside its dilated ring', () => {
    // sprite with an occluding arm over the body: body mask region behind the
    // arm is unknown; L1 dilation + L2 diffusion must fill it deterministically
    const bodyMask = maskFromRect(16, 16, { x: 2, y: 2, width: 12, height: 12 });
    const armMask = maskFromRect(16, 16, { x: 6, y: 6, width: 8, height: 4 });
    // the arm region was REMOVED from the body mask (occluded, unknown)
    for (let y = 6; y < 10; y++) {
      for (let x = 6; x < 14; x++) bodyMask.data[y * 16 + x] = 0;
    }
    const layerBody = layerFrom('body', bodyMask, 2);
    // diffusion fill must have filled interior holes (alpha != 0 everywhere
    // inside the former occluded region)
    const probeX = 8;
    const probeY = 7;
    const i =
      ((probeY - layerBody.cellRect.y) * layerBody.raster.width + (probeX - layerBody.cellRect.x)) *
      4;
    expect(layerBody.raster.data[i + 3]).toBeGreaterThan(0);
    void armMask;
  });

  it('empty mask layers are rejected', () => {
    expect(() => layerFrom('empty', createMask(4, 4))).toThrowError(/empty/);
  });
});

describe('occupancy', () => {
  it('occupancyMask unions all layer cells', () => {
    const layers = [
      layerFrom('a', maskFromRect(20, 20, { x: 1, y: 1, width: 4, height: 4 })),
      layerFrom('b', maskFromRect(20, 20, { x: 10, y: 10, width: 4, height: 4 })),
    ];
    const occupied = sourceOccupancy(20, 20, layers);
    expect(occupied.data[2 * 20 + 2]).toBe(255);
    expect(occupied.data[12 * 20 + 12]).toBe(255);
    expect(occupied.data[6 * 20 + 6]).toBe(0);
  });
});

describe('grid mesh (D9 prototype)', () => {
  it('keeps only full cells inside the mask (concavities preserved)', () => {
    const mask = maskFromRect(32, 32, { x: 4, y: 4, width: 24, height: 24 });
    // carve a concave notch
    for (let y = 4; y < 16; y++) {
      for (let x = 4; x < 16; x++) mask.data[y * 32 + x] = 0;
    }
    const mesh = gridMeshFromMask(mask, 8);
    expect(mesh.triangles.length).toBeGreaterThan(0);
    for (const [a, b, c] of mesh.triangles) {
      for (const index of [a, b, c]) {
        const v = mesh.vertices[index];
        // no vertex may sit inside the carved notch
        const inNotch = v.x >= 4 && v.x < 16 && v.y >= 4 && v.y < 16;
        expect(inNotch).toBe(false);
      }
    }
  });

  it('is deterministic', () => {
    const mask = maskFromRect(32, 32, { x: 4, y: 4, width: 24, height: 24 });
    expect(gridMeshFromMask(mask, 8)).toEqual(gridMeshFromMask(mask, 8));
  });
});

describe('rig proposal (V4 Feature 5)', () => {
  it('templates have valid parent chains and distinct ids', () => {
    for (const template of RIG_TEMPLATES) {
      const bones = proposeRig(template);
      const problems = validateRig(bones);
      expect(problems, template).toEqual([]);
      expect(new Set(bones.map((b) => b.id)).size).toBe(bones.length);
    }
  });

  it('human template has the documented bone chain', () => {
    const bones = proposeRig('human');
    const head = bones.find((b) => b.name === 'head');
    expect(head?.parent).toBe('body');
    expect(bones.some((b) => b.name === 'root' && b.parent === null)).toBe(true);
  });

  it('flags missing parents and cycles', () => {
    const broken = [
      { id: 'a', name: 'a', parent: 'b', x: 0.5, y: 0.5 },
      { id: 'b', name: 'b', parent: 'a', x: 0.5, y: 0.5 },
    ];
    expect(validateRig(broken).length).toBeGreaterThan(0);
  });
});
