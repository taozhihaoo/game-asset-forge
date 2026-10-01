/**
 * GameAsset Forge — Core domain types.
 *
 * Core is UI-independent and IO-independent. It only ever receives and returns
 * typed values (raster data, pipeline configs, manifests). See the four-space
 * coordinate model below before touching any Rect semantics.
 *
 * FOUR-SPACE MODEL (authoritative; every stage must document which space it works in):
 *
 *  1. SOURCE SPACE   — the original input image. Detection rects and
 *                      `Sprite.sourceRect` / `Sprite.trimmedRect` live here.
 *  2. CONTENT SPACE  — sourceRect minus transparent border (= trimmedRect).
 *                      Pivot coordinates are normalized [0,1] against this rect.
 *  3. CELL SPACE     — the processed sprite raster: content, optionally resized,
 *                      plus a transparent `padding` margin and `bleed` extrusion
 *                      baked into the raster on all sides.
 *  4. PAGE SPACE     — atlas page coordinates. `AtlasPlacement.rect` and the
 *                      manifest `rect` (the packed cell) live here.
 *
 * SPACING FORMULA (pinned in Phase 0 review, amendment ②):
 *   - `padding.pixels`  — transparent margin baked into each cell raster.
 *   - `bleed.pixels`    — edge-extrusion baked into each cell raster.
 *   - `atlas.spacing`   — minimum transparent gap BETWEEN packed cells.
 *   Effective transparent distance between two sprites' content pixels:
 *     bleed(A) + padding(A) + spacing + padding(B) + bleed(B)
 *   Because padding/bleed are baked into the cell, there is NO constraint
 *   between bleed and spacing; cell size = content + 2*(padding + bleed).
 */

import type { QualityConfig } from './quality/models.js';

// ---------------------------------------------------------------------------
// Geometry
// ---------------------------------------------------------------------------

export interface ImageSize {
  readonly width: number;
  readonly height: number;
}

export interface Point {
  readonly x: number;
  readonly y: number;
}

/** Integer rectangle. `width`/`height` are always >= 1; origin top-left. */
export interface Rect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/**
 * Normalized pivot: x,y in [0,1], origin top-left, y pointing down,
 * ALWAYS relative to the content (trimmed) rect — never the cell raster
 * and never engine-specific conventions. Exporters convert per-engine.
 */
export interface Pivot {
  readonly x: number;
  readonly y: number;
}

// ---------------------------------------------------------------------------
// Raster
// ---------------------------------------------------------------------------

export const PIXEL_FORMAT_RGBA8 = 'rgba8' as const;
export type PixelFormat = typeof PIXEL_FORMAT_RGBA8;

/**
 * Row-major RGBA, 8 bits per channel.
 * `data.length` must equal `width * height * 4`. No gamma, no premultiply.
 *
 * `hasAlpha` reflects the SOURCE format (e.g. the PNG IHDR color type), not
 * the buffer layout — decoders always produce RGBA buffers. It drives the
 * no-alpha contract: alpha-based detection is impossible on RGB sources
 * (Phase 0 review amendment ①).
 */
export interface RasterImage {
  readonly format: PixelFormat;
  readonly hasAlpha: boolean;
  readonly width: number;
  readonly height: number;
  readonly data: Uint8ClampedArray;
}

// ---------------------------------------------------------------------------
// Detection
// ---------------------------------------------------------------------------

export const DETECT_MODES = ['alpha-connected-components', 'grid', 'manual'] as const;
export type DetectionMode = (typeof DETECT_MODES)[number];

/** A user-supplied rectangle in SOURCE SPACE (detection mode `manual`). */
export interface ManualRect extends Rect {
  readonly id?: string;
}

export type DetectConfig =
  | {
      readonly mode: 'alpha-connected-components';
      /** alpha >= threshold counts as foreground. Integer [0,255]. Default 8. */
      readonly alphaThreshold: number;
      /** Components with fewer foreground pixels are discarded. Default 4. */
      readonly minPixels: number;
      /** Pixel connectivity for labeling. Default 8. */
      readonly connectivity: 4 | 8;
    }
  | {
      readonly mode: 'grid';
      /** Exactly one form: rows+columns (derive cell size) or cellWidth+cellHeight (derive counts). */
      readonly rows?: number;
      readonly columns?: number;
      readonly cellWidth?: number;
      readonly cellHeight?: number;
      /** Cells containing zero foreground pixels are dropped. Integer [0,255]. Default 8. */
      readonly alphaThreshold: number;
    }
  | {
      readonly mode: 'manual';
      /** Non-empty; every rect is bounds-validated against the source image. */
      readonly rects: readonly ManualRect[];
    };

// ---------------------------------------------------------------------------
// Pipeline (normalized internal structure — defaults filled, fully explicit)
// ---------------------------------------------------------------------------

export const RESIZE_FILTERS = ['nearest', 'linear'] as const;
export type ResizeFilter = (typeof RESIZE_FILTERS)[number];

export const PIVOT_MODES = ['center', 'bottom-center', 'manual'] as const;
export type PivotMode = (typeof PIVOT_MODES)[number];

export const ATLAS_ALGORITHMS = ['maxrects'] as const;
export type AtlasAlgorithm = (typeof ATLAS_ALGORITHMS)[number];

export const OUTPUT_FORMATS = ['png', 'json'] as const;
export type OutputFormat = (typeof OUTPUT_FORMATS)[number];

