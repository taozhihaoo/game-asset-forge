import type { Mask } from './types.js';
import { maskContours, type ContourPoint } from './contour.js';
import { triangulateWithBoundary } from './cdt.js';

/**
 * Mesh generation over masks. Two strategies:
 * - `gridMeshFromMask` (V4 prototype): grid cells fully inside the mask.
 * - `contourMeshFromMask` (V5.1): contour-fitted constrained-Delaunay mesh —
 *   boundary loops simplified with RDP, Delaunay + boundary-missing repair,
 *   centroid-on-mask filtering. Concavities never filled; deterministic.
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

/**
 * Contour-fitted mesh (V5.1, hole-aware since V6): boundary loops extracted
 * from the mask, simplified with RDP, triangulated with Delaunay + boundary
 * repair, then filtered by mask coverage — concavities and holes are never
 * filled because the centroid test keeps only triangles whose center sits on
 * a set pixel. ALL loops (outer + holes) contribute boundary points so hole
 * edges are respected by the triangulation.
 */
export function contourMeshFromMask(
  mask: Mask,
  options: { epsilon?: number; interiorStep?: number; repairRounds?: number } = {},
): GridMesh {
  const epsilon = options.epsilon ?? 1.5;
  const interiorStep =
    options.interiorStep ?? Math.max(8, Math.round(Math.min(mask.width, mask.height) / 8));

  const loops = maskContours(mask, epsilon);
  if (loops.length === 0) return { vertices: [], triangles: [] };

  // ALL loops contribute boundary points (outer + holes): hole boundary
  // vertices participate in Delaunay, and the centroid-on-mask filter
  // removes triangles that fall inside holes.
  const boundary: ContourPoint[] = loops.flat();

  // interior sample points: cell centers of fully-covered neighborhoods
  const interior: { x: number; y: number }[] = [];
  for (let y = interiorStep; y < mask.height; y += interiorStep) {
    for (let x = interiorStep; x < mask.width; x += interiorStep) {
      let full = true;
      for (let dy = -1; dy <= 1 && full; dy++) {
        for (let dx = -1; dx <= 1 && full; dx++) {
          const nx = x + dx * Math.max(1, Math.floor(interiorStep / 2));
          const ny = y + dy * Math.max(1, Math.floor(interiorStep / 2));
          if (
            nx < 0 ||
            nx >= mask.width ||
            ny < 0 ||
            ny >= mask.height ||
            mask.data[ny * mask.width + nx] === 0
          ) {
            full = false;
          }
        }
      }
      if (full) interior.push({ x, y });
    }
  }

  const { points, triangles } = triangulateWithBoundary(
    boundary,
    interior,
    options.repairRounds ?? 3,
  );

  // filter: centroid must sit on a set pixel
  const kept: (readonly [number, number, number])[] = [];
  for (const tri of triangles) {
    const cx = (points[tri.a].x + points[tri.b].x + points[tri.c].x) / 3;
    const cy = (points[tri.a].y + points[tri.b].y + points[tri.c].y) / 3;
    const px = Math.floor(cx);
    const py = Math.floor(cy);
    if (px < 0 || px >= mask.width || py < 0 || py >= mask.height) continue;
    if (mask.data[py * mask.width + px] === 0) continue;
    kept.push([tri.a, tri.b, tri.c] as const);
  }

  // drop vertices unreferenced by kept triangles (mask corners outside)
  const used = new Set<number>();
  for (const [a, b, c] of kept) {
    used.add(a);
    used.add(b);
    used.add(c);
  }
  const remap = new Map<number, number>();
  const finalVertices: { x: number; y: number }[] = [];
  for (let i = 0; i < points.length; i++) {
    if (!used.has(i)) continue;
    remap.set(i, finalVertices.length);
    finalVertices.push(points[i]);
  }
  const finalTriangles = kept.map(
    ([a, b, c]) =>
      [remap.get(a) ?? 0, remap.get(b) ?? 0, remap.get(c) ?? 0] as [number, number, number],
  );

  return { vertices: finalVertices, triangles: finalTriangles };
}
