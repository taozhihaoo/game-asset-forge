import { describe, expect, it } from 'vitest';
import {
  AtlasPackingError,
  ExportError,
  ForgeError,
  InvalidImageError,
  InvalidPresetError,
  InvalidRectError,
  NoAlphaChannelError,
  NoSpritesFoundError,
  UnsupportedFormatError,
} from '../src/errors.js';
import { assertValidRect } from '../src/rect.js';

describe('typed errors', () => {
  it('carry stage, code, message, and optional source', () => {
    const err = new InvalidImageError('bad IHDR', 'assets/player.png');
    expect(err).toBeInstanceOf(ForgeError);
    expect(err.stage).toBe('decode');
    expect(err.code).toBe('IMAGE_INVALID');
    expect(err.message).toBe('bad IHDR');
    expect(err.source).toBe('assets/player.png');
  });

  it('map each failure kind to its stage', () => {
    expect(new UnsupportedFormatError('x').stage).toBe('input');
    expect(new NoAlphaChannelError('x').stage).toBe('detect');
    expect(new InvalidRectError('x').stage).toBe('detect');
    expect(new NoSpritesFoundError('x').stage).toBe('detect');
    expect(new AtlasPackingError('x').stage).toBe('pack');
    expect(new ExportError('x').stage).toBe('export');
    expect(
      new InvalidPresetError([{ path: 'a', message: 'b', code: 'PRESET_INVALID_VALUE' }]).stage,
    ).toBe('preset');
  });

  it('use the class name as Error name', () => {
    expect(new NoSpritesFoundError('x').name).toBe('NoSpritesFoundError');
  });
});

describe('assertValidRect', () => {
  it('accepts in-bounds integer rects', () => {
    expect(
      assertValidRect({ x: 0, y: 0, width: 4, height: 4 }, 'r', { width: 4, height: 4 }),
    ).toEqual({
      x: 0,
      y: 0,
      width: 4,
      height: 4,
    });
  });

  it('rejects zero-area and negative rects', () => {
    expect(() => assertValidRect({ x: 0, y: 0, width: 0, height: 4 }, 'r')).toThrowError(
      InvalidRectError,
    );
    expect(() => assertValidRect({ x: 0, y: 0, width: -2, height: 4 }, 'r')).toThrowError(
      InvalidRectError,
    );
  });

  it('rejects out-of-bounds rects with a clear message', () => {
    expect(() =>
      assertValidRect({ x: 2, y: 0, width: 4, height: 4 }, 'r', { width: 4, height: 4 }),
    ).toThrowError(/past image width/);
  });

  it('rejects non-integer coordinates', () => {
    expect(() => assertValidRect({ x: 0.5, y: 0, width: 4, height: 4 }, 'r')).toThrowError(
      InvalidRectError,
    );
  });
});
