import { ForgeError } from './errors.js';
import { PIXEL_FORMAT_RGBA8, type RasterImage, type Rect } from './types.js';

/**
 * Raster utilities. Pure, fs-free, environment-free.
 * All coordinate arguments are integer pixel coordinates, origin top-left.
 */

export interface CreateRasterImageOptions {
  /** Reflects the source format; defaults to true. See RasterImage docs. */
  readonly hasAlpha?: boolean;
}

export function createRasterImage(
  width: number,
  height: number,
  options?: CreateRasterImageOptions,
): RasterImage {
  assertDimensions(width, height, 'width');
  assertDimensions(width, height, 'height');
  return {
    format: PIXEL_FORMAT_RGBA8,
    hasAlpha: options?.hasAlpha ?? true,
    width,
    height,
    data: new Uint8ClampedArray(width * height * 4),
  };
}

function assertDimensions(width: number, height: number, label: 'width' | 'height'): void {
  const value = label === 'width' ? width : height;
  if (!Number.isSafeInteger(value) || value < 1 || value > 65535) {
    throw new ForgeError({
      stage: 'input',
      code: 'ARGUMENT_OUT_OF_RANGE',
      message: `image ${label} must be an integer in [1, 65535], got ${String(value)}`,
    });
  }
}

export function cloneRaster(image: RasterImage): RasterImage {
  return { ...image, data: new Uint8ClampedArray(image.data) };
}

/** Extracts a sub-rectangle as a new raster. Bounds-checked. */
export function cropRaster(image: RasterImage, rect: Rect): RasterImage {
  if (
    rect.x < 0 ||
    rect.y < 0 ||
    rect.width < 1 ||
    rect.height < 1 ||
    rect.x + rect.width > image.width ||
    rect.y + rect.height > image.height
  ) {
    throw new ForgeError({
      stage: 'input',
      code: 'ARGUMENT_OUT_OF_RANGE',
      message: `crop rect (${rect.x}, ${rect.y}, ${rect.width}x${rect.height}) out of bounds for ${image.width}x${image.height} image`,
    });
  }
  const out = createRasterImage(rect.width, rect.height, { hasAlpha: image.hasAlpha });
  for (let row = 0; row < rect.height; row++) {
    const srcStart = ((rect.y + row) * image.width + rect.x) * 4;
    out.data.set(image.data.subarray(srcStart, srcStart + rect.width * 4), row * rect.width * 4);
  }
  return out;
}

export function pixelIndex(image: RasterImage, x: number, y: number): number {
  return (y * image.width + x) * 4;
}

export type Pixel = readonly [number, number, number, number];

export function getPixel(image: RasterImage, x: number, y: number): Pixel {
  const i = pixelIndex(image, x, y);
  return [image.data[i], image.data[i + 1], image.data[i + 2], image.data[i + 3]];
}

export function setPixel(image: RasterImage, x: number, y: number, pixel: Pixel): void {
  const i = pixelIndex(image, x, y);
  image.data[i] = pixel[0];
  image.data[i + 1] = pixel[1];
  image.data[i + 2] = pixel[2];
  image.data[i + 3] = pixel[3];
}
