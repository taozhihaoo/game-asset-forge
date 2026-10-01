import type { ForgeBone, ForgeWeights } from './types.js';

/**
 * Distance-based initial weights (V4 Feature 7): each vertex gets inverse
 * distance to the two nearest bone positions, normalized to sum = 1.
 * Prototype scope — no manual weight painting (D3/V5).
 */

export interface WeightVertex {
  readonly x: number;
  readonly y: number;
}

function distance(ax: number, ay: number, bx: number, by: number): number {
  return Math.hypot(ax - bx, ay - by);
}

/**
 * `bonePositions` are normalized (layer-content space) bone positions.
 * Vertices must also be normalized. Deterministic: ties break on bone order.
 */
export function computeWeights(
  vertices: readonly WeightVertex[],
  bones: readonly ForgeBone[],
  keepBones = 2,
): ForgeWeights {
  if (bones.length === 0) return { layerId: '', vertices: [] };
  const weighted = vertices.map((vertex) => {
    const scored = bones
      .map((bone) => ({ bone, distance: distance(vertex.x, vertex.y, bone.x, bone.y) }))
      .sort(
        (a, b) =>
          a.distance - b.distance || (a.bone.id < b.bone.id ? -1 : a.bone.id > b.bone.id ? 1 : 0),
      )
      .slice(0, Math.max(1, keepBones));

    const total = scored.reduce(
      (sum, entry) => sum + (entry.distance > 0 ? 1 / entry.distance : 1e6),
      0,
    );
    const weights = scored.map((entry) => ({
      bone: entry.bone.id,
      weight: (entry.distance > 0 ? 1 / entry.distance : 1e6) / (total > 0 ? total : 1),
    }));
    // guarantee exact sum-1 within float tolerance
    const sum = weights.reduce((acc, w) => acc + w.weight, 0);
    return {
      vertex: vertices.indexOf(vertex),
      weights: weights.map((w) => ({ bone: w.bone, weight: w.weight / sum })),
    };
  });
  return { layerId: '', vertices: weighted };
}

export function attachLayerId(
  weights: Omit<ForgeWeights, 'layerId'>,
  layerId: string,
): ForgeWeights {
  return { ...weights, layerId };
}
