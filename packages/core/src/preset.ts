/**
 * Preset handling: validate → migrate → normalize.
 *
 * - `Preset` is the serializable instance of a `Pipeline` (sections optional).
 * - `validatePreset` rejects malformed JSON shapes and out-of-range values,
 *   collecting ALL problems into one InvalidPresetError, in canonical
 *   document order (input → detect → trim → resize → padding → bleed →
 *   pivot → atlas → output).
 * - `migratePreset` is the versioned upgrade path; only v1 exists today.
 * - `normalizePreset` produces the fully explicit `Pipeline` (defaults filled).
 * - `serializePreset` guarantees `schemaVersion` is the first top-level key.
 *
 * Strictness: unknown keys inside known sections are rejected — a typo like
 * `algoritm` must fail loudly, not silently fall back to defaults.
 */

import { InvalidPresetError, type PresetProblem } from './errors.js';
import { rectProblems } from './rect.js';
import {
  ATLAS_ALGORITHMS,
  DETECT_MODES,
  OUTPUT_FORMATS,
  PIVOT_MODES,
  RESIZE_FILTERS,
  type DetectConfig,
  type ManualRect,
  type Pipeline,
  type Preset,
} from './types.js';

export const CURRENT_PRESET_SCHEMA_VERSION = 1;

// Limits are deliberately explicit so validation and docs cannot drift apart.
const LIMITS = {
  alphaThreshold: { min: 0, max: 255 },
  minPixels: { min: 1, max: 1_000_000 },
  gridCount: { min: 1, max: 10_000 },
  cellSize: { min: 1, max: 16_384 },
  paddingBleed: { min: 0, max: 64 },
  scale: { min: Number.EPSILON, max: 64 },
  atlasSize: { min: 1, max: 16_384 },
  spacing: { min: 0, max: 128 },
} as const;

const DEFAULTS = {
  input: {
    recursive: true,
    include: ['**/*.png'],
    exclude: ['**/output/**'],
  },
  detect: { alphaThreshold: 8, minPixels: 4, connectivity: 8 },
  trim: { enabled: true },
  resize: { enabled: false, mode: 'scale', scale: 1, filter: 'nearest' },
  padding: { pixels: 2 },
  bleed: { pixels: 2 },
  pivot: { mode: 'bottom-center' },
  atlas: { maxWidth: 2048, maxHeight: 2048, algorithm: 'maxrects', spacing: 2 },
  output: {
    format: ['png', 'json'],
    godot: { enabled: false },
    unity: { enabled: false },
  },
} as const;

// ---------------------------------------------------------------------------
// Low-level checks (pure; collect problems instead of throwing)
// ---------------------------------------------------------------------------

type Problem = PresetProblem;

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

function checkObject(v: unknown, path: string, problems: Problem[]): void {
  if (!isRecord(v)) {
    problems.push({ path, message: 'must be an object', code: 'PRESET_MALFORMED' });
  }
}

function checkSchemaVersion(v: unknown, problems: Problem[]): void {
  if (typeof v !== 'number' || !Number.isSafeInteger(v) || v < 1) {
    problems.push({
      path: 'schemaVersion',
      message: `must be a positive integer, got ${JSON.stringify(v)}`,
      code: 'PRESET_MALFORMED',
    });
    return;
  }
  if (v > CURRENT_PRESET_SCHEMA_VERSION) {
    problems.push({
      path: 'schemaVersion',
      message: `unsupported schema version ${v} (this build supports <= ${CURRENT_PRESET_SCHEMA_VERSION})`,
      code: 'PRESET_SCHEMA_VERSION_UNSUPPORTED',
    });
  }
}

function checkEnum(
  v: unknown,
  path: string,
  allowed: readonly string[],
  problems: Problem[],
): void {
  if (typeof v !== 'string' || !allowed.includes(v)) {
    problems.push({
      path,
      message: `must be one of ${allowed.map((a) => JSON.stringify(a)).join(' | ')}, got ${JSON.stringify(v)}`,
      code: 'PRESET_INVALID_VALUE',
    });
  }
}

