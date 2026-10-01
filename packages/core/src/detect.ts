import {
  ForgeError,
  InvalidRectError,
  NoAlphaChannelError,
  NoSpritesFoundError,
} from './errors.js';
import { assertValidRect } from './rect.js';
import type { DetectConfig, RasterImage, Rect } from './types.js';

/**
 * Sprite detection. Three modes, all deterministic:
 *
 * - alpha-connected-components: label foreground (alpha >= threshold) pixels
 *   with 4- or 8-connectivity, keep components >= minPixels, order by
 *   top-left corner (y, then x; further ties broken by size and scan order).
 * - grid: uniform cells, either rows+columns (cell size = floor(size/n)) or
 *   cellWidth+cellHeight (counts = floor(size/cell)); remainder strips are
 *   ignored; cells without foreground pixels are dropped (never dropped on
 *   no-alpha sources — everything is content).
 * - manual: user-supplied rects, bounds-checked, order preserved.
 *
 * Zero detections → NoSpritesFoundError (callers treat manual fallback as the
 * designed degradation path, not a crash).
 */

export interface DetectedRect {
  readonly rect: Rect;
  /** Manual mode: user-supplied id, unique within the source. */
  readonly id?: string;
}

export interface DetectOptions {
  /** '/'-normalized source reference attached to errors. */
  readonly source?: string;
}

export function detectSprites(
  image: RasterImage,
  detect: DetectConfig,
  options?: DetectOptions,
): readonly DetectedRect[] {
  switch (detect.mode) {
    case 'alpha-connected-components':
      return detectAlphaConnectedComponents(image, detect, options);
    case 'grid':
      return detectGrid(image, detect, options);
    case 'manual':
      return detectManual(image, detect, options);
  }
}

// ---------------------------------------------------------------------------
// alpha-connected-components
// ---------------------------------------------------------------------------

function detectAlphaConnectedComponents(
  image: RasterImage,
  detect: Extract<DetectConfig, { mode: 'alpha-connected-components' }>,
  options?: DetectOptions,
): readonly DetectedRect[] {
  if (!image.hasAlpha) {
    throw new NoAlphaChannelError(
      'source has no alpha channel (RGB); alpha-connected-components detection requires alpha — use grid or manual detection instead',
      options?.source,
    );
  }

  const { width, height, data } = image;
  const total = width * height;
  const foreground = new Uint8Array(total);
  for (let i = 0, p = 3; i < total; i++, p += 4) {
    foreground[i] = data[p] >= detect.alphaThreshold ? 1 : 0;
  }

  const visited = new Uint8Array(total);
  const stack = new Int32Array(total);
  interface Component {
    rect: Rect;
    pixels: number;
    discovery: number;
  }
  const components: Component[] = [];

  for (let start = 0; start < total; start++) {
    if (foreground[start] === 0 || visited[start] === 1) continue;

    const discovery = components.length;
    let top = 0;
    stack[top++] = start;
    visited[start] = 1;

    let minY = Math.floor(start / width);
    let maxY = minY;
    let minX = start % width;
    let maxX = minX;
    let pixels = 0;

    while (top > 0) {
      const index = stack[--top];
      const y = Math.floor(index / width);
      const x = index - y * width;
      pixels++;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;

      // Neighbor offsets, with explicit x bounds so ±1 never wraps rows.
      const push = (nx: number, ny: number): void => {
        if (nx < 0 || nx >= width || ny < 0 || ny >= height) return;
        const ni = ny * width + nx;
        if (foreground[ni] === 1 && visited[ni] === 0) {
          visited[ni] = 1;
          stack[top++] = ni;
        }
      };
      push(x - 1, y);
      push(x + 1, y);
      push(x, y - 1);
      push(x, y + 1);
      if (detect.connectivity === 8) {
        push(x - 1, y - 1);
        push(x + 1, y - 1);
        push(x - 1, y + 1);
        push(x + 1, y + 1);
      }
    }

    components.push({
      rect: { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 },
      pixels,
      discovery,
    });
  }

  const kept = components.filter((c) => c.pixels >= detect.minPixels);
  kept.sort(
    (a, b) =>
      a.rect.y - b.rect.y ||
      a.rect.x - b.rect.x ||
      a.rect.width - b.rect.width ||
      a.rect.height - b.rect.height ||
      a.pixels - b.pixels ||
      a.discovery - b.discovery,
  );

  if (kept.length === 0) {
    throw new NoSpritesFoundError(
      `no foreground components (alpha >= ${detect.alphaThreshold}, minPixels ${detect.minPixels})`,
      options?.source,
    );
  }
  return kept.map((c) => ({ rect: c.rect }));
}

