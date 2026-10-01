import { InvalidImageError, UnsupportedFormatError, type RasterImage } from '@gameasset-forge/core';

/**
 * Browser-side PNG decoding for the renderer. Same IHDR alpha contract as the
 * CLI (amendment A2): alpha presence comes from the IHDR color type (+ tRNS
 * for palette PNGs), never from the decoded RGBA buffer.
 */

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] as const;

export interface DecodedImage {
  readonly image: RasterImage;
  readonly bitmap: ImageBitmap;
}

export function pngHasAlpha(buffer: Uint8Array): boolean {
  if (!PNG_SIGNATURE.every((byte, i) => buffer[i] === byte)) {
    throw new InvalidImageError('not a PNG file (bad signature)');
  }
  if (buffer.length < 33) {
    throw new InvalidImageError('PNG file too short to contain IHDR');
  }
  const colorType = buffer[25];
  if (colorType === 4 || colorType === 6) return true;
  if (colorType === 3) return chunkExists(buffer, 'tRNS');
  return false;
}

function chunkExists(buffer: Uint8Array, type: string): boolean {
  const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  let offset = 8;
  while (offset + 8 <= buffer.length) {
    const length = view.getUint32(offset);
    const chunkType = String.fromCharCode(
      buffer[offset + 4],
      buffer[offset + 5],
      buffer[offset + 6],
      buffer[offset + 7],
    );
    if (chunkType === type) return true;
    if (chunkType === 'IEND') return false;
    offset += 12 + length;
  }
  return false;
}

export function assertPngBytes(buffer: Uint8Array): void {
  if (!PNG_SIGNATURE.every((byte, i) => buffer[i] === byte)) {
    throw new UnsupportedFormatError(
      'Unsupported image format: PNG is the only supported V1 input format.',
    );
  }
}

export async function decodePngInBrowser(buffer: Uint8Array): Promise<DecodedImage> {
  assertPngBytes(buffer);
  const hasAlpha = pngHasAlpha(buffer);
  const blob = new Blob([buffer as BlobPart], { type: 'image/png' });
  const bitmap = await createImageBitmap(blob);
  const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
  const ctx = canvas.getContext('2d');
  if (ctx === null) throw new InvalidImageError('cannot acquire 2d context for decoding');
  ctx.drawImage(bitmap, 0, 0);
  const frame = ctx.getImageData(0, 0, bitmap.width, bitmap.height);
  return {
    bitmap,
    image: {
      format: 'rgba8',
      hasAlpha,
      width: bitmap.width,
      height: bitmap.height,
      data: new Uint8ClampedArray(frame.data),
    },
  };
}

/** Encodes a raster to PNG bytes via OffscreenCanvas (renderer-side export). */
export async function encodePngInBrowser(image: RasterImage): Promise<Uint8Array> {
  const canvas = new OffscreenCanvas(image.width, image.height);
  const ctx = canvas.getContext('2d');
  if (ctx === null) throw new InvalidImageError('cannot acquire 2d context for encoding');
  ctx.putImageData(
    new ImageData(new Uint8ClampedArray(image.data), image.width, image.height),
    0,
    0,
  );
  const blob = await canvas.convertToBlob({ type: 'image/png' });
  return new Uint8Array(await blob.arrayBuffer());
}

export function joinPath(...parts: readonly string[]): string {
  return parts
    .filter((p) => p.length > 0)
    .map((p, i) => (i === 0 ? p.replace(/[\\/]+$/, '') : p.replace(/^[\\/]+|[\\/]+$/g, '')))
    .join('/');
}
