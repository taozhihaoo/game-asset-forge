import type { RasterImage } from '../types.js';
import { createRasterImage } from '../image.js';
import { mulberry32 } from './seeded.js';

/**
 * PatchMatch completion (V5.2, Level 2 upgrade): fills transparent holes by
 * copying content from the best-matching nearby patch — texture continuity
 * instead of diffusion blur.
 *
 * Deterministic (charter §12): mulberry32 seeded PRNG, fixed scan order,
 * fixed iteration count. Classic PatchMatch (Barnes et al. 2009) simplified:
 * random-init offsets → propagate → random search, 4 iterations, patch 7×7.
 *
 * The hole acts as the target region; sources are the non-transparent
 * pixels. Offset (dx, dy) maps target pixel (x, y) to source (x+dx, y+dy).
 */

export interface PatchMatchOptions {
  readonly seed?: number;
  /** Patch radius (default 3 → 7×7 patches). */
  readonly patchRadius?: number;
  /** Iterations of propagate+search (default 4). */
  readonly iterations?: number;
  /** Random-search max window shrink factor. */
  readonly searchShrink?: number;
}

const DEFAULTS = { seed: 20261002, patchRadius: 3, iterations: 4, searchShrink: 2 };

/**
 * Fills all transparent pixels of `image` in place using PatchMatch over
 * RGBA (alpha participates in the patch distance so hard edges propagate).
 */
