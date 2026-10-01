import type { Pivot, RasterImage } from '../types.js';

/**
 * Asset Quality Assistant — data model (V2).
 *
 * Determinism contracts (charter §12 discipline applied to reports):
 * - rules execute in the fixed QUALITY_RULES order;
 * - assets are reported sorted by name;
 * - no Map iteration order, no timestamps reach the report.
 */

export const QUALITY_RULES = [
  'naming_convention',
  'transparent_area',
  'size_mismatch',
  'duplicate_frames',
  'pivot_check',
] as const;
export type QualityRule = (typeof QUALITY_RULES)[number];

export const QUALITY_SEVERITIES = ['high', 'medium', 'low', 'info'] as const;
export type QualitySeverity = (typeof QUALITY_SEVERITIES)[number];

export interface QualityIssue {
  readonly rule: QualityRule;
  readonly severity: QualitySeverity;
  readonly message: string;
  readonly suggestion: string;
}

/**
 * One analyzable asset. `byteSize` (encoded file size) and `pivot` are
 * optional metadata the caller may inject; rules degrade gracefully when
 * absent (amendment B5: the CLI layer owns real file sizes).
 */
export interface AssetFile {
  /** '/'-normalized relative path or bare file name. */
  readonly name: string;
  readonly raster: RasterImage;
  readonly byteSize?: number;
  readonly pivot?: Pivot;
}

export interface AssetReport {
  readonly asset: string;
  readonly warnings: readonly QualityIssue[];
}

export interface QualityReport {
  readonly version: 2;
  readonly assets: number;
  readonly warnings: number;
  readonly issues: readonly AssetReport[];
}

export interface QualityConfig {
  /** Fully transparent pixel ratio above which a warning fires. Default 0.6. */
  readonly maxTransparentRatio: number;
  /** dHash Hamming distance ≤ this counts as a near duplicate. Default 5. */
  readonly duplicateHammingThreshold: number;
  /** Name patterns (case-insensitive regex on the stem) marking characters. Default []. */
  readonly characterPatterns: readonly string[];
  /** Name patterns marking non-descriptive names. Absent = built-in defaults. */
  readonly nonDescriptivePatterns: readonly string[];
}

function freezeDeep<T>(value: T): T {
  if (typeof value === 'object' && value !== null) {
    for (const key of Object.keys(value as object)) {
      freezeDeep((value as Record<string, unknown>)[key]);
    }
    Object.freeze(value);
  }
  return value;
}

export const DEFAULT_NON_DESCRIPTIVE_PATTERNS: readonly string[] = [
  '^img[ _-]?\\d+$',
  '^(final|new|copy|test|untitled)\\d*$',
  '^aaa\\d*$',
];

export const DEFAULT_QUALITY_CONFIG: QualityConfig = freezeDeep({
  maxTransparentRatio: 0.6,
  duplicateHammingThreshold: 5,
  characterPatterns: [],
  nonDescriptivePatterns: DEFAULT_NON_DESCRIPTIVE_PATTERNS,
});
