import { FORGE_VERSION, type ForgeBone, type ForgeProject } from './types.js';

/**
 * .forge project file (V4 Feature 10, D5): `forgeVersion` is an INDEPENDENT
 * version sequence (never mixed with the preset schemaVersion). Validation
 * collects problems; migration registry mirrors the preset pattern and is
 * ready for forgeVersion 2+.
 */

export interface ForgeProjectProblem {
  readonly path: string;
  readonly message: string;
}

export type RawForgeProject = Record<string, unknown>;

export function validateForgeProject(raw: unknown): ForgeProject {
  const problems: ForgeProjectProblem[] = [];
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error('.forge project must be a JSON object');
  }
  const project = raw as RawForgeProject;

  if (project.forgeVersion !== FORGE_VERSION) {
    problems.push({
      path: 'forgeVersion',
      message: `must be ${FORGE_VERSION}, got ${String(project.forgeVersion)}`,
    });
  }
  const asset = project.asset;
  if (asset === null || typeof asset !== 'object' || Array.isArray(asset)) {
    problems.push({ path: 'asset', message: 'must be an object' });
  } else {
    const record = asset as Record<string, unknown>;
    if (typeof record.source !== 'string' || record.source === '') {
      problems.push({ path: 'asset.source', message: 'must be a non-empty string' });
    }
    if (typeof record.width !== 'number' || record.width < 1) {
      problems.push({ path: 'asset.width', message: 'must be a positive number' });
    }
    if (typeof record.height !== 'number' || record.height < 1) {
      problems.push({ path: 'asset.height', message: 'must be a positive number' });
    }
  }
  for (const key of ['layers', 'bones', 'mesh', 'weights'] as const) {
    const value = project[key];
    if (value !== undefined && !Array.isArray(value)) {
      problems.push({ path: key, message: 'must be an array' });
    }
  }
  // bone graph: parents exist, no cycles
  const bones = (Array.isArray(project.bones) ? project.bones : []) as ForgeBone[];
  const ids = new Set(bones.map((bone) => bone.id));
  for (const bone of bones) {
    if (bone.parent !== null && bone.parent !== undefined && !ids.has(bone.parent)) {
      problems.push({ path: `bones[${bone.name}]`, message: `missing parent '${bone.parent}'` });
    }
  }
  for (const bone of bones) {
    const seen = new Set<string>([bone.id]);
    let cursor: string | null | undefined = bone.parent;
    while (cursor !== null && cursor !== undefined) {
      if (seen.has(cursor)) {
        problems.push({ path: `bones[${bone.name}]`, message: `cycle through '${cursor}'` });
        break;
      }
      seen.add(cursor);
      const parent = bones.find((candidate) => candidate.id === cursor);
      if (parent === undefined) break;
      cursor = parent.parent;
    }
  }

  if (problems.length > 0) {
    const detail = problems.map((p) => `${p.path}: ${p.message}`).join('; ');
    throw new Error(`invalid .forge project — ${detail}`);
  }

  return raw as unknown as ForgeProject;
}

/** Registry pattern (mirrors preset migrations). v1 is the genesis version. */
const FORGE_MIGRATIONS: ReadonlyMap<number, (project: RawForgeProject) => RawForgeProject> =
  new Map([[1, (project) => project]]);

export function migrateForgeProject(raw: unknown): ForgeProject {
  const project = raw as RawForgeProject;
  const version = typeof project?.forgeVersion === 'number' ? project.forgeVersion : -1;
  let current = project;
  for (let v = version; v < FORGE_VERSION; v++) {
    const migrate = FORGE_MIGRATIONS.get(v);
    if (!migrate) {
      throw new Error(`cannot migrate .forge project from forgeVersion ${v}`);
    }
    current = migrate(current);
  }
  return validateForgeProject(current);
}
