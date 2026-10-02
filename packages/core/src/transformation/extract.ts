import type { RasterImage } from '../types.js';
import { createRasterImage } from '../image.js';
import { createMask, maskBounds, type Mask } from './types.js';
import { unionMasks } from './mask.js';
import { patchMatchFill } from './patchfill.js';

/**
 * Occlusion handling (V4 Feature 4, D3/D4/D10) and layer composition
 * (D10 reconstruction invariant).
 *
 * Level strategy (D4):
 * - Level 1 (default): edge dilation — layer raster covers mask bounds
 *   expanded by `dilation`; pixels outside the mask replicate the nearest
 *   in-mask source pixel (spiral search, radius = dilation).
 * - Level 2 (small-area completion): remaining holes inside the dilated
 *   ring are filled by deterministic diffusion — repeated neighbor
 *   averaging (fixed iteration count). NOT patch-match (see Phase 0 audit).
 * - Level 3 (AI inpainting): provider-based, optional, auto-degrades to
 *   Level 2 on failure (packages/ai InpaintingProvider; mock = unavailable).
 *
 * Invariant (D10): compositing all layers in z order reproduces the source
 * wherever any layer mask covers; uncovered pixels stay transparent.
 */

export interface LayerMaskInput {
  readonly id: string;
  readonly mask: Mask;
}

export interface ExtractedLayer {
  readonly id: string;
  readonly mask: Mask;
  /** Expanded content cell in source space. */
  readonly cellRect: { x: number; y: number; width: number; height: number };
  /** Content bounds of the original mask, relative to the cell. */
  readonly contentRect: { x: number; y: number; width: number; height: number };
  readonly raster: RasterImage;
}

export interface ExtractOptions {
  /** Level 1 dilation radius in px (default 8, D4). */
  readonly dilation?: number;
  /** Level 2 diffusion iterations (default 16) — used when completion is 'diffusion'. */
  readonly diffusionIterations?: number;
  /** Level 2 fill strategy (V5.2): 'patchmatch' (default) or 'diffusion'. */
  readonly completion?: 'diffusion' | 'patchmatch';
  /** PatchMatch seed (default fixed → deterministic). */
  readonly patchMatchSeed?: number;
}

const DEFAULT_DILATION = 8;
const DEFAULT_DIFFUSION_ITERATIONS = 16;

export function extractLayer(
  source: RasterImage,
  layer: LayerMaskInput,
  options: ExtractOptions = {},
): ExtractedLayer {
  const dilation = options.dilation ?? DEFAULT_DILATION;
  const iterations = options.diffusionIterations ?? DEFAULT_DIFFUSION_ITERATIONS;
  const completion = options.completion ?? 'patchmatch';
  const mask = layer.mask;

  const bounds = maskBounds(mask);
  if (bounds === null) {
    throw new Error(`layer '${layer.id}' mask is empty`);
  }
  const cellX = Math.max(0, bounds.x - dilation);
  const cellY = Math.max(0, bounds.y - dilation);
  const cellRight = Math.min(source.width, bounds.x + bounds.width + dilation);
  const cellBottom = Math.min(source.height, bounds.y + bounds.height + dilation);
  const cellRect = {
    x: cellX,
    y: cellY,
    width: cellRight - cellX,
    height: cellBottom - cellY,
  };

  // Level 1: content = source where mask; dilated ring = nearest in-mask
  // source pixel (spiral search capped at dilation).
  const raster = createRasterImage(cellRect.width, cellRect.height, { hasAlpha: true });
  for (let y = 0; y < cellRect.height; y++) {
    for (let x = 0; x < cellRect.width; x++) {
      const sourceX = cellRect.x + x;
      const sourceY = cellRect.y + y;
      const maskValue = mask.data[sourceY * mask.width + sourceX] !== 0;
      const dst = (y * cellRect.width + x) * 4;
      if (maskValue) {
        const src = (sourceY * source.width + sourceX) * 4;
        for (let c = 0; c < 4; c++) raster.data[dst + c] = source.data[src + c];
      } else {
        const found = findNearestInMask(mask, sourceX, sourceY, dilation);
        if (found !== null) {
          const src = (found.y * source.width + found.x) * 4;
          for (let c = 0; c < 4; c++) raster.data[dst + c] = source.data[src + c];
        }
        // else: leave transparent — Level 2 diffusion may fill it
      }
    }
  }

  // Level 2: fill still-transparent pixels inside the cell. V5.2 default is
  // PatchMatch (texture continuity); 'diffusion' remains as the fast path.
  if (completion === 'patchmatch') {
    patchMatchFill(raster, { seed: options.patchMatchSeed, iterations: 4 });
  } else {
    diffusionFill(raster, iterations);
  }

  // expand mask to cell space for composition
  const cellMask = createMask(cellRect.width, cellRect.height);
  for (let y = 0; y < cellRect.height; y++) {
    for (let x = 0; x < cellRect.width; x++) {
      cellMask.data[y * cellRect.width + x] =
        mask.data[(cellRect.y + y) * mask.width + (cellRect.x + x)];
    }
  }

  return {
    id: layer.id,
    mask: cellMask,
    cellRect,
    contentRect: {
      x: bounds.x - cellRect.x,
      y: bounds.y - cellRect.y,
      width: bounds.width,
      height: bounds.height,
    },
    raster,
  };
}

