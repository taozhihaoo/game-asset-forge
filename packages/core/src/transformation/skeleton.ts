import type { ForgeBone, ForgeLayer } from './types.js';

/**
 * Rig proposal (V4 Feature 5): template skeletons in normalized layer
 * coordinates (D6). Limited deformation ±5–15° — these proposals seed the
 * editor, they are not animation rigs (D3/D8).
 */

export type RigTemplateId = 'human' | 'animal' | 'monster';

export interface RigTemplateBone {
  readonly id: string;
  readonly name: string;
  readonly parent: string | null;
  readonly x: number;
  readonly y: number;
}

const TEMPLATES: Record<RigTemplateId, readonly RigTemplateBone[]> = {
  human: [
    { id: 'root', name: 'root', parent: null, x: 0.5, y: 0.72 },
    { id: 'body', name: 'body', parent: 'root', x: 0.5, y: 0.45 },
    { id: 'head', name: 'head', parent: 'body', x: 0.5, y: 0.12 },
    { id: 'arm_l', name: 'arm_l', parent: 'body', x: 0.22, y: 0.48 },
    { id: 'arm_r', name: 'arm_r', parent: 'body', x: 0.78, y: 0.48 },
    { id: 'leg_l', name: 'leg_l', parent: 'root', x: 0.38, y: 0.98 },
    { id: 'leg_r', name: 'leg_r', parent: 'root', x: 0.62, y: 0.98 },
  ],
  animal: [
    { id: 'root', name: 'root', parent: null, x: 0.5, y: 0.62 },
    { id: 'spine', name: 'spine', parent: 'root', x: 0.5, y: 0.45 },
    { id: 'head', name: 'head', parent: 'spine', x: 0.82, y: 0.3 },
    { id: 'leg_fl', name: 'leg_fl', parent: 'spine', x: 0.72, y: 0.95 },
    { id: 'leg_fr', name: 'leg_fr', parent: 'spine', x: 0.78, y: 0.95 },
    { id: 'leg_bl', name: 'leg_bl', parent: 'root', x: 0.22, y: 0.95 },
    { id: 'leg_br', name: 'leg_br', parent: 'root', x: 0.28, y: 0.95 },
  ],
  monster: [
    { id: 'root', name: 'root', parent: null, x: 0.5, y: 0.75 },
    { id: 'body', name: 'body', parent: 'root', x: 0.5, y: 0.5 },
    { id: 'head', name: 'head', parent: 'body', x: 0.5, y: 0.18 },
    { id: 'arm_l', name: 'arm_l', parent: 'body', x: 0.12, y: 0.55 },
    { id: 'arm_r', name: 'arm_r', parent: 'body', x: 0.88, y: 0.55 },
  ],
};

export const RIG_TEMPLATES: readonly RigTemplateId[] = ['human', 'animal', 'monster'];

export function proposeRig(template: RigTemplateId): ForgeBone[] {
  return TEMPLATES[template].map((bone) => ({ ...bone }));
}

/** Parent references must exist and the graph must be acyclic. */
export function validateRig(bones: readonly ForgeBone[]): string[] {
  const problems: string[] = [];
  const byId = new Map(bones.map((bone) => [bone.id, bone]));
  for (const bone of bones) {
    if (bone.parent !== null && !byId.has(bone.parent)) {
      problems.push(`bone '${bone.id}': missing parent '${bone.parent}'`);
    }
  }
  for (const bone of bones) {
    const seen = new Set<string>([bone.id]);
    let cursor = bone.parent;
    while (cursor !== null) {
      if (seen.has(cursor)) {
        problems.push(`bone '${bone.id}': cycle through '${cursor}'`);
        break;
      }
      seen.add(cursor);
      const parent = byId.get(cursor);
      if (parent === undefined) break; // already reported as missing
      cursor = parent.parent;
    }
  }
  return problems;
}

/** Layers a rig proposal applies to (V4 prototype: every layer). */
export function rigForLayer(layer: ForgeLayer, template: RigTemplateId): ForgeBone[] {
  void layer;
  return proposeRig(template);
}
