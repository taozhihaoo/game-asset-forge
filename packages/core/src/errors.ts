/**
 * Typed error hierarchy. One class per failure kind, a stable `code` for
 * programmatic handling, and a `stage` for reporting. Deliberately small
 * (V1 charter, section 28: no dozens of exception types).
 */

export const FORGE_STAGES = [
  'input',
  'decode',
  'preset',
  'detect',
  'trim',
  'resize',
  'bleed',
  'pack',
  'export',
] as const;
export type ForgeStage = (typeof FORGE_STAGES)[number];

export interface ForgeErrorOptions {
  readonly stage: ForgeStage;
  readonly code: string;
  readonly message: string;
  /** '/'-normalized source reference, when the error is tied to one input. */
  readonly source?: string;
  readonly cause?: unknown;
}

export class ForgeError extends Error {
  readonly stage: ForgeStage;
  readonly code: string;
  readonly source?: string;

  constructor(options: ForgeErrorOptions) {
    super(options.message, { cause: options.cause });
    this.name = new.target.name;
    this.stage = options.stage;
    this.code = options.code;
    if (options.source !== undefined) this.source = options.source;
  }
}

export class InvalidImageError extends ForgeError {
  constructor(message: string, source?: string, cause?: unknown) {
    super({ stage: 'decode', code: 'IMAGE_INVALID', message, source, cause });
  }
}

export class UnsupportedFormatError extends ForgeError {
  constructor(message: string, source?: string) {
    super({ stage: 'input', code: 'FORMAT_UNSUPPORTED', message, source });
  }
}

/** PNG without an alpha channel: alpha-CC detection is impossible on it (Phase 0 amendment ①). */
export class NoAlphaChannelError extends ForgeError {
  constructor(message: string, source?: string) {
    super({ stage: 'detect', code: 'NO_ALPHA_CHANNEL', message, source });
  }
}

export class InvalidRectError extends ForgeError {
  constructor(message: string, source?: string) {
    super({ stage: 'detect', code: 'RECT_INVALID', message, source });
  }
}

export interface PresetProblem {
  /** JSON-path-like location, e.g. "detect.alphaThreshold". */
  readonly path: string;
  readonly message: string;
  readonly code: string;
}

export class InvalidPresetError extends ForgeError {
  readonly problems: readonly PresetProblem[];

  constructor(problems: readonly PresetProblem[]) {
    const summary =
      problems.length === 1
        ? `${problems[0].path}: ${problems[0].message}`
        : `${problems.length} problems: ${problems.map((p) => p.path).join(', ')}`;
    super({
      stage: 'preset',
      code: problems[0]?.code ?? 'PRESET_INVALID',
      message: `Invalid preset — ${summary}`,
    });
    this.problems = problems;
  }
}

export class NoSpritesFoundError extends ForgeError {
  constructor(message: string, source?: string) {
    super({ stage: 'detect', code: 'NO_SPRITES_FOUND', message, source });
  }
}

export class AtlasPackingError extends ForgeError {
  constructor(message: string, source?: string) {
    super({ stage: 'pack', code: 'ATLAS_PACKING_FAILED', message, source });
  }
}

export class ExportError extends ForgeError {
  constructor(message: string, source?: string, cause?: unknown) {
    super({ stage: 'export', code: 'EXPORT_FAILED', message, source, cause });
  }
}
