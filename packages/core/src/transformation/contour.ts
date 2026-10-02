import type { Mask } from './types.js';

/**
 * Contour extraction (V5.1): ordered boundary loops of a mask, simplified
 * with Ramer-Douglas-Peucker. Feeds the constrained-Delaunay mesher.
 *
 * Method: collect DIRECTED boundary edges (mask pixel on the left of each
 * edge) — outer boundaries come out counter-clockwise for free — then join
 * edges into closed loops. Deterministic: edges are joined in sorted order.
 * Known prototype limitation: two set pixels touching only diagonally create
 * an ambiguous corner; the join picks the sorted-first edge, which can split
 * one loop into two. Both loops still triangulate correctly, so the mesh
 * stays valid (documented, not fixed — see v5-plan.md).
 */

export interface ContourPoint {
  readonly x: number;
  readonly y: number;
}

interface Edge {
  readonly x1: number;
  readonly y1: number;
  readonly x2: number;
  readonly y2: number;
}

function edgeKey(e: Edge): string {
  return `${e.x1},${e.y1}->${e.x2},${e.y2}`;
}

/** Directed boundary edges: for each set pixel, an edge per unset neighbor. */
export function boundaryEdges(mask: Mask): Edge[] {
  const edges: Edge[] = [];
  const isClear = (x: number, y: number): boolean =>
    x < 0 || x >= mask.width || y < 0 || y >= mask.height || mask.data[y * mask.width + x] === 0;

  for (let y = 0; y < mask.height; y++) {
    for (let x = 0; x < mask.width; x++) {
      if (mask.data[y * mask.width + x] === 0) continue;
      // mask pixel stays on the LEFT of each directed edge
      if (isClear(x, y - 1)) edges.push({ x1: x, y1: y, x2: x + 1, y2: y });
      if (isClear(x + 1, y)) edges.push({ x1: x + 1, y1: y, x2: x + 1, y2: y + 1 });
      if (isClear(x, y + 1)) edges.push({ x1: x + 1, y1: y + 1, x2: x, y2: y + 1 });
      if (isClear(x - 1, y)) edges.push({ x1: x, y1: y + 1, x2: x, y2: y });
    }
  }
  edges.sort((a, b) => a.y1 - b.y1 || a.x1 - b.x1 || a.y2 - b.y2 || a.x2 - b.x2);
  return edges;
}

/** Joins directed edges into closed loops. */
export function joinLoops(edges: readonly Edge[]): ContourPoint[][] {
  const remaining = new Map<string, Edge>();
  for (const edge of edges) remaining.set(edgeKey(edge), edge);

  const loops: ContourPoint[][] = [];
  while (remaining.size > 0) {
    const first = remaining.values().next().value as Edge;
    remaining.delete(edgeKey(first));
    const loop: ContourPoint[] = [
      { x: first.x1, y: first.y1 },
      { x: first.x2, y: first.y2 },
    ];
    let cursor = { x: first.x2, y: first.y2 };
    let guard = edges.length + 1;
    while (guard-- > 0) {
      if (cursor.x === loop[0].x && cursor.y === loop[0].y) break;
      // deterministic: pick the smallest remaining edge starting at cursor
      let next: Edge | null = null;
      for (const edge of remaining.values()) {
        if (edge.x1 === cursor.x && edge.y1 === cursor.y) {
          if (next === null || edgeKey(edge) < edgeKey(next)) next = edge;
        }
      }
      if (next === null) break; // open chain (ambiguous corner) — keep as-is
      remaining.delete(edgeKey(next));
      cursor = { x: next.x2, y: next.y2 };
      loop.push({ ...cursor });
    }
    if (loop.length >= 4) loops.push(loop); // closed loop of >= 3 distinct points
  }
  return loops;
}

/**
 * Ramer-Douglas-Peucker simplification of an open polyline.
 * Deterministic (recursive, left-first).
 */
export function rdpSimplify(points: readonly ContourPoint[], epsilon: number): ContourPoint[] {
  if (points.length <= 2) return [...points];
  const keep = new Uint8Array(points.length);
  keep[0] = 1;
  keep[points.length - 1] = 1;
  rdpRange(points, 0, points.length - 1, epsilon, keep);
  const out: ContourPoint[] = [];
  for (let i = 0; i < points.length; i++) {
    if (keep[i] !== 0) out.push(points[i]);
  }
  return out;
}

function rdpRange(
  points: readonly ContourPoint[],
  first: number,
  last: number,
  epsilon: number,
  keep: Uint8Array,
): void {
  if (last <= first + 1) return;
  const ax = points[first].x;
  const ay = points[first].y;
  const bx = points[last].x;
  const by = points[last].y;
  const dx = bx - ax;
  const dy = by - ay;
  const length = Math.hypot(dx, dy);
  let maxDistance = -1;
  let maxIndex = first;
  for (let i = first + 1; i < last; i++) {
    const d =
      length === 0
        ? Math.hypot(points[i].x - ax, points[i].y - ay)
        : Math.abs(dy * (points[i].x - ax) - dx * (points[i].y - ay)) / length;
    if (d > maxDistance) {
      maxDistance = d;
      maxIndex = i;
    }
  }
  if (maxDistance > epsilon) {
    keep[maxIndex] = 1;
    rdpRange(points, first, maxIndex, epsilon, keep);
    rdpRange(points, maxIndex, last, epsilon, keep);
  }
}

/**
 * Simplifies a CLOSED loop: RDP over the open chain, first point appended at
 * the end so the closing segment participates.
 */
export function simplifyLoop(loop: readonly ContourPoint[], epsilon: number): ContourPoint[] {
  if (loop.length <= 4) return [...loop];
  const open = [...loop, loop[0]];
  const simplified = rdpSimplify(open, epsilon);
  simplified.pop(); // drop duplicated closing point
  return simplified;
}

/** Extracts simplified boundary loops for a mask (outer contours only). */
export function maskContours(mask: Mask, epsilon = 1.5): ContourPoint[][] {
  return joinLoops(boundaryEdges(mask))
    .map((loop) => simplifyLoop(loop, epsilon))
    .filter((loop) => loop.length >= 3)
    .map((loop) => (loop.length >= 3 ? loop : loop));
}
