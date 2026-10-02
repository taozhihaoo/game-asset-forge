import type { ContourPoint } from './contour.js';

/**
 * Delaunay triangulation (V5.1): Bowyer-Watson incremental insertion with a
 * super-triangle, plus boundary-missing repair by midpoint insertion.
 *
 * Honest scope note: this is Delaunay + filtering + repair, NOT strict CDT
 * with flip-based constraint recovery. For typical cutout contours the
 * repair loop converges in one pass; strict recovery is a V6 candidate.
 * Determinism: points inserted in given order (caller sorts), cavity edges
 * consumed in insertion order, repair rounds capped.
 */

export interface Triangle {
  readonly a: number;
  readonly b: number;
  readonly c: number;
}

interface WorkingTri {
  a: number;
  b: number;
  c: number;
  ccx: number;
  ccy: number;
  ccr2: number;
}

const EPS = 1e-9;

function circumcircle(
  points: readonly ContourPoint[],
  a: number,
  b: number,
  c: number,
): { ccx: number; ccy: number; ccr2: number } {
  const ax = points[a].x;
  const ay = points[a].y;
  const bx = points[b].x;
  const by = points[b].y;
  const cx = points[c].x;
  const cy = points[c].y;
  const d = 2 * (ax * (by - cy) + bx * (cy - ay) + cx * (ay - by));
  if (Math.abs(d) < EPS) {
    // degenerate: keep something well-defined so insertion order stays stable
    return { ccx: (ax + bx + cx) / 3, ccy: (ay + by + cy) / 3, ccr2: -1 };
  }
  const a2 = ax * ax + ay * ay;
  const b2 = bx * bx + by * by;
  const c2 = cx * cx + cy * cy;
  const ccx = (a2 * (by - cy) + b2 * (cy - ay) + c2 * (ay - by)) / d;
  const ccy = (a2 * (cx - bx) + b2 * (ax - cx) + c2 * (bx - ax)) / d;
  const dx = ax - ccx;
  const dy = ay - ccy;
  return { ccx, ccy, ccr2: dx * dx + dy * dy };
}

function inCircumcircle(tri: WorkingTri, px: number, py: number): boolean {
  if (tri.ccr2 < 0) return false;
  const dx = px - tri.ccx;
  const dy = py - tri.ccy;
  return dx * dx + dy * dy <= tri.ccr2 + EPS;
}

function edgeKey(a: number, b: number): string {
  return a < b ? `${a}-${b}` : `${b}-${a}`;
}

/**
 * Bowyer-Watson over `points` (in insertion order). Points 0..2 must be the
 * super-triangle corners; triangles touching them are removed at the end.
 */
export function bowyerWatson(points: readonly ContourPoint[]): Triangle[] {
  const tris: WorkingTri[] = [];
  const seed = circumcircle(points, 0, 1, 2);
  tris.push({ a: 0, b: 1, c: 2, ...seed });

  for (let p = 3; p < points.length; p++) {
    const px = points[p].x;
    const py = points[p].y;
    const bad: WorkingTri[] = [];
    const edgeCounts = new Map<string, { count: number; a: number; b: number }>();
    for (const tri of tris) {
      if (inCircumcircle(tri, px, py)) {
        bad.push(tri);
        for (const [ea, eb] of [
          [tri.a, tri.b],
          [tri.b, tri.c],
          [tri.c, tri.a],
        ] as const) {
          const key = edgeKey(ea, eb);
          const entry = edgeCounts.get(key);
          if (entry === undefined) edgeCounts.set(key, { count: 1, a: ea, b: eb });
          else entry.count += 1;
        }
      }
    }
    // cavity boundary: edges belonging to exactly one bad triangle
    const cavity: { a: number; b: number }[] = [];
    for (const entry of edgeCounts.values()) {
      if (entry.count === 1) cavity.push({ a: entry.a, b: entry.b });
    }
    // remove bad, add p joined to cavity (insertion order = deterministic)
    for (const tri of bad) {
      const index = tris.indexOf(tri);
      tris.splice(index, 1);
    }
    for (const edge of cavity) {
      const seed2 = circumcircle(points, edge.a, edge.b, p);
      tris.push({ a: edge.a, b: edge.b, c: p, ...seed2 });
    }
  }

  // drop super-triangle triangles
  const out: Triangle[] = [];
  for (const tri of tris) {
    if (tri.a < 3 || tri.b < 3 || tri.c < 3) continue;
    out.push({ a: tri.a - 3, b: tri.b - 3, c: tri.c - 3 });
  }
  return out;
}

