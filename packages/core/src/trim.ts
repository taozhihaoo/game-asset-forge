import { cropRaster } from './image.js';
import type { RasterImage, Rect } from './types.js';

/**
 * Trim: remove fully transparent border rows/columns.
 * "Foreground" means alpha >= alphaThreshold (same rule as detection).
 */

/** Bounding box of foreground pixels, in input-raster space. Null if none. */
export function computeContentBounds(image: RasterImage, alphaThreshold: number): Rect | null {
  const { width, height, data } = image;
  let minY = -1;
  let maxY = -1;
  let minX = width;
  let maxX = -1;

  for (let y = 0; y < height; y++) {
    const rowStart = y * width;
    for (let x = 0; x < width; x++) {
      if (data[(rowStart + x) * 4 + 3] >= alphaThreshold) {
        if (minY === -1) minY = y;
        maxY = y;
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
      }
    }
  }

  if (minY === -1) return null;
  return { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 };
}

export interface TrimResult {
  /** Tight raster (content only). */
  readonly raster: RasterImage;
  /** Content bounds in the INPUT raster's space. */
  readonly contentRect: Rect;
}

/** Returns null when the raster contains no foreground pixels at all. */
export function trimRaster(image: RasterImage, alphaThreshold: number): TrimResult | null {
  const bounds = computeContentBounds(image, alphaThreshold);
  if (bounds === null) return null;
  return { raster: cropRaster(image, bounds), contentRect: bounds };
}
