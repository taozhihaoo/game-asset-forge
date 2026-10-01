import { AtlasPackingError } from './errors.js';
import { createRasterImage } from './image.js';
import type { Atlas, AtlasPlacement, Pipeline, RasterImage, Sprite } from './types.js';

/**
 * Atlas packing — MaxRects with the Best-Short-Side-Fit heuristic.
 * ONE stable deterministic variant (charter §12: no algorithm zoo).
 *
 * Determinism rules:
 * - Sprites are placed strictly in INPUT ORDER (then sprite index); no
 *   area-based reordering.
 * - Free rectangles are iterated in list order; score ties resolve to the
 *   earliest free rectangle. No hash-map iteration influences results.
 *
 * Spacing model (amendment A1): each sprite occupies a block of
 * (raster.width + spacing) x (raster.height + spacing); the stored placement
 * rect is the true raster size, so the gap between two placements is at
 * least `spacing`. A sprite must satisfy raster + spacing <= page max —
 * a documented conservative constraint that keeps edge semantics simple.
 *
 * Page size is trimmed to the used extent (deterministic; power-of-two
 * pages are a backlog item, not a V1 requirement).
 */

interface FreeRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface WorkingPage {
  free: FreeRect[];
  placements: AtlasPlacement[];
  usedWidth: number;
  usedHeight: number;
}

export function packAtlas(sprites: readonly Sprite[], config: Pipeline['atlas']): Atlas {
  const pages: WorkingPage[] = [];

  for (const sprite of sprites) {
    const cellW = sprite.raster.width + config.spacing;
    const cellH = sprite.raster.height + config.spacing;
    if (cellW > config.maxWidth || cellH > config.maxHeight) {
      throw new AtlasPackingError(
        `sprite ${sprite.id} needs a ${cellW}x${cellH} block (raster ${sprite.raster.width}x${sprite.raster.height}` +
          ` + spacing ${config.spacing}) which exceeds the page limit ${config.maxWidth}x${config.maxHeight}` +
          ` — increase atlas.maxWidth/maxHeight or reduce spacing`,
        sprite.sourcePath,
      );
    }

    let target: WorkingPage | null = null;
    let at: { x: number; y: number } | null = null;
    for (const page of pages) {
      const pos = findPlacement(page, cellW, cellH);
      if (pos !== null) {
        target = page;
        at = pos;
        break;
      }
    }
    if (target === null || at === null) {
      const page = createWorkingPage(config);
      const pos = findPlacement(page, cellW, cellH);
      if (pos === null) {
        // Unreachable: the size check above guarantees a fresh page fits.
        throw new AtlasPackingError(
          `sprite ${sprite.id} could not be placed on a fresh page`,
          sprite.sourcePath,
        );
      }
      target = page;
      at = pos;
      pages.push(page);
    }

    target.placements.push({
      spriteId: sprite.id,
      rect: { x: at.x, y: at.y, width: sprite.raster.width, height: sprite.raster.height },
    });
    splitAndPrune(target, { x: at.x, y: at.y, width: cellW, height: cellH });
    target.usedWidth = Math.max(target.usedWidth, at.x + sprite.raster.width);
    target.usedHeight = Math.max(target.usedHeight, at.y + sprite.raster.height);
  }

  return {
    pages: pages.map((page, index) => ({
      index,
      width: Math.max(1, page.usedWidth),
      height: Math.max(1, page.usedHeight),
      placements: page.placements,
    })),
  };
}

function createWorkingPage(config: Pipeline['atlas']): WorkingPage {
  return {
    free: [{ x: 0, y: 0, width: config.maxWidth, height: config.maxHeight }],
    placements: [],
    usedWidth: 0,
    usedHeight: 0,
  };
}

/** Best-Short-Side-Fit over free rects, iterated in list order (ties → earliest). */
function findPlacement(
  page: WorkingPage,
  width: number,
  height: number,
): { x: number; y: number } | null {
  let best: { index: number; short: number; long: number } | null = null;
  for (let i = 0; i < page.free.length; i++) {
    const free = page.free[i];
    if (width <= free.width && height <= free.height) {
      const leftoverW = free.width - width;
      const leftoverH = free.height - height;
      const short = Math.min(leftoverW, leftoverH);
      const long = Math.max(leftoverW, leftoverH);
      if (best === null || short < best.short || (short === best.short && long < best.long)) {
        best = { index: i, short, long };
      }
    }
  }
  if (best === null) return null;
  const free = page.free[best.index];
  return { x: free.x, y: free.y };
}

function splitAndPrune(page: WorkingPage, used: FreeRect): void {
  const next: FreeRect[] = [];
  for (const free of page.free) {
    if (!intersects(free, used)) {
      next.push(free);
      continue;
    }
    if (used.x > free.x) {
      next.push({ x: free.x, y: free.y, width: used.x - free.x, height: free.height });
    }
    if (used.x + used.width < free.x + free.width) {
      next.push({
        x: used.x + used.width,
        y: free.y,
        width: free.x + free.width - (used.x + used.width),
        height: free.height,
      });
    }
    if (used.y > free.y) {
      next.push({ x: free.x, y: free.y, width: free.width, height: used.y - free.y });
    }
    if (used.y + used.height < free.y + free.height) {
      next.push({
        x: free.x,
        y: used.y + used.height,
        width: free.width,
        height: free.y + free.height - (used.y + used.height),
      });
    }
  }

  // Prune free rects fully contained in another (equal rects survive —
  // they describe identical space and are harmless).
  const kept: FreeRect[] = [];
  for (let i = 0; i < next.length; i++) {
    let contained = false;
    for (let j = 0; j < next.length; j++) {
      if (i !== j && contains(next[j], next[i]) && !sameRect(next[j], next[i])) {
        contained = true;
        break;
      }
    }
    if (!contained) kept.push(next[i]);
  }
  page.free = kept;
}

function intersects(a: FreeRect, b: FreeRect): boolean {
  return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
}

function contains(outer: FreeRect, inner: FreeRect): boolean {
  return (
    outer.x <= inner.x &&
    outer.y <= inner.y &&
    outer.x + outer.width >= inner.x + inner.width &&
    outer.y + outer.height >= inner.y + inner.height
  );
}

function sameRect(a: FreeRect, b: FreeRect): boolean {
  return a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height;
}

/**
 * Composites each atlas page into real pixels by blitting sprite cell
 * rasters at their placements. Page dimensions come from the packer's
 * used-extent trim.
 */
export function composeAtlasPages(atlas: Atlas, sprites: readonly Sprite[]): RasterImage[] {
  const byId = new Map(sprites.map((sprite) => [sprite.id, sprite]));
  return atlas.pages.map((page) => {
    const out = createRasterImage(page.width, page.height, { hasAlpha: true });
    for (const placement of page.placements) {
      const sprite = byId.get(placement.spriteId);
      if (sprite === undefined) {
        throw new AtlasPackingError(`placement references unknown sprite ${placement.spriteId}`);
      }
      if (
        sprite.raster.width !== placement.rect.width ||
        sprite.raster.height !== placement.rect.height
      ) {
        throw new AtlasPackingError(`placement rect mismatch for ${sprite.id}`);
      }
      blit(sprite.raster, out, placement.rect.x, placement.rect.y);
    }
    return out;
  });
}

function blit(src: RasterImage, dst: RasterImage, ox: number, oy: number): void {
  for (let row = 0; row < src.height; row++) {
    const srcStart = row * src.width * 4;
    const dstStart = ((oy + row) * dst.width + ox) * 4;
    dst.data.set(src.data.subarray(srcStart, srcStart + src.width * 4), dstStart);
  }
}