export interface Pipeline {
  readonly schemaVersion: 1;
  readonly input: {
    readonly format: 'png';
    readonly recursive: boolean;
    /** Glob patterns relative to the input root, '/'-separated. Default ['**\/*.png']. */
    readonly include: readonly string[];
    readonly exclude: readonly string[];
  };
  readonly detect: DetectConfig;
  readonly trim: {
    readonly enabled: boolean;
    /** Independent from detect threshold; normalize() defaults it to the resolved detect threshold. */
    readonly alphaThreshold: number;
  };
  readonly resize: {
    readonly enabled: boolean;
    readonly mode: 'scale';
    /** > 0, <= 64. Applied per content raster, before padding/bleed. */
    readonly scale: number;
    readonly filter: ResizeFilter;
  };
  /** Transparent margin baked into every cell raster. Integer [0,64]. */
  readonly padding: { readonly pixels: number };
  /** Edge extrusion baked into every cell raster. Integer [0,64]. */
  readonly bleed: { readonly pixels: number };
  readonly pivot:
    | { readonly mode: 'center' }
    | { readonly mode: 'bottom-center' }
    | { readonly mode: 'manual'; readonly x: number; readonly y: number };
  readonly atlas: {
    readonly maxWidth: number;
    readonly maxHeight: number;
    readonly algorithm: AtlasAlgorithm;
    /** Minimum gap between packed cells. Integer [0,128]. */
    readonly spacing: number;
  };
  readonly output: {
    readonly format: readonly OutputFormat[];
    readonly godot: { readonly enabled: boolean };
    readonly unity: { readonly enabled: boolean };
  };
  /** Asset Quality Assistant configuration (V2, schemaVersion 2+). */
  readonly quality: QualityConfig;
}

// ---------------------------------------------------------------------------
// Preset (serializable instance of a Pipeline — sections optional, defaults applied later)
// ---------------------------------------------------------------------------

/**
 * A Preset is a saved instance of a Pipeline. Every section except
 * `schemaVersion` is optional; `normalizePreset()` fills defaults.
 * On disk, `schemaVersion` must be present; serializers emit it as the
 * first top-level key.
 */
export interface Preset {
  readonly schemaVersion: number;
  readonly input?: Partial<Pipeline['input']>;
  readonly detect?: {
    readonly mode?: DetectionMode;
    readonly alphaThreshold?: number;
    readonly minPixels?: number;
    readonly connectivity?: 4 | 8;
    readonly rows?: number;
    readonly columns?: number;
    readonly cellWidth?: number;
    readonly cellHeight?: number;
    readonly rects?: readonly ManualRect[];
  };
  readonly trim?: Partial<Pipeline['trim']>;
  readonly resize?: Partial<Pipeline['resize']>;
  readonly padding?: { readonly pixels?: number };
  readonly bleed?: { readonly pixels?: number };
  readonly pivot?: { readonly mode?: PivotMode; readonly x?: number; readonly y?: number };
  readonly atlas?: Partial<Pipeline['atlas']>;
  readonly output?: {
    readonly format?: readonly OutputFormat[];
    readonly godot?: { readonly enabled?: boolean };
    readonly unity?: { readonly enabled?: boolean };
  };
  /** Quality Assistant configuration (schemaVersion 2+; absent in v1 files). */
  readonly quality?: Partial<QualityConfig>;
}

// ---------------------------------------------------------------------------
// Sprites / Atlas / Manifest
// ---------------------------------------------------------------------------

/** A sprite somewhere in the pipeline. All rects are in their documented spaces. */
export interface Sprite {
  /** Stable ID: "<normalized source path>#sprite-NNNN" or manual rect id. No UUIDs/timestamps. */
  readonly id: string;
  /** '/'-separated source-relative path (normalized by the caller; core never touches fs). */
  readonly sourcePath: string;
  /** Detection rect in SOURCE SPACE (what detection returned for this sprite). */
  readonly sourceRect: Rect;
  /** Content bounds after trim, in SOURCE SPACE. Equals sourceRect when trim
   *  is disabled or the detection rect was already tight. */
  readonly trimmedRect: Rect;
  /** Current cell raster (CELL SPACE): content + optional resize + padding + bleed margins. */
  readonly raster: RasterImage;
  /** Normalized against CONTENT SPACE (see Pivot docs). */
  readonly pivot: Pivot;
}

export interface SpriteSet {
  readonly sourcePath: string;
  readonly image: RasterImage;
  readonly sprites: readonly Sprite[];
}

/** Cell rect of one sprite on an atlas page (PAGE SPACE). */
export interface AtlasPlacement {
  readonly spriteId: string;
  readonly rect: Rect;
}

export interface AtlasPage {
  readonly index: number;
  readonly width: number;
  readonly height: number;
  readonly placements: readonly AtlasPlacement[];
}

export interface Atlas {
  readonly pages: readonly AtlasPage[];
}

/** Per-sprite manifest record. All rects/pivots in their documented spaces. */
export interface ManifestSprite {
  readonly id: string;
  readonly page: number;
  /** Packed CELL rect on the page (PAGE SPACE). */
  readonly rect: Rect;
  /** Detection rect in the source image (SOURCE SPACE). */
  readonly sourceRect: Rect;
  /** Content bounds after trim, in the source image (SOURCE SPACE). */
  readonly trimmedRect: Rect;
  /** Normalized against content (CONTENT SPACE). */
  readonly pivot: Pivot;
}

export interface ExportManifest {
  readonly schemaVersion: 1;
  readonly generator: { readonly name: 'gameasset-forge'; readonly version: string };
  readonly source: string;
  readonly pages: readonly {
    readonly file: string;
    readonly width: number;
    readonly height: number;
  }[];
  readonly sprites: readonly ManifestSprite[];
}