/** Nearest set pixel within `radius` (Chebyshev rings, row-major = deterministic). */
function findNearestInMask(
  mask: Mask,
  x: number,
  y: number,
  radius: number,
): { x: number; y: number } | null {
  for (let r = 1; r <= radius; r++) {
    for (let dy = -r; dy <= r; dy++) {
      const ny = y + dy;
      if (ny < 0 || ny >= mask.height) continue;
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue; // ring order
        const nx = x + dx;
        if (nx < 0 || nx >= mask.width) continue;
        if (mask.data[ny * mask.width + nx] !== 0) return { x: nx, y: ny };
      }
    }
  }
  return null;
}

/**
 * Level 2 (prototype): deterministic diffusion fill — repeatedly set every
 * transparent pixel inside the dilated ring to the average of its
 * non-transparent neighbors. A fixed number of sweeps keeps the result
 * reproducible; holes that never receive a neighbor stay transparent.
 */
function diffusionFill(raster: RasterImage, iterations: number): void {
  const { width, height, data } = raster;
  for (let iteration = 0; iteration < iterations; iteration++) {
    let changed = false;
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const i = (y * width + x) * 4;
        if (data[i + 3] !== 0) continue;
        let r = 0;
        let g = 0;
        let b = 0;
        let a = 0;
        let neighbors = 0;
        for (const [dx, dy] of [
          [-1, 0],
          [1, 0],
          [0, -1],
          [0, 1],
        ] as const) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue;
          const ni = (ny * width + nx) * 4;
          if (data[ni + 3] === 0) continue;
          r += data[ni];
          g += data[ni + 1];
          b += data[ni + 2];
          a += data[ni + 3];
          neighbors++;
        }
        if (neighbors > 0) {
          data[i] = r / neighbors;
          data[i + 1] = g / neighbors;
          data[i + 2] = b / neighbors;
          data[i + 3] = a / neighbors;
          changed = true;
        }
      }
    }
    if (!changed) break;
  }
}

/** Composites layers in z order onto a transparent canvas (D10). */
export function composeLayers(
  width: number,
  height: number,
  layers: readonly ExtractedLayer[],
): RasterImage {
  const out = createRasterImage(width, height, { hasAlpha: true });
  for (const layer of layers) {
    for (let y = 0; y < layer.raster.height; y++) {
      for (let x = 0; x < layer.raster.width; x++) {
        const src = (y * layer.raster.width + x) * 4;
        if (layer.raster.data[src + 3] === 0) continue;
        const dstX = layer.cellRect.x + x;
        const dstY = layer.cellRect.y + y;
        if (dstX < 0 || dstX >= width || dstY < 0 || dstY >= height) continue;
        const dst = (dstY * width + dstX) * 4;
        out.data[dst] = layer.raster.data[src];
        out.data[dst + 1] = layer.raster.data[src + 1];
        out.data[dst + 2] = layer.raster.data[src + 2];
        out.data[dst + 3] = layer.raster.data[src + 3];
      }
    }
  }
  return out;
}

export type { Mask };
export { createMask, unionMasks };
