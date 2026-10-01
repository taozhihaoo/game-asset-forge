import { ForgeError } from './errors.js';
import { createRasterImage } from './image.js';
import type { RasterImage, ResizeFilter } from './types.js';

/**
 * Resize: scale a raster by a uniform factor, nearest or bilinear.
 *
 * Semantics (pinned in the V1 charter, section 6):
 * - Operates on a single content raster AFTER trim, BEFORE bleed/padding.
 * - Never distorts proportions (uniform scale only).
 * - Output size = max(1, round(width * scale)) x max(1, round(height * scale)).
 * - Channels are interpolated independently in straight (non-premultiplied) alpha.
 * - scale === 1 returns the input unchanged (same reference).
 */

function assertScale(scale: number): void {
  if (typeof scale !== 'number' || !Number.isFinite(scale) || scale <= 0 || scale > 64) {
    throw new ForgeError({
      stage: 'resize',
      code: 'ARGUMENT_OUT_OF_RANGE',
      message: `scale must be a finite number in (0, 64], got ${String(scale)}`,
    });
  }
}

function outputSize(size: number, scale: number): number {
  return Math.max(1, Math.round(size * scale));
}

export function resizeRaster(image: RasterImage, scale: number, filter: ResizeFilter): RasterImage {
  assertScale(scale);
  if (scale === 1) return image;

  const dstW = outputSize(image.width, scale);
  const dstH = outputSize(image.height, scale);
  const out = createRasterImage(dstW, dstH, { hasAlpha: image.hasAlpha });

  if (filter === 'nearest') {
    for (let y = 0; y < dstH; y++) {
      // Center sampling: the destination pixel covers [y, y+1) in dst space;
      // its center maps back to source space and floors to one source pixel.
      const sy = Math.min(image.height - 1, Math.floor((y + 0.5) / scale));
      for (let x = 0; x < dstW; x++) {
        const sx = Math.min(image.width - 1, Math.floor((x + 0.5) / scale));
        const src = (sy * image.width + sx) * 4;
        const dst = (y * dstW + x) * 4;
        out.data[dst] = image.data[src];
        out.data[dst + 1] = image.data[src + 1];
        out.data[dst + 2] = image.data[src + 2];
        out.data[dst + 3] = image.data[src + 3];
      }
    }
    return out;
  }

  // Bilinear. Source coordinate of each dst pixel center, shifted so that
  // pixel centers align (sample at (x+0.5)/scale - 0.5). Edge handling:
  // indices clamp, so out-of-range fracts interpolate between equal pixels.
  for (let y = 0; y < dstH; y++) {
    const syc = (y + 0.5) / scale - 0.5;
    const y0f = Math.floor(syc);
    const fy = syc - y0f;
    const y0 = clampIndex(y0f, image.height - 1);
    const y1 = clampIndex(y0f + 1, image.height - 1);
    for (let x = 0; x < dstW; x++) {
      const sxc = (x + 0.5) / scale - 0.5;
      const x0f = Math.floor(sxc);
      const fx = sxc - x0f;
      const x0 = clampIndex(x0f, image.width - 1);
      const x1 = clampIndex(x0f + 1, image.width - 1);

      const i00 = (y0 * image.width + x0) * 4;
      const i10 = (y0 * image.width + x1) * 4;
      const i01 = (y1 * image.width + x0) * 4;
      const i11 = (y1 * image.width + x1) * 4;
      const dst = (y * dstW + x) * 4;
      for (let c = 0; c < 4; c++) {
        const top = image.data[i00 + c] * (1 - fx) + image.data[i10 + c] * fx;
        const bottom = image.data[i01 + c] * (1 - fx) + image.data[i11 + c] * fx;
        out.data[dst + c] = top * (1 - fy) + bottom * fy; // Uint8ClampedArray rounds + clamps
      }
    }
  }
  return out;
}

function clampIndex(value: number, max: number): number {
  if (value < 0) return 0;
  if (value > max) return max;
  return value;
}
