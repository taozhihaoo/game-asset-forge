import type { Mask } from './types.js';

/**
 * Grid mesh (V4 Feature 6, D9 降级定夺): vertices on a `step` grid, cells
 * kept only when ALL corners are inside the mask — concavities are never
 * filled (the constraint-Delaunay guarantee, achieved structurally).
 * Deterministic ordering: vertices row-major, triangles CCW per cell.
 */

export interface GridMesh {
  readonly vertices: readonly { readonly x: number; readonly y: number }[];
  readonly triangles: readonly (readonly [number, number, number])[];
}

export function gridMeshFromMask(mask: Mask, step: number): GridMesh {
  const vertexIndex = new Map<string, number>();
  const vertices: { x: number; y: number }[] = [];
  const triangles: [number, number, number][] = [];

  const inside = (x: number, y: number): boolean =>
    x >= 0 && x < mask.width && y >= 0 && y < mask.height && mask.data[y * mask.width + x] !== 0;

  const cols = Math.ceil(mask.width / step);
  const rows = Math.ceil(mask.height / step);

  const vertexAt = (gx: number, gy: number): number => {
    const key = `${gx},${gy}`;
    const existing = vertexIndex.get(key);
    if (existing !== undefined) return existing;
    const x = Math.min(mask.width, gx * step);
    const y = Math.min(mask.height, gy * step);
    const index = vertices.length;
    vertices.push({ x, y });
    vertexIndex.set(key, index);
    return index;
  };

  for (let gy = 0; gy < rows; gy++) {
    for (let gx = 0; gx < cols; gx++) {
      const x0 = gx * step;
      const y0 = gy * step;
      if (
        !inside(x0, y0) ||
        !inside(Math.min(x0 + step, mask.width) - 1, Math.min(y0 + step, mask.height) - 1)
      ) {
        continue;
      }
      // full-cell test: every pixel of the cell inside the mask
      let full = true;
      for (let py = y0; py < Math.min(y0 + step, mask.height) && full; py++) {
        for (let px = x0; px < Math.min(x0 + step, mask.width) && full; px++) {
          if (mask.data[py * mask.width + px] === 0) full = false;
        }
      }
      if (!full) continue;

      const v00 = vertexAt(gx, gy);
      const v10 = vertexAt(gx + 1, gy);
      const v01 = vertexAt(gx, gy + 1);
      const v11 = vertexAt(gx + 1, gy + 1);
      // deterministic CCW split (same diagonal for every cell)
      triangles.push([v00, v01, v11]);
      triangles.push([v00, v11, v10]);
    }
  }

  // vertices are created in cell-scan order; enforce row-major stability by
  // re-sorting indices deterministically and remapping triangles
  const order = vertices
    .map((v, i) => ({ i, key: `${v.y}:${v.x}` }))
    .sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  const remap = new Map<number, number>();
  order.forEach((entry, newIndex) => remap.set(entry.i, newIndex));
  const sortedVertices = order.map((entry) => vertices[entry.i]);
  const sortedTriangles = triangles.map(
    ([a, b, c]) =>
      [remap.get(a) ?? 0, remap.get(b) ?? 0, remap.get(c) ?? 0] as [number, number, number],
  );

  return { vertices: sortedVertices, triangles: sortedTriangles };
}

export function meshStats(mesh: GridMesh): { vertices: number; triangles: number } {
  return { vertices: mesh.vertices.length, triangles: mesh.triangles.length };
}
