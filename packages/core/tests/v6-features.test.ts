import { describe, expect, it } from 'vitest';
import {
  createRasterImage,
  maskFromRect,
  contourMeshFromMask,
  patchMatchFill,
} from '../src/index.js';

// --- V6.1: mask 孔洞三角化 ---

describe('contourMeshFromMask with holes (V6.1)', () => {
  it('mask with hole: no triangle centroid inside the hole', () => {
    const mask = maskFromRect(64, 64, { x: 4, y: 4, width: 56, height: 56 });
    // punch a hole in the center
    for (let y = 24; y < 40; y++) {
      for (let x = 24; x < 40; x++) mask.data[y * 64 + x] = 0;
    }
    const mesh = contourMeshFromMask(mask, { interiorStep: 16 });
    expect(mesh.triangles.length).toBeGreaterThan(0);
    for (const [a, b, c] of mesh.triangles) {
      const cx = Math.floor((mesh.vertices[a].x + mesh.vertices[b].x + mesh.vertices[c].x) / 3);
      const cy = Math.floor((mesh.vertices[a].y + mesh.vertices[b].y + mesh.vertices[c].y) / 3);
      const inHole = cx >= 24 && cx < 40 && cy >= 24 && cy < 40;
      expect(inHole, `centroid ${cx},${cy} inside hole`).toBe(false);
    }
  });

  it('hole boundary vertices participate in the mesh', () => {
    const mask = maskFromRect(32, 32, { x: 0, y: 0, width: 32, height: 32 });
    // punch a hole at (8,8)-(24,24)
    for (let y = 8; y < 24; y++) {
      for (let x = 8; x < 24; x++) mask.data[y * 32 + x] = 0;
    }
    const mesh = contourMeshFromMask(mask, { interiorStep: 8 });
    // hole boundary vertices at x=8 or y=8 should exist in the mesh
    const hasHoleEdgeVertex = mesh.vertices.some(
      (v) => (v.x === 8 || v.y === 8) && v.x <= 24 && v.y <= 24,
    );
    expect(hasHoleEdgeVertex).toBe(true);
  });

  it('multiple holes: no centroid in any hole', () => {
    const mask = maskFromRect(48, 48, { x: 0, y: 0, width: 48, height: 48 });
    const holes = [
      { x: 8, y: 8, w: 8, h: 8 },
      { x: 32, y: 8, w: 8, h: 8 },
      { x: 20, y: 32, w: 8, h: 8 },
    ];
    for (const hole of holes) {
      for (let y = hole.y; y < hole.y + hole.h; y++) {
        for (let x = hole.x; x < hole.x + hole.w; x++) {
          mask.data[y * 48 + x] = 0;
        }
      }
    }
    const mesh = contourMeshFromMask(mask, { interiorStep: 12 });
    expect(mesh.triangles.length).toBeGreaterThan(0);
    for (const [a, b, c] of mesh.triangles) {
      const cx = Math.floor((mesh.vertices[a].x + mesh.vertices[b].x + mesh.vertices[c].x) / 3);
      const cy = Math.floor((mesh.vertices[a].y + mesh.vertices[b].y + mesh.vertices[c].y) / 3);
      for (const hole of holes) {
        const inHole = cx >= hole.x && cx < hole.x + hole.w && cy >= hole.y && cy < hole.y + hole.h;
        expect(inHole, `centroid ${cx},${cy} in hole at ${hole.x},${hole.y}`).toBe(false);
      }
    }
  });

  it('is deterministic with holes', () => {
    const mask = maskFromRect(48, 48, { x: 0, y: 0, width: 48, height: 48 });
    for (let y = 16; y < 32; y++) {
      for (let x = 16; x < 32; x++) mask.data[y * 48 + x] = 0;
    }
    expect(contourMeshFromMask(mask, { interiorStep: 12 })).toEqual(
      contourMeshFromMask(mask, { interiorStep: 12 }),
    );
  });
});

// --- V6.3: 多尺度 PatchMatch ---

describe('multi-scale PatchMatch', () => {
  it('fills holes at all scales', () => {
    const image = createRasterImage(16, 16, { hasAlpha: true });
    // solid green with holes
    for (let y = 4; y < 12; y++) {
      for (let x = 4; x < 12; x++) {
        const i = (y * 16 + x) * 4;
        image.data[i] = 0;
        image.data[i + 1] = 200;
        image.data[i + 2] = 0;
        image.data[i + 3] = 255;
      }
    }
    // punch holes
    for (let y = 6; y < 10; y++) {
      for (let x = 6; x < 10; x++) {
        const i = (y * 16 + x) * 4;
        for (let c = 0; c < 4; c++) image.data[i + c] = 0;
      }
    }
    patchMatchFill(image, { seed: 42, iterations: 4 });
    for (let i = 3; i < image.data.length; i += 4) {
      expect(image.data[i]).toBeGreaterThan(0);
    }
  });

  it('coarse-to-fine is deterministic', () => {
    const build = () => {
      const image = createRasterImage(16, 16, { hasAlpha: true });
      for (let y = 0; y < 16; y++) {
        for (let x = 0; x < 16; x++) {
          const i = (y * 16 + x) * 4;
          image.data[i] = (x * 16) % 256;
          image.data[i + 1] = (y * 16) % 256;
          image.data[i + 3] = 255;
        }
      }
      for (let y = 6; y < 10; y++) {
        for (let x = 6; x < 10; x++) {
          const i = (y * 16 + x) * 4;
          for (let c = 0; c < 4; c++) image.data[i + c] = 0;
        }
      }
      return image;
    };
    const a = build();
    const b = build();
    patchMatchFill(a, { seed: 42, iterations: 4 });
    patchMatchFill(b, { seed: 42, iterations: 4 });
    expect(Array.from(b.data)).toEqual(Array.from(a.data));
  });
});