// ---------------------------------------------------------------------------
// grid
// ---------------------------------------------------------------------------

function detectGrid(
  image: RasterImage,
  detect: Extract<DetectConfig, { mode: 'grid' }>,
  options?: DetectOptions,
): readonly DetectedRect[] {
  let columns: number;
  let rows: number;
  let cellWidth: number;
  let cellHeight: number;

  if (detect.rows !== undefined && detect.columns !== undefined) {
    columns = detect.columns;
    rows = detect.rows;
    cellWidth = Math.floor(image.width / columns);
    cellHeight = Math.floor(image.height / rows);
  } else if (detect.cellWidth !== undefined && detect.cellHeight !== undefined) {
    cellWidth = detect.cellWidth;
    cellHeight = detect.cellHeight;
    columns = Math.floor(image.width / cellWidth);
    rows = Math.floor(image.height / cellHeight);
  } else {
    // Unreachable: validatePreset enforces one grid form.
    throw new ForgeError({
      stage: 'detect',
      code: 'GRID_INVALID',
      message: 'grid mode requires rows+columns or cellWidth+cellHeight',
    });
  }

  if (columns < 1 || rows < 1 || cellWidth < 1 || cellHeight < 1) {
    throw new ForgeError({
      stage: 'detect',
      code: 'GRID_INVALID',
      message: `grid degenerates on ${image.width}x${image.height} image (cells ${cellWidth}x${cellHeight}, ${columns}x${rows})`,
      source: options?.source,
    });
  }

  const result: DetectedRect[] = [];
  for (let row = 0; row < rows; row++) {
    for (let column = 0; column < columns; column++) {
      const rect: Rect = {
        x: column * cellWidth,
        y: row * cellHeight,
        width: cellWidth,
        height: cellHeight,
      };
      // Remainder strips outside the uniform grid are ignored by construction.
      if (image.hasAlpha && !rectHasForeground(image, rect, detect.alphaThreshold)) continue;
      result.push({ rect });
    }
  }

  if (result.length === 0) {
    throw new NoSpritesFoundError(
      `all ${columns * rows} grid cells are empty (alpha >= ${detect.alphaThreshold})`,
      options?.source,
    );
  }
  return result;
}

function rectHasForeground(image: RasterImage, rect: Rect, alphaThreshold: number): boolean {
  for (let y = rect.y; y < rect.y + rect.height; y++) {
    const rowStart = y * image.width;
    for (let x = rect.x; x < rect.x + rect.width; x++) {
      if (image.data[(rowStart + x) * 4 + 3] >= alphaThreshold) return true;
    }
  }
  return false;
}

// ---------------------------------------------------------------------------
// manual
// ---------------------------------------------------------------------------

function detectManual(
  image: RasterImage,
  detect: Extract<DetectConfig, { mode: 'manual' }>,
  options?: DetectOptions,
): readonly DetectedRect[] {
  const bounds = { width: image.width, height: image.height };
  const seenIds = new Set<string>();
  return detect.rects.map((rect, index) => {
    const path = `detect.rects[${index}]`;
    assertValidRect(rect, path, bounds);
    const id = rect.id ?? `sprite-${String(index + 1).padStart(4, '0')}`;
    if (seenIds.has(id)) {
      throw new InvalidRectError(
        `${path}: duplicate manual rect id ${JSON.stringify(id)}`,
        options?.source,
      );
    }
    seenIds.add(id);
    return { rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height }, id };
  });
}