function checkInt(v: unknown, path: string, min: number, max: number, problems: Problem[]): void {
  if (typeof v !== 'number' || !Number.isSafeInteger(v) || v < min || v > max) {
    problems.push({
      path,
      message: `must be an integer in [${min}, ${max}], got ${JSON.stringify(v)}`,
      code: 'PRESET_INVALID_VALUE',
    });
  }
}

function checkNumber(
  v: unknown,
  path: string,
  min: number,
  max: number,
  problems: Problem[],
): void {
  if (typeof v !== 'number' || !Number.isFinite(v) || v < min || v > max) {
    problems.push({
      path,
      message: `must be a finite number in [${min}, ${max}], got ${JSON.stringify(v)}`,
      code: 'PRESET_INVALID_VALUE',
    });
  }
}

function checkBool(v: unknown, path: string, problems: Problem[]): void {
  if (typeof v !== 'boolean') {
    problems.push({
      path,
      message: `must be a boolean, got ${JSON.stringify(v)}`,
      code: 'PRESET_INVALID_VALUE',
    });
  }
}

function checkStringArray(v: unknown, path: string, problems: Problem[]): void {
  if (!Array.isArray(v) || v.length === 0) {
    problems.push({
      path,
      message: 'must be a non-empty array of strings',
      code: 'PRESET_INVALID_VALUE',
    });
    return;
  }
  v.forEach((entry, i) => {
    if (typeof entry !== 'string' || entry.length === 0) {
      problems.push({
        path: `${path}[${i}]`,
        message: 'must be a non-empty string',
        code: 'PRESET_INVALID_VALUE',
      });
    }
  });
}

function checkUnknownKeys(
  section: Record<string, unknown>,
  known: readonly string[],
  path: string,
  problems: Problem[],
): void {
  for (const key of Object.keys(section)) {
    if (!known.includes(key)) {
      problems.push({
        path: `${path}.${key}`,
        message: `unknown key (allowed: ${known.join(', ')})`,
        code: 'PRESET_UNKNOWN_KEY',
      });
    }
  }
}

// ---------------------------------------------------------------------------
// Section validation — every checker takes (section, path, problems) so the
// same checker can serve identically-shaped sections (padding / bleed).
// ---------------------------------------------------------------------------

function checkInput(raw: Record<string, unknown>, path: string, problems: Problem[]): void {
  checkUnknownKeys(raw, ['format', 'recursive', 'include', 'exclude'], path, problems);
  if (raw.format !== undefined) checkEnum(raw.format, `${path}.format`, ['png'], problems);
  if (raw.recursive !== undefined) checkBool(raw.recursive, `${path}.recursive`, problems);
  if (raw.include !== undefined) checkStringArray(raw.include, `${path}.include`, problems);
  if (raw.exclude !== undefined) checkStringArray(raw.exclude, `${path}.exclude`, problems);
}

