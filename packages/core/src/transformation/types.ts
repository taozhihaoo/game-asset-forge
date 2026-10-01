import type { Rect } from '../types.js';

/**
 * Cutout/rig data model (V4) — deterministic, environment-free.
 * Coordinate spaces (doc D5/D6/D10):
 * - masks and layer rasters live in SOURCE SPACE (same size as the source);
 * - bone positions are NORMALIZED against the layer content rect (D6),
 *   origin top-left;
 * - layers carry an explicit z order (D10).
 */

/** Single-channel mask: 255 = inside the layer, 0 = outside. Source space. */
export interface Mask {
  readonly width: number;
  readonly height: number;
  readonly data: Uint8Array;
}

export interface MaskRegion {
  readonly id: string;
  /** Suggested layer name (mock segmentation names by z order). */
  readonly name: string;
  readonly mask: Mask;
}

export const FORGE_VERSION = 1;

export interface ForgeLayer {
  readonly id: string;
  readonly name: string;
  /** Explicit z order: higher = drawn later (on top). */
  readonly z: number;
  /** Content bounds in SOURCE SPACE (mask bounding box, pre-expansion). */
  readonly sourceRect: Rect;
  /** Cell expansion in px on all sides (Level 1 dilation radius used). */
  readonly dilation: number;
  readonly maskFile?: string;
  readonly rasterFile?: string;
}

export interface ForgeBone {
  readonly id: string;
  readonly name: string;
  /** Parent bone id; null for the root. */
  readonly parent: string | null;
  /** Normalized position against the LAYER content rect (D6). */
  readonly x: number;
  readonly y: number;
}

export interface ForgeMesh {
  readonly layerId: string;
  /** Grid vertices in layer-content normalized coordinates. */
  readonly vertices: readonly { readonly x: number; readonly y: number }[];
  /** Triangles as triples of vertex indices, CCW. */
  readonly triangles: readonly (readonly [number, number, number])[];
}

export interface ForgeWeights {
  readonly layerId: string;
  /** Per-vertex weights; each entry sums to 1 across its bones. */
  readonly vertices: readonly {
    readonly vertex: number;
    readonly weights: readonly { readonly bone: string; readonly weight: number }[];
  }[];
}

export interface ForgeProject {
  readonly forgeVersion: 1;
  readonly asset: {
    /** Project-relative path of the source image. */
    readonly source: string;
    readonly width: number;
    readonly height: number;
  };
  readonly layers: readonly ForgeLayer[];
  readonly bones: readonly ForgeBone[];
  readonly mesh: readonly ForgeMesh[];
  readonly weights: readonly ForgeWeights[];
  readonly animationTemplates: readonly string[];
}

export function createMask(width: number, height: number): Mask {
  return { width, height, data: new Uint8Array(width * height) };
}

export function maskFromRect(width: number, height: number, rect: Rect): Mask {
  const mask = createMask(width, height);
  for (let y = rect.y; y < rect.y + rect.height; y++) {
    for (let x = rect.x; x < rect.x + rect.width; x++) {
      if (x >= 0 && x < width && y >= 0 && y < height) mask.data[y * width + x] = 255;
    }
  }
  return mask;
}

export function cloneMask(mask: Mask): Mask {
  return { width: mask.width, height: mask.height, data: new Uint8Array(mask.data) };
}

/** True when any pixel of `mask` overlaps `region`. */
export function masksOverlap(mask: Mask, region: Mask): boolean {
  const width = Math.min(mask.width, region.width);
  const height = Math.min(mask.height, region.height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (mask.data[y * mask.width + x] !== 0 && region.data[y * region.width + x] !== 0)
        return true;
    }
  }
  return false;
}

/** Bounding box of set pixels, in mask space. Null when empty. */
export function maskBounds(mask: Mask): Rect | null {
  let minX = mask.width;
  let minY = mask.height;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < mask.height; y++) {
    for (let x = 0; x < mask.width; x++) {
      if (mask.data[y * mask.width + x] !== 0) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < 0) return null;
  return { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 };
}
