import { ForgeError } from './errors.js';
import { createRasterImage } from './image.js';
import type { RasterImage } from './types.js';

/**
 * Bleed (edge extrusion) and padding (transparent margin).
 *
 * Both bake margins into the cell raster (Phase 0 review amendment ②):
 *   cell = content + 2*bleed (edge-replicated ring) + 2*padding (transparent ring)
 * so the atlas packer needs no bleed-vs-spacing constraint.
 *
 * Pipeline order: trim → resize → applyBleed → applyPadding → pack.
 */

function assertMarginPixels(pixels: number, stage: 'bleed' | 'padding'): void {
  if (!Number.isSafeInteger(pixels) || pixels < 0 || pixels > 64) {
    // 'padding' is not a charter stage; margin validation reports under 'bleed'.
    throw new ForgeError({
      stage: 'bleed',
      code: 'ARGUMENT_OUT_OF_RANGE',
      message: `${stage} pixels must be an integer in [0, 64], got ${String(pixels)}`,
    });
  }
}

/**
 * Extrudes edge pixels outward by `pixels` on all sides. Every outside pixel
 * samples the nearest edge pixel (clamped sampling), which replicates corners
 * diagonally — the standard "extrude" behavior that defeats texture-filtering
 * bleeding. pixels === 0 returns the input unchanged.
 */
export function applyBleed(image: RasterImage, pixels: number): RasterImage {
  assertMarginPixels(pixels, 'bleed');
  if (pixels === 0) return image;

  const outW = image.width + 2 * pixels;
  const outH = image.height + 2 * pixels;
  const out = createRasterImage(outW, outH, { hasAlpha: image.hasAlpha });

  for (let y = 0; y < outH; y++) {
    // Clamp to content rect: outside pixels replicate the nearest edge pixel.
    const sy = Math.min(image.height - 1, Math.max(0, y - pixels));
    for (let x = 0; x < outW; x++) {
      const sx = Math.min(image.width - 1, Math.max(0, x - pixels));
      const src = (sy * image.width + sx) * 4;
      const dst = (y * outW + x) * 4;
      out.data[dst] = image.data[src];
      out.data[dst + 1] = image.data[src + 1];
      out.data[dst + 2] = image.data[src + 2];
      out.data[dst + 3] = image.data[src + 3];
    }
  }
  return out;
}

/** Centers the raster in a larger transparent canvas. pixels === 0 returns the input unchanged. */
export function applyPadding(image: RasterImage, pixels: number): RasterImage {
  assertMarginPixels(pixels, 'padding');
  if (pixels === 0) return image;

  const outW = image.width + 2 * pixels;
  const outH = image.height + 2 * pixels;
  const out = createRasterImage(outW, outH, { hasAlpha: image.hasAlpha });

  for (let row = 0; row < image.height; row++) {
    const srcStart = row * image.width * 4;
    const dstStart = ((row + pixels) * outW + pixels) * 4;
    out.data.set(image.data.subarray(srcStart, srcStart + image.width * 4), dstStart);
  }
  return out;
}