function checkDetect(raw: Record<string, unknown>, path: string, problems: Problem[]): void {
  checkUnknownKeys(
    raw,
    [
      'mode',
      'alphaThreshold',
      'minPixels',
      'connectivity',
      'rows',
      'columns',
      'cellWidth',
      'cellHeight',
      'rects',
    ],
    path,
    problems,
  );
  checkEnum(raw.mode, `${path}.mode`, DETECT_MODES, problems);
  if (typeof raw.mode !== 'string') return;

  const mode = raw.mode as DetectConfig['mode'];
  if (raw.alphaThreshold !== undefined && mode !== 'manual') {
    checkInt(
      raw.alphaThreshold,
      `${path}.alphaThreshold`,
      LIMITS.alphaThreshold.min,
      LIMITS.alphaThreshold.max,
      problems,
    );
  }
  if (mode === 'alpha-connected-components') {
    if (raw.minPixels !== undefined) {
      checkInt(
        raw.minPixels,
        `${path}.minPixels`,
        LIMITS.minPixels.min,
        LIMITS.minPixels.max,
        problems,
      );
    }
    if (raw.connectivity !== undefined && raw.connectivity !== 4 && raw.connectivity !== 8) {
      problems.push({
        path: `${path}.connectivity`,
        message: `must be 4 or 8, got ${JSON.stringify(raw.connectivity)}`,
        code: 'PRESET_INVALID_VALUE',
      });
    }
  }
  if (mode === 'grid') {
    const hasCount = raw.rows !== undefined || raw.columns !== undefined;
    const hasCell = raw.cellWidth !== undefined || raw.cellHeight !== undefined;
    if (hasCount && hasCell) {
      problems.push({
        path,
        message: 'grid mode accepts either rows+columns OR cellWidth+cellHeight, not both',
        code: 'PRESET_INVALID_VALUE',
      });
    } else if (!hasCount && !hasCell) {
      problems.push({
        path,
        message: 'grid mode requires rows+columns or cellWidth+cellHeight',
        code: 'PRESET_INVALID_VALUE',
      });
    }
    if (raw.rows !== undefined)
      checkInt(raw.rows, `${path}.rows`, LIMITS.gridCount.min, LIMITS.gridCount.max, problems);
    if (raw.columns !== undefined) {
      checkInt(
        raw.columns,
        `${path}.columns`,
        LIMITS.gridCount.min,
        LIMITS.gridCount.max,
        problems,
      );
    }
    if (raw.cellWidth !== undefined) {
      checkInt(
        raw.cellWidth,
        `${path}.cellWidth`,
        LIMITS.cellSize.min,
        LIMITS.cellSize.max,
        problems,
      );
    }
    if (raw.cellHeight !== undefined) {
      checkInt(
        raw.cellHeight,
        `${path}.cellHeight`,
        LIMITS.cellSize.min,
        LIMITS.cellSize.max,
        problems,
      );
    }
  }
  if (mode === 'manual') {
    if (!Array.isArray(raw.rects) || raw.rects.length === 0) {
      problems.push({
        path: `${path}.rects`,
        message: 'manual mode requires a non-empty rects array',
        code: 'PRESET_INVALID_VALUE',
      });
    } else {
      raw.rects.forEach((rect, i) => {
        for (const p of rectProblems(rect, `${path}.rects[${i}]`)) problems.push(p);
        const r = isRecord(rect) ? rect : {};
        if (r.id !== undefined && (typeof r.id !== 'string' || r.id.length === 0)) {
          problems.push({
            path: `${path}.rects[${i}].id`,
            message: 'must be a non-empty string',
            code: 'PRESET_INVALID_VALUE',
          });
        }
      });
    }
  }
}

function checkTrim(raw: Record<string, unknown>, path: string, problems: Problem[]): void {
  checkUnknownKeys(raw, ['enabled', 'alphaThreshold'], path, problems);
  if (raw.enabled !== undefined) checkBool(raw.enabled, `${path}.enabled`, problems);
  if (raw.alphaThreshold !== undefined) {
    checkInt(
      raw.alphaThreshold,
      `${path}.alphaThreshold`,
      LIMITS.alphaThreshold.min,
      LIMITS.alphaThreshold.max,
      problems,
    );
  }
}

function checkResize(raw: Record<string, unknown>, path: string, problems: Problem[]): void {
  checkUnknownKeys(raw, ['enabled', 'mode', 'scale', 'filter'], path, problems);
  if (raw.enabled !== undefined) checkBool(raw.enabled, `${path}.enabled`, problems);
  if (raw.mode !== undefined) checkEnum(raw.mode, `${path}.mode`, ['scale'], problems);
  if (raw.scale !== undefined)
    checkNumber(raw.scale, `${path}.scale`, LIMITS.scale.min, LIMITS.scale.max, problems);
  if (raw.filter !== undefined) checkEnum(raw.filter, `${path}.filter`, RESIZE_FILTERS, problems);
}