export function patchMatchFill(image: RasterImage, options: PatchMatchOptions = {}): void {
  const opts = { ...DEFAULTS, ...options };
  const rand = mulberry32(opts.seed);
  const { width, height, data } = image;
  if (width === 0 || height === 0) return;

  const isHole = (x: number, y: number): boolean => data[(y * width + x) * 4 + 3] === 0;
  const inBounds = (x: number, y: number): boolean => x >= 0 && x < width && y >= 0 && y < height;

  // hole pixels in scan order
  const holes: { x: number; y: number }[] = [];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (isHole(x, y)) holes.push({ x, y });
    }
  }
  if (holes.length === 0) return;
  if (holes.length === width * height) return; // nothing to source from

  // init: known pixels stay; hole pixels get a random source offset first,
  // then an immediate validity pass (source must be non-transparent)
  const offsets = new Int32Array(width * height * 2).fill(Number.NaN);
  const setOffset = (x: number, y: number, dx: number, dy: number): void => {
    const i = (y * width + x) * 2;
    offsets[i] = dx;
    offsets[i + 1] = dy;
  };
  const getOffset = (x: number, y: number): { dx: number; dy: number } => {
    const i = (y * width + x) * 2;
    return { dx: offsets[i], dy: offsets[i + 1] };
  };

  // first fill pass: propagate any non-transparent color into holes so every
  // pixel has valid RGBA before patch matching (coarse initialization)
  const coarse = createRasterImage(width, height, { hasAlpha: true });
  coarse.data.set(data);
  for (let iteration = 0; iteration < 8; iteration++) {
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        if (coarse.data[(y * width + x) * 4 + 3] !== 0) continue;
        let r = 0;
        let g = 0;
        let b = 0;
        let a = 0;
        let n = 0;
        for (const [dx, dy] of [
          [-1, 0],
          [1, 0],
          [0, -1],
          [0, 1],
        ] as const) {
          const nx = x + dx;
          const ny = y + dy;
          if (!inBounds(nx, ny)) continue;
          const ni = (ny * width + nx) * 4;
          if (coarse.data[ni + 3] === 0) continue;
          r += coarse.data[ni];
          g += coarse.data[ni + 1];
          b += coarse.data[ni + 2];
          a += coarse.data[ni + 3];
          n++;
        }
        if (n > 0) {
          const i = (y * width + x) * 4;
          coarse.data[i] = r / n;
          coarse.data[i + 1] = g / n;
          coarse.data[i + 2] = b / n;
          coarse.data[i + 3] = a / n;
        }
      }
    }
  }
  data.set(coarse.data);

  // random offsets (valid source required: non-transparent after coarse fill)
  for (const hole of holes) {
    for (let attempt = 0; attempt < 32; attempt++) {
      const dx = Math.floor(rand() * (2 * width + 1)) - width;
      const dy = Math.floor(rand() * (2 * height + 1)) - height;
      const sx = hole.x + dx;
      const sy = hole.y + dy;
      if (inBounds(sx, sy) && !isHole(sx, sy)) {
        setOffset(hole.x, hole.y, dx, dy);
        break;
      }
      if (attempt === 31) setOffset(hole.x, hole.y, 0, 0);
    }
  }

  const patchDistance = (
    tx: number,
    ty: number,
    dx: number,
    dy: number,
    currentBest: number,
  ): number => {
    let sum = 0;
    for (let py = -opts.patchRadius; py <= opts.patchRadius; py++) {
      for (let px = -opts.patchRadius; px <= opts.patchRadius; px++) {
        const tX = tx + px;
        const tY = ty + py;
        if (!inBounds(tX, tY)) continue;
        const sX = tX + dx;
        const sY = tY + dy;
        if (!inBounds(sX, sY)) return Number.POSITIVE_INFINITY; // patch out of bounds
        const ti = (tY * width + tX) * 4;
        const si = (sY * width + sX) * 4;
        // source must be non-transparent at every sampled pixel
        if (isHole(sX, sY) && !(dx === 0 && dy === 0)) return Number.POSITIVE_INFINITY;
        for (let c = 0; c < 4; c++) {
          const diff = data[ti + c] - data[si + c];
          sum += diff * diff;
        }
        if (sum >= currentBest) return sum; // early exit
      }
    }
    return sum;
  };

  const tryOffset = (
    x: number,
    y: number,
    dx: number,
    dy: number,
    best: { dist: number; dx: number; dy: number },
  ): void => {
    if (dx === 0 && dy === 0) return;
    const sx = x + dx;
    const sy = y + dy;
    if (!inBounds(sx, sy)) return;
    const dist = patchDistance(x, y, dx, dy, best.dist);
    if (dist < best.dist) {
      best.dist = dist;
      best.dx = dx;
      best.dy = dy;
    }
  };

  for (let iteration = 0; iteration < opts.iterations; iteration++) {
    const forward = iteration % 2 === 0;
    const order = forward ? holes : [...holes].reverse();
    for (const hole of order) {
      const current = getOffset(hole.x, hole.y);
      const best = {
        dist: patchDistance(hole.x, hole.y, current.dx, current.dy, Number.POSITIVE_INFINITY),
        dx: current.dx,
        dy: current.dy,
      };

      // propagate from the already-updated neighbor (scan-order direction)
      const propX = hole.x + (forward ? -1 : 1);
      if (inBounds(propX, hole.y)) {
        const neighbor = getOffset(propX, hole.y);
        tryOffset(hole.x, hole.y, neighbor.dx + (forward ? 1 : -1), neighbor.dy, best);
      }
      const propY = hole.y + (forward ? -1 : 1);
      if (inBounds(hole.x, propY)) {
        const neighbor = getOffset(hole.x, propY);
        tryOffset(hole.x, hole.y, neighbor.dx, neighbor.dy + (forward ? 1 : -1), best);
      }

      // random search around the current best, shrinking window
      let window = Math.max(width, height);
      while (window >= 1) {
        const dx = Math.floor((rand() * 2 - 1) * window);
        const dy = Math.floor((rand() * 2 - 1) * window);
        tryOffset(hole.x, hole.y, best.dx + dx, best.dy + dy, best);
        window = Math.floor(window / opts.searchShrink);
      }

      setOffset(hole.x, hole.y, best.dx, best.dy);
      // commit the matched source color
      const sx = hole.x + best.dx;
      const sy = hole.y + best.dy;
      if (inBounds(sx, sy)) {
        const ti = (hole.y * width + hole.x) * 4;
        const si = (sy * width + sx) * 4;
        for (let c = 0; c < 4; c++) data[ti + c] = data[si + c];
      }
    }
  }
}
