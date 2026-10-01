import {
  createRasterImage,
  getPixel,
  setPixel,
  type Pixel,
  type RasterImage,
  type Sprite,
} from '../src/index.js';

export interface Sheet {
  readonly image: RasterImage;
}

export function makeImage(width: number, height: number, hasAlpha = true): Sheet {
  return { image: createRasterImage(width, height, { hasAlpha }) };
}

/** Builds a Sprite with a solid-color raster — packer/manifest test input. */
export function makeSprite(
  name: string,
  width: number,
  height: number,
  color: Pixel = [255, 0, 0, 255],
): Sprite {
  const raster = createRasterImage(width, height, { hasAlpha: true });
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) setPixel(raster, x, y, color);
  }
  return {
    id: `${name}.png#s`,
    sourcePath: `${name}.png`,
    sourceRect: { x: 0, y: 0, width, height },
    trimmedRect: { x: 0, y: 0, width, height },
    raster,
    pivot: { x: 0.5, y: 1 },
  };
}

export function put(sheet: Sheet, x: number, y: number, pixel: Pixel): void {
  setPixel(sheet.image, x, y, pixel);
}

/** Fills an axis-aligned rect (in image coords) with a solid RGBA color. */
export function fillRect(
  sheet: Sheet,
  x: number,
  y: number,
  width: number,
  height: number,
  pixel: Pixel,
): void {
  for (let dy = 0; dy < height; dy++) {
    for (let dx = 0; dx < width; dx++) {
      setPixel(sheet.image, x + dx, y + dy, pixel);
    }
  }
}

export function pixelOf(sheet: Sheet, x: number, y: number): Pixel {
  return getPixel(sheet.image, x, y);
}

export const RED: Pixel = [255, 0, 0, 255];
export const GREEN: Pixel = [0, 255, 0, 255];
export const BLUE: Pixel = [0, 0, 255, 255];
export const TRANSPARENT: Pixel = [0, 0, 0, 0];