function checkPaddingOrBleed(
  raw: Record<string, unknown>,
  path: string,
  problems: Problem[],
): void {
  checkUnknownKeys(raw, ['pixels'], path, problems);
  if (raw.pixels !== undefined) {
    checkInt(
      raw.pixels,
      `${path}.pixels`,
      LIMITS.paddingBleed.min,
      LIMITS.paddingBleed.max,
      problems,
    );
  }
}

function checkPivot(raw: Record<string, unknown>, path: string, problems: Problem[]): void {
  checkUnknownKeys(raw, ['mode', 'x', 'y'], path, problems);
  checkEnum(raw.mode, `${path}.mode`, PIVOT_MODES, problems);
  if (raw.mode === 'manual') {
    checkNumber(raw.x, `${path}.x`, 0, 1, problems);
    checkNumber(raw.y, `${path}.y`, 0, 1, problems);
  }
}

function checkAtlas(raw: Record<string, unknown>, path: string, problems: Problem[]): void {
  checkUnknownKeys(raw, ['maxWidth', 'maxHeight', 'algorithm', 'spacing'], path, problems);
  if (raw.maxWidth !== undefined) {
    checkInt(
      raw.maxWidth,
      `${path}.maxWidth`,
      LIMITS.atlasSize.min,
      LIMITS.atlasSize.max,
      problems,
    );
  }
  if (raw.maxHeight !== undefined) {
    checkInt(
      raw.maxHeight,
      `${path}.maxHeight`,
      LIMITS.atlasSize.min,
      LIMITS.atlasSize.max,
      problems,
    );
  }
  if (raw.algorithm !== undefined)
    checkEnum(raw.algorithm, `${path}.algorithm`, ATLAS_ALGORITHMS, problems);
  if (raw.spacing !== undefined)
    checkInt(raw.spacing, `${path}.spacing`, LIMITS.spacing.min, LIMITS.spacing.max, problems);
}

