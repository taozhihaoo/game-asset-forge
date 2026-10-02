import { describe, expect, it } from 'vitest';
import { createEditorLayer, stampBrush } from '../src/renderer/editor.js';

describe('editor mask brush and state', () => {
  it('createEditorLayer fills mask rect', () => {
    const layer = createEditorLayer('test', 0, 8, 8, { x: 2, y: 2, width: 4, height: 4 }, 2);
    expect(layer.mask.data[2 * 8 + 2]).toBe(255);
    expect(layer.mask.data[0]).toBe(0);
  });

  it('stampBrush add sets pixels', () => {
    const layer = createEditorLayer('t', 0, 8, 8, { x: 0, y: 0, width: 8, height: 8 }, 2);
    layer.mask.data.fill(0);
    stampBrush(layer.mask, 4, 4, 2, 255);
    expect(layer.mask.data[4 * 8 + 4]).toBe(255);
  });

  it('stampBrush erase clears pixels', () => {
    const layer = createEditorLayer('t', 0, 8, 8, { x: 0, y: 0, width: 8, height: 8 }, 2);
    layer.mask.data.fill(255);
    stampBrush(layer.mask, 4, 4, 3, 0);
    expect(layer.mask.data[4 * 8 + 4]).toBe(0);
  });
});
