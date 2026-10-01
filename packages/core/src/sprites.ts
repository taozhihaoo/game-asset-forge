import { applyBleed, applyPadding } from './bleed.js';
import { detectSprites } from './detect.js';
import { cropRaster } from './image.js';
import { calculatePivot } from './pivot.js';
import { resizeRaster } from './resize.js';
import { computeContentBounds } from './trim.js';
import type { Pipeline, RasterImage, Rect, Sprite } from './types.js';

/**
 * Sprite assembly: runs one source image through the full pre-atlas pipeline.
 *
 * detect → crop → trim → resize → bleed → padding → pivot
 *
 * A fully transparent sprite is SKIPPED and reported (charter section 9:
 * never generate a 0x0 texture) — it does not abort the run.
 */

export interface BuildSpritesOptions {
  /** '/'-normalized source path used in stable sprite IDs. */
  readonly sourcePath: string;
}

export interface SkippedSprite {
  readonly id: string;
  readonly sourceRect: Rect;
  readonly reason: 'fully-transparent';
}

export interface BuildSpritesResult {
  readonly sprites: readonly Sprite[];
  readonly skipped: readonly SkippedSprite[];
}

/** Stable sprite id: "<sourcePath>#sprite-NNNN" (or the manual rect id). No UUIDs, no timestamps. */
export function buildSpriteId(sourcePath: string, localId: string): string {
  return `${sourcePath}#${localId}`;
}

/**
 * Builds the final CELL raster from a content raster:
 * resize → bleed → padding. Content stays content; margins bake around it
 * (cell = content + 2*bleed + 2*padding).
 */
export function composeCellRaster(content: RasterImage, pipeline: Pipeline): RasterImage {
  let raster = content;
  if (pipeline.resize.enabled && pipeline.resize.scale !== 1) {
    raster = resizeRaster(raster, pipeline.resize.scale, pipeline.resize.filter);
  }
  raster = applyBleed(raster, pipeline.bleed.pixels);
  raster = applyPadding(raster, pipeline.padding.pixels);
  return raster;
}

export function buildSprites(
  image: RasterImage,
  pipeline: Pipeline,
  options: BuildSpritesOptions,
): BuildSpritesResult {
  const detected = detectSprites(image, pipeline.detect, { source: options.sourcePath });
  const pivot = calculatePivot(pipeline.pivot);
  const sprites: Sprite[] = [];
  const skipped: SkippedSprite[] = [];

  for (const [index, item] of detected.entries()) {
    const localId = item.id ?? `sprite-${String(index + 1).padStart(4, '0')}`;
    const sourceRect = item.rect;
    const crop = cropRaster(image, sourceRect);

    let content: RasterImage;
    let trimmedRect: Rect;
    if (pipeline.trim.enabled) {
      const bounds = computeContentBounds(crop, pipeline.trim.alphaThreshold);
      if (bounds === null) {
        skipped.push({
          id: buildSpriteId(options.sourcePath, localId),
          sourceRect,
          reason: 'fully-transparent',
        });
        continue;
      }
      content = cropRaster(crop, bounds);
      trimmedRect = {
        x: sourceRect.x + bounds.x,
        y: sourceRect.y + bounds.y,
        width: bounds.width,
        height: bounds.height,
      };
    } else {
      content = crop;
      trimmedRect = sourceRect;
    }

    sprites.push({
      id: buildSpriteId(options.sourcePath, localId),
      sourcePath: options.sourcePath,
      sourceRect,
      trimmedRect,
      raster: composeCellRaster(content, pipeline),
      pivot,
    });
  }

  return { sprites, skipped };
}
