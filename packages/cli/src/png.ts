import { PNG } from 'pngjs';
import { InvalidImageError, UnsupportedFormatError, type RasterImage } from '@gameasset-forge/core';
import { readFileSync } from 'node:fs';

/**
 * PNG decode/encode for the CLI layer.
 *
 * Amendment A2 contract: pngjs always produces RGBA8 buffers, so alpha
 * presence MUST be decided from the IHDR color type (plus tRNS for palette
 * PNGs) — never from the decoded buffer.
 */

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] as const;

export const UNSUPPORTED_FORMAT_MESSAGE =
  'Unsupported image format: PNG is the only supported V1 input format.';

export interface PngInfo {
  readonly width: number;
  readonly height: number;
  readonly hasAlpha: boolean;
  readonly colorType: number;
  readonly bitDepth: number;
}

/** Rejects non-.png inputs with the charter §7 message before any decoding. */
export function assertPngFile(fileName: string): void {
  if (!/\.png$/i.test(fileName)) {
    throw new UnsupportedFormatError(UNSUPPORTED_FORMAT_MESSAGE, fileName);
  }
}

export function readPngInfo(buffer: Buffer, source?: string): PngInfo {
  if (!hasPngSignature(buffer)) {
    throw new InvalidImageError('not a PNG file (bad signature)', source);
  }
  if (buffer.length < 33) {
    throw new InvalidImageError('PNG file too short to contain IHDR', source);
  }
  // IHDR is always the first chunk: 8-byte signature, 4-byte length, "IHDR",
  // then 13 data bytes (width, height, bit depth, color type, ...).
  const data = 16;
  const width = buffer.readUInt32BE(data);
  const height = buffer.readUInt32BE(data + 4);
  const bitDepth = buffer[data + 8];
  const colorType = buffer[data + 9];
  let hasAlpha = colorType === 4 || colorType === 6;
  if (colorType === 3) {
    hasAlpha = chunkExists(buffer, 'tRNS');
  }
  return { width, height, hasAlpha, colorType, bitDepth };
}

function hasPngSignature(buffer: Buffer): boolean {
  return PNG_SIGNATURE.every((byte, i) => buffer[i] === byte);
}

function chunkExists(buffer: Buffer, type: string): boolean {
  let offset = 8;
  while (offset + 8 <= buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const chunkType = buffer.toString('latin1', offset + 4, offset + 8);
    if (chunkType === type) return true;
    if (chunkType === 'IEND') return false;
    offset += 12 + length;
  }
  return false;
}

/** Decodes any PNG variant into the core RGBA8 RasterImage. */
export function decodePng(buffer: Buffer, source?: string): RasterImage {
  const info = readPngInfo(buffer, source); // signature + IHDR validation with clean errors
  let png: PNG;
  try {
    png = PNG.sync.read(buffer);
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause);
    throw new InvalidImageError(`PNG decode failed: ${message}`, source, cause);
  }
  const expected = png.width * png.height * 4;
  return {
    format: 'rgba8',
    hasAlpha: info.hasAlpha,
    width: png.width,
    height: png.height,
    data: new Uint8ClampedArray(png.data.buffer, png.data.byteOffset, expected),
  };
}

/** Synchronously encodes a RasterImage as an 8-bit RGBA PNG. */
export function encodePng(image: RasterImage): Buffer {
  const png = new PNG({ width: image.width, height: image.height });
  png.data = Buffer.from(image.data.buffer, image.data.byteOffset, image.data.byteLength);
  return PNG.sync.write(png);
}

export function readPngFile(absolutePath: string, source: string): RasterImage {
  const buffer = readFileSync(absolutePath);
  return decodePng(buffer, source);
}
