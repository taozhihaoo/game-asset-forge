import { describe, expect, it } from 'vitest';
import {
  boundaryEdges,
  contourMeshFromMask,
  createMask,
  joinLoops,
  maskContours,
  maskFromRect,
  rdpSimplify,
  triangulateWithBoundary,
} from '../src/index.js';

// --- contour extraction ---

describe('maskContours', () => {
  it('rectangular mask yields one 4-corner loop after simplification', () => {
    const mask = maskFromRect(32, 32, { x: 4, y: 4, width: 24, height: 24 });
    const loops = maskContours(mask, 0.5);
    expect(loops).toHaveLength(1);
    expect(loops[0].length).toBe(4);
    for (const corner of [
      { x: 4, y: 4 },
      { x: 28, y: 4 },
      { x: 28, y: 28 },
      { x: 4, y: 28 },
    ]) {
      expect(
        loops[0].some((p) => p.x === corner.x && p.y === corner.y),
        JSON.stringify(corner),
      ).toBe(true);
    }
  });

  it('empty mask yields no loops', () => {
    expect(maskContours(createMask(8, 8))).toEqual([]);
  });

  it('two disconnected components yield two loops', () => {
    const mask = maskFromRect(40, 10, { x: 0, y: 0, width: 10, height: 10 });
    const second = maskFromRect(40, 10, { x: 30, y: 0, width: 10, height: 10 });
    for (let i = 0; i < second.data.length; i++) {
      if (second.data[i] !== 0) mask.data[i] = 255;
    }
    expect(maskContours(mask, 0.5).length).toBe(2);
  });
});

describe('rdpSimplify', () => {
  it('keeps endpoints always', () => {
    const simplified = rdpSimplify(
      [
        { x: 0, y: 0 },
        { x: 5, y: 0.01 },
        { x: 10, y: 0 },
      ],
      1,
    );
    expect(simplified).toHaveLength(2);
  });

  it('keeps high-deviation midpoints', () => {
    const simplified = rdpSimplify(
      [
        { x: 0, y: 0 },
        { x: 5, y: 5 },
        { x: 10, y: 0 },
      ],
      1,
    );
    expect(simplified).toHaveLength(3);
  });
});

describe('boundaryEdges / joinLoops', () => {
  it('rectangular mask: perimeter edges join into one loop', () => {
    const mask = maskFromRect(8, 8, { x: 0, y: 0, width: 8, height: 8 });
    const edges = boundaryEdges(mask);
    expect(edges).toHaveLength(32); // 8x8 perimeter
    const loops = joinLoops(edges);
    expect(loops).toHaveLength(1);
    expect(loops[0]).toHaveLength(33); // 32 points + closing point
  });
});

// --- Bowyer-Watson + boundary repair ---

describe('triangulateWithBoundary', () => {
  it('square with 4 corners: co-circular case repaired via inset midpoints', () => {
    const boundary = [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
      { x: 0, y: 10 },
    ];
    const { points, triangles, repaired } = triangulateWithBoundary(boundary, []);
    // co-circular corners make plain Delaunay drop edges; the inset repair
    // must detect it, insert interior-offset midpoints, and converge
    expect(repaired).toBeGreaterThan(0);
    for (const corner of boundary) {
      const used = triangles.some((tri) =>
        [tri.a, tri.b, tri.c].some((i) => points[i].x === corner.x && points[i].y === corner.y),
      );
      expect(used).toBe(true);
    }
    // total triangle area approximates the square area (100)
    let area = 0;
    for (const tri of triangles) {
      const p = points[tri.a];
      const q = points[tri.b];
      const r = points[tri.c];
      area += Math.abs((q.x - p.x) * (r.y - p.y) - (r.x - p.x) * (q.y - p.y)) / 2;
    }
    expect(area).toBeGreaterThan(85);
    expect(area).toBeLessThan(115);
  });

  it('flat rectangle: repair converges', () => {
    const boundary = [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 2 },
      { x: 0, y: 2 },
    ];
    const { triangles, repaired } = triangulateWithBoundary(boundary, [], 3);
    expect(triangles.length).toBeGreaterThan(0);
    expect(repaired).toBeGreaterThanOrEqual(0);
  });
});

// --- contourMeshFromMask integration ---

describe('contourMeshFromMask (V5.1)', () => {
  it('rect mask: all vertices inside the mask bounds', () => {
    const mask = maskFromRect(64, 64, { x: 8, y: 8, width: 48, height: 48 });
    const mesh = contourMeshFromMask(mask, { interiorStep: 16 });
    expect(mesh.triangles.length).toBeGreaterThan(0);
    for (const [a, b, c] of mesh.triangles) {
      for (const index of [a, b, c]) {
        const v = mesh.vertices[index];
        const inside = v.x >= 6 && v.x <= 58 && v.y >= 6 && v.y <= 58;
        expect(inside, `vertex ${v.x},${v.y} outside mask+ring`).toBe(true);
      }
    }
  });

  it('concave mask: no triangle centroid in the concavity', () => {
    const mask = maskFromRect(64, 64, { x: 0, y: 0, width: 64, height: 64 });
    for (let y = 0; y < 32; y++) {
      for (let x = 0; x < 32; x++) mask.data[y * 64 + x] = 0;
    }
    const mesh = contourMeshFromMask(mask, { interiorStep: 16 });
    expect(mesh.triangles.length).toBeGreaterThan(0);
    for (const [a, b, c] of mesh.triangles) {
      const cx = Math.floor((mesh.vertices[a].x + mesh.vertices[b].x + mesh.vertices[c].x) / 3);
      const cy = Math.floor((mesh.vertices[a].y + mesh.vertices[b].y + mesh.vertices[c].y) / 3);
      const inNotch = cx < 32 && cy < 32;
      expect(inNotch, `centroid ${cx},${cy} in concavity`).toBe(false);
    }
  });

  it('is deterministic', () => {
    const mask = maskFromRect(48, 48, { x: 4, y: 4, width: 40, height: 40 });
    expect(contourMeshFromMask(mask, { interiorStep: 12 })).toEqual(
      contourMeshFromMask(mask, { interiorStep: 12 }),
    );
  });

  it('empty mask returns empty mesh', () => {
    expect(contourMeshFromMask(createMask(8, 8))).toEqual({ vertices: [], triangles: [] });
  });
});
