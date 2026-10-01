import type { RasterImage } from '../types.js';
import type { AssetFile, QualityConfig, QualityIssue } from './models.js';

/**
 * Rule: transparent_area — flags sprites whose canvas is mostly unused
 * (fully transparent) pixels.
 *
 * "Fully transparent" means alpha === 0; soft anti-aliased edges do not
 * count toward the ratio.
 */

/** Pixels with this exact alpha count as unused canvas. */
export const FULLY_TRANSPARENT_ALPHA = 0;

export function transparentRatio(raster: RasterImage): number {
  const total = raster.width * raster.height;
  if (total === 0) return 1;
  let transparent = 0;
  for (let i = 3; i < raster.data.length; i += 4) {
    if (raster.data[i] === FULLY_TRANSPARENT_ALPHA) transparent++;
  }
  return transparent / total;
}

export function transparencyIssues(asset: AssetFile, config: QualityConfig): QualityIssue[] {
  const ratio = transparentRatio(asset.raster);
  if (ratio <= config.maxTransparentRatio) return [];
  const percent = Math.round(ratio * 100);
  return [
    {
      rule: 'transparent_area',
      severity: 'medium',
      message: `Unused canvas: ${percent}% of the pixels are fully transparent`,
      suggestion: 'Consider trimming or reducing canvas size',
    },
  ];
}
