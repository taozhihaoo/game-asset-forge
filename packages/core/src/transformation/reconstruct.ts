import type { RasterImage } from '../types.js';

import { createMask, maskBounds, type Mask } from './types.js';
import {
  composeLayers,
  extractLayer,
  type ExtractedLayer,
  type LayerMaskInput,
} from './extract.js';

/**
 * Reconstruction invariant (D10): compositing the extracted layers in z
 * order reproduces the source image wherever ANY layer mask covers, and is
 * transparent where nothing covers. Returns per-pixel verdicts for tests.
 * Coverage is computed in SOURCE space (per-layer cell masks translated by
 * cellRect) — cell-space masks must never be compared against the source.
 */
export function checkReconstruction(
  source: RasterImage,
  layers: readonly ExtractedLayer[],
  maxPixelDelta: number,
): { pass: boolean; coveredPixels: number; violations: number; uncoveredTransparent: number } {
  const width = source.width;
  const height = source.height;
  const composed = composeLayers(width, height, layers);
  const covered = createMask(width, height);

  for (const layer of layers) {
    for (let y = 0; y < layer.raster.height; y++) {
      for (let x = 0; x < layer.raster.width; x++) {
        if (layer.raster.data[(y * layer.raster.width + x) * 4 + 3] !== 0) {
          const sx = layer.cellRect.x + x;
          const sy = layer.cellRect.y + y;
          if (sx >= 0 && sx < width && sy >= 0 && sy < height) {
            covered.data[sy * width + sx] = 255;
          }
        }
      }
    }
  }

  let coveredPixels = 0;
  let violations = 0;
  let uncoveredTransparent = 0;
  for (let i = 0; i < covered.data.length; i++) {
    const dst = i * 4;
    if (covered.data[i] !== 0) {
      coveredPixels++;
      for (let c = 0; c < 4; c++) {
        if (Math.abs(composed.data[dst + c] - source.data[dst + c]) > maxPixelDelta) {
          violations++;
          break;
        }
      }
    } else if (composed.data[dst + 3] !== 0) {
      uncoveredTransparent++;
    }
  }
  return {
    pass: violations === 0 && uncoveredTransparent === 0,
    coveredPixels,
    violations,
    uncoveredTransparent,
  };
}

/** Convenience: extract with masks then verify reconstruction in one call. */
export function extractAndVerify(
  source: RasterImage,
  layerMasks: readonly LayerMaskInput[],
  options?: { dilation?: number; diffusionIterations?: number; maxPixelDelta?: number },
): { layers: ExtractedLayer[]; reconstruction: ReturnType<typeof checkReconstruction> } {
  const layers = layerMasks.map((layer) => extractLayer(source, layer, options));
  const reconstruction = checkReconstruction(source, layers, options?.maxPixelDelta ?? 0);
  return { layers, reconstruction };
}

/** Union of all layer cell masks mapped back to SOURCE space. */
export function sourceOccupancy(
  width: number,
  height: number,
  layers: readonly ExtractedLayer[],
): Mask {
  const out = createMask(width, height);
  for (const layer of layers) {
    for (let y = 0; y < layer.raster.height; y++) {
      for (let x = 0; x < layer.raster.width; x++) {
        if (layer.mask.data[y * layer.raster.width + x] !== 0) {
          const dstX = layer.cellRect.x + x;
          const dstY = layer.cellRect.y + y;
          if (dstX >= 0 && dstX < width && dstY >= 0 && dstY < height) {
            out.data[dstY * width + dstX] = 255;
          }
        }
      }
    }
  }
  return out;
}

/** Builds a mask covering every opaque pixel of the raster (alpha >= 1). */
export function opaqueMask(raster: RasterImage): Mask {
  const mask = createMask(raster.width, raster.height);
  for (let i = 0; i < mask.data.length; i++) {
    mask.data[i] = raster.data[i * 4 + 3] !== 0 ? 255 : 0;
  }
  return mask;
}

export function maskFromOpaqueBounds(raster: RasterImage): Mask {
  const bounds = maskBounds(opaqueMask(raster));
  if (bounds === null) return createMask(raster.width, raster.height);
  const mask = createMask(raster.width, raster.height);
  for (let y = bounds.y; y < bounds.y + bounds.height; y++) {
    for (let x = bounds.x; x < bounds.x + bounds.width; x++) {
      mask.data[y * raster.width + x] = 255;
    }
  }
  return mask;
}