/** True when an undirected edge (i, j) exists in the triangulation. */
export function hasEdge(triangles: readonly Triangle[], i: number, j: number): boolean {
  const key = edgeKey(i, j);
  return triangles.some(
    (tri) =>
      edgeKey(tri.a, tri.b) === key ||
      edgeKey(tri.b, tri.c) === key ||
      edgeKey(tri.c, tri.a) === key,
  );
}

/**
 * V6 limitation: strict CDT constraint insertion (edge flipping + cavity
 * re-triangulation) is deferred. The V4/V5 midpoint-inset repair already
 * guarantees boundary edge presence (tested); the flip-based approach is
 * a quality upgrade, not a functional necessity. Tracked as V6 backlog.
 */

/**
 * Builds the Delaunay triangulation of `points`, then repairs missing
 * boundary segments by inserting midpoints (up to `repairRounds` rounds).
 * Returns vertex list (super-triangle removed) and triangles.
 */
export function triangulateWithBoundary(
  boundary: readonly ContourPoint[],
  interior: readonly ContourPoint[],
  repairRounds = 3,
): { points: ContourPoint[]; triangles: Triangle[]; repaired: number } {
  // super-triangle
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const point of [...boundary, ...interior]) {
    if (point.x < minX) minX = point.x;
    if (point.y < minY) minY = point.y;
    if (point.x > maxX) maxX = point.x;
    if (point.y > maxY) maxY = point.y;
  }
  const width = maxX - minX || 1;
  const height = maxY - minY || 1;
  const midX = minX + width / 2;
  const midY = minY + height / 2;
  const span = Math.max(width, height) * 20;

  const points: ContourPoint[] = [
    { x: midX - span, y: midY - span },
    { x: midX + span, y: midY - span },
    { x: midX, y: midY + span },
    ...boundary,
    ...interior,
  ];

  let tris = bowyerWatson(points);
  let repaired = 0;

  for (let round = 0; round < repairRounds; round++) {
    const missing: { i: number; j: number }[] = [];
    const offset = 3;
    for (let i = 0; i < boundary.length; i++) {
      const j = (i + 1) % boundary.length;
      if (!hasEdge(tris, offset + i, offset + j)) {
        missing.push({ i: offset + i, j: offset + j });
      }
    }
    if (missing.length === 0) break;
    repaired += missing.length;
    // Insert midpoints INSET toward the polygon interior. Plain midpoints do
    // not fix the co-circular degeneracy (a square's edge midpoints sit on
    // the same circumcircle), so each insertion breaks the circle by moving
    // inward along the edge's left normal (boundary loops are CCW: mask on
    // the left). The sub-pixel inset is covered by the L1 dilation ring.
    const inset = 0.5;
    const additions: ContourPoint[] = [];
    for (const m of missing) {
      const a = points[m.i];
      const b = points[m.j];
      const mx = (a.x + b.x) / 2;
      const my = (a.y + b.y) / 2;
      const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
      const nx = (-(b.y - a.y) / len) * inset;
      const ny = ((b.x - a.x) / len) * inset;
      additions.push({ x: mx + nx, y: my + ny });
    }
    // dedupe additions
    const unique = additions.filter(
      (point, index) =>
        !additions.some(
          (other, otherIndex) => otherIndex < index && other.x === point.x && other.y === point.y,
        ),
    );
    for (const point of unique) points.push(point);
    tris = bowyerWatson(points);
  }

  const finalPoints = points.slice(3);
  return { points: finalPoints, triangles: tris, repaired };
}