function checkOutput(raw: Record<string, unknown>, path: string, problems: Problem[]): void {
  checkUnknownKeys(raw, ['format', 'godot', 'unity'], path, problems);
  if (raw.format !== undefined) {
    if (!Array.isArray(raw.format) || raw.format.length === 0) {
      problems.push({
        path: `${path}.format`,
        message: 'must be a non-empty array',
        code: 'PRESET_INVALID_VALUE',
      });
    } else {
      raw.format.forEach((f, i) => checkEnum(f, `${path}.format[${i}]`, OUTPUT_FORMATS, problems));
      const values = raw.format.filter((f): f is string => typeof f === 'string');
      if (new Set(values).size !== values.length) {
        problems.push({
          path: `${path}.format`,
          message: 'must not contain duplicates',
          code: 'PRESET_INVALID_VALUE',
        });
      }
    }
  }
  for (const key of ['godot', 'unity'] as const) {
    const sub = raw[key];
    if (sub === undefined) continue;
    const subPath = `${path}.${key}`;
    if (!isRecord(sub)) {
      problems.push({ path: subPath, message: 'must be an object', code: 'PRESET_MALFORMED' });
    } else {
      checkUnknownKeys(sub, ['enabled'], subPath, problems);
      if (sub.enabled !== undefined) checkBool(sub.enabled, `${subPath}.enabled`, problems);
    }
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

const TOP_LEVEL_KEYS = [
  'schemaVersion',
  'input',
  'detect',
  'trim',
  'resize',
  'padding',
  'bleed',
  'pivot',
  'atlas',
  'output',
] as const;

/** Validates an unknown value as a Preset. Collects all problems, throws once. */
export function validatePreset(raw: unknown): Preset {
  const problems: Problem[] = [];
  if (!isRecord(raw)) {
    throw new InvalidPresetError([
      { path: '$', message: 'preset must be a JSON object', code: 'PRESET_MALFORMED' },
    ]);
  }
  checkUnknownKeys(raw, TOP_LEVEL_KEYS, '$', problems);
  checkSchemaVersion(raw.schemaVersion, problems);
  // Canonical documented order; mirrors serializePreset's key order so
  // problem lists are deterministic.
  const sectionChecks: readonly [
    'input' | 'detect' | 'trim' | 'resize' | 'padding' | 'bleed' | 'pivot' | 'atlas' | 'output',
    typeof checkInput,
  ][] = [
    ['input', checkInput],
    ['detect', checkDetect],
    ['trim', checkTrim],
    ['resize', checkResize],
    ['padding', checkPaddingOrBleed],
    ['bleed', checkPaddingOrBleed],
    ['pivot', checkPivot],
    ['atlas', checkAtlas],
    ['output', checkOutput],
  ];
  for (const [key, check] of sectionChecks) {
    const section = raw[key];
    if (section === undefined) continue;
    checkObject(section, key, problems);
    if (isRecord(section)) check(section, key, problems);
  }

  if (problems.length > 0) throw new InvalidPresetError(problems);
  return raw as unknown as Preset;
}

/**
 * Versioned migration registry. Only v1 exists; future versions add entries
 * like `2: (p) => upgrade1to2(p)` chained in order.
 */
const MIGRATIONS: ReadonlyMap<
  number,
  (preset: Record<string, unknown>) => Record<string, unknown>
> = new Map([[1, (p) => p]]);

export function migratePreset(preset: Preset): Preset {
  if (preset.schemaVersion > CURRENT_PRESET_SCHEMA_VERSION) {
    throw new InvalidPresetError([
      {
        path: 'schemaVersion',
        message: `cannot migrate from version ${preset.schemaVersion} (supported <= ${CURRENT_PRESET_SCHEMA_VERSION})`,
        code: 'PRESET_SCHEMA_VERSION_UNSUPPORTED',
      },
    ]);
  }
  let current: Record<string, unknown> = preset as unknown as Record<string, unknown>;
  for (let v = preset.schemaVersion; v < CURRENT_PRESET_SCHEMA_VERSION; v++) {
    const migrate = MIGRATIONS.get(v);
    if (!migrate) {
      throw new InvalidPresetError([
        {
          path: 'schemaVersion',
          message: `missing migration step ${v}`,
          code: 'PRESET_MIGRATION_MISSING',
        },
      ]);
    }
    current = migrate(current);
  }
  return current as unknown as Preset;
}

/** Builds a fully explicit Pipeline from a validated Preset. Pure — never mutates the input. */
export function normalizePreset(preset: Preset): Pipeline {
  const input = preset.input ?? {};
  const detectRaw = preset.detect ?? {};
  const trimRaw = preset.trim ?? {};
  const resizeRaw = preset.resize ?? {};
  const paddingRaw = preset.padding ?? {};
  const bleedRaw = preset.bleed ?? {};
  const pivotRaw = preset.pivot ?? {};
  const atlasRaw = preset.atlas ?? {};
  const outputRaw = preset.output ?? {};

  // Detect mode has no default of its own; an absent detect section means
  // "use the tool's default pipeline", which is alpha-CC.
  const detectMode = detectRaw.mode ?? 'alpha-connected-components';

  let detect: DetectConfig;
  if (detectMode === 'alpha-connected-components') {
    detect = {
      mode: 'alpha-connected-components',
      alphaThreshold: detectRaw.alphaThreshold ?? DEFAULTS.detect.alphaThreshold,
      minPixels: detectRaw.minPixels ?? DEFAULTS.detect.minPixels,
      connectivity: (detectRaw.connectivity ?? DEFAULTS.detect.connectivity) as 4 | 8,
    };
  } else if (detectMode === 'grid') {
    detect = {
      mode: 'grid',
      rows: detectRaw.rows,
      columns: detectRaw.columns,
      cellWidth: detectRaw.cellWidth,
      cellHeight: detectRaw.cellHeight,
      alphaThreshold: detectRaw.alphaThreshold ?? DEFAULTS.detect.alphaThreshold,
    };
  } else {
    // validatePreset guarantees a non-empty rects array for manual mode.
    detect = { mode: 'manual', rects: detectRaw.rects as readonly ManualRect[] };
  }

  // trim.alphaThreshold defaults to the RESOLVED detect threshold, not the global default.
  const detectAlpha =
    detectMode === 'manual'
      ? DEFAULTS.detect.alphaThreshold
      : (detect as { alphaThreshold: number }).alphaThreshold;

  const pivot = pivotRaw.mode ?? DEFAULTS.pivot.mode;
  const pipeline: Pipeline = {
    schemaVersion: 1,
    input: {
      format: 'png',
      recursive: input.recursive ?? DEFAULTS.input.recursive,
      include: [...(input.include ?? DEFAULTS.input.include)],
      exclude: [...(input.exclude ?? DEFAULTS.input.exclude)],
    },
    detect,
    trim: {
      enabled: trimRaw.enabled ?? DEFAULTS.trim.enabled,
      alphaThreshold: trimRaw.alphaThreshold ?? detectAlpha,
    },
    resize: {
      enabled: resizeRaw.enabled ?? DEFAULTS.resize.enabled,
      mode: 'scale',
      scale: resizeRaw.scale ?? DEFAULTS.resize.scale,
      filter: resizeRaw.filter ?? DEFAULTS.resize.filter,
    },
    padding: { pixels: paddingRaw.pixels ?? DEFAULTS.padding.pixels },
    bleed: { pixels: bleedRaw.pixels ?? DEFAULTS.bleed.pixels },
    pivot:
      pivot === 'manual'
        ? { mode: 'manual', x: pivotRaw.x as number, y: pivotRaw.y as number }
        : { mode: pivot },
    atlas: {
      maxWidth: atlasRaw.maxWidth ?? DEFAULTS.atlas.maxWidth,
      maxHeight: atlasRaw.maxHeight ?? DEFAULTS.atlas.maxHeight,
      algorithm: atlasRaw.algorithm ?? DEFAULTS.atlas.algorithm,
      spacing: atlasRaw.spacing ?? DEFAULTS.atlas.spacing,
    },
    output: {
      format: [...(outputRaw.format ?? DEFAULTS.output.format)],
      godot: { enabled: outputRaw.godot?.enabled ?? DEFAULTS.output.godot.enabled },
      unity: { enabled: outputRaw.unity?.enabled ?? DEFAULTS.output.unity.enabled },
    },
  };
  return pipeline;
}

/** validate → migrate → normalize. The one entry point consumers should use. */
export function parsePreset(raw: unknown): Pipeline {
  return normalizePreset(migratePreset(validatePreset(raw)));
}

/**
 * Serializes a Pipeline as Preset JSON with `schemaVersion` as the first
 * top-level key (charter requirement). Deterministic: fixed key order,
 * no timestamps.
 */
export function serializePreset(pipeline: Pipeline): string {
  const out = {
    schemaVersion: pipeline.schemaVersion,
    input: {
      format: pipeline.input.format,
      recursive: pipeline.input.recursive,
      include: [...pipeline.input.include],
      exclude: [...pipeline.input.exclude],
    },
    detect: { ...pipeline.detect },
    trim: { ...pipeline.trim },
    resize: { ...pipeline.resize },
    padding: { ...pipeline.padding },
    bleed: { ...pipeline.bleed },
    pivot: { ...pipeline.pivot },
    atlas: { ...pipeline.atlas },
    output: {
      format: [...pipeline.output.format],
      godot: { ...pipeline.output.godot },
      unity: { ...pipeline.output.unity },
    },
  };
  return `${JSON.stringify(out, null, 2)}\n`;
}

function deepFreeze<T>(value: T): T {
  if (typeof value === 'object' && value !== null) {
    for (const key of Object.keys(value as object)) {
      deepFreeze((value as Record<string, unknown>)[key]);
    }
    Object.freeze(value);
  }
  return value;
}

/** The pipeline `init` writes and the one used when no preset section overrides it. */
export const DEFAULT_PIPELINE: Pipeline = deepFreeze(normalizePreset({ schemaVersion: 1 }));
