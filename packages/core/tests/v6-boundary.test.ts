import { describe, expect, it } from 'vitest';
import {
  checkReconstruction,
  composeLayers,
  createRasterImage,
  extractLayer,
  maskFromRect,
  setPixel,
  sourceOccupancy,
} from '../src/index.js';

const RED: [number, number, number, number] = [255, 0, 0, 255];
const BLUE: [number, number, number, number] = [0, 0, 255, 255];
const COLOR_A = RED;
const COLOR_B = BLUE;

function solid(w: number, h: number, color = RED) {
  const image = createRasterImage(w, h, { hasAlpha: true });
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) setPixel(image, x, y, color);
  return image;
}

// --- 现有变换回归（V4 基线保护） ---

describe('transformation regression guards', () => {
  it('extraction with default dilation reproduces full-image source', () => {
    const source = solid(16, 16);
    const mask = maskFromRect(16, 16, { x: 4, y: 4, width: 8, height: 8 });
    const layer = extractLayer(source, { id: 't', mask }, { dilation: 2 });
    expect(layer.cellRect).toEqual({ x: 2, y: 2, width: 12, height: 12 });
  });

  it('composeLayers respects later-layer priority at overlap', () => {
    const sourceA = solid(8, 8, COLOR_A);
    const sourceB = solid(8, 8, COLOR_B);
    const mask = maskFromRect(8, 8, { x: 0, y: 0, width: 8, height: 8 });
    const layerA = extractLayer(sourceA, { id: 'a', mask }, { dilation: 0 });
    const layerB = extractLayer(sourceB, { id: 'b', mask }, { dilation: 0 });
    const composed = composeLayers(8, 8, [layerA, layerB]);
    expect(composed.data[0]).toBe(COLOR_B[0]);
  });

  it('checkReconstruction detects single-channel corruption', () => {
    const source = solid(8, 8);
    const mask = maskFromRect(8, 8, { x: 0, y: 0, width: 8, height: 8 });
    const layer = extractLayer(source, { id: 't', mask }, { dilation: 0 });
    layer.raster.data[1] = 255; // green channel only
    const result = checkReconstruction(source, [layer], 0);
    expect(result.pass).toBe(false);
  });

  it('sourceOccupancy marks only covered pixels', () => {
    const source = solid(8, 8);
    const mask = maskFromRect(8, 8, { x: 2, y: 2, width: 4, height: 4 });
    const layer = extractLayer(source, { id: 't', mask }, { dilation: 0 });
    const occupied = sourceOccupancy(8, 8, [layer]);
    expect(occupied.data[2 * 8 + 2]).toBe(255);
    expect(occupied.data[0]).toBe(0);
  });
});
