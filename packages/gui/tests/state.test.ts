import { describe, expect, it } from 'vitest';
import { AppStore, effectivePipeline, initialState } from '../src/renderer/state.js';
import { pngHasAlpha } from '../src/renderer/decode.js';

describe('state store', () => {
  it('starts with the default pipeline and empty state', () => {
    const state = initialState();
    expect(state.pipeline.detect.mode).toBe('alpha-connected-components');
    expect(state.manualRects).toEqual([]);
    expect(state.result).toBeNull();
  });

  it('effectivePipeline passes auto modes through unchanged', () => {
    const state = initialState();
    expect(effectivePipeline(state)).toBe(state.pipeline);
  });

  it('effectivePipeline feeds manual rects in manual mode', () => {
    const store = new AppStore();
    store.addManualRect({ x: 1, y: 2, width: 3, height: 4 });
    const state = store.getState();
    expect(state.pipeline.detect.mode).toBe('manual');
    const effective = effectivePipeline(state);
    expect(effective.detect).toEqual({
      mode: 'manual',
      rects: [{ id: 'rect-0001', x: 1, y: 2, width: 3, height: 4 }],
    });
  });

  it('add/update/delete manual rects are undoable as one step', () => {
    const store = new AppStore();
    store.addManualRect({ x: 0, y: 0, width: 5, height: 5 });
    store.updateManualRect(0, { x: 1, y: 1, width: 6, height: 6 });
    expect(store.getState().manualRects[0]).toMatchObject({ x: 1, width: 6 });

    expect(store.undo()).toBe(true);
    expect(store.getState().manualRects[0]).toMatchObject({ x: 0, width: 5 });

    expect(store.undo()).toBe(true);
    expect(store.getState().manualRects).toEqual([]);
    expect(store.getState().pipeline.detect.mode).toBe('alpha-connected-components');
    expect(store.undo()).toBe(false);
  });

  it('delete clears selection and undo restores it', () => {
    const store = new AppStore();
    store.addManualRect({ x: 2, y: 2, width: 2, height: 2 });
    store.set({ selection: { type: 'manual', index: 0 } });
    store.deleteManualRect(0);
    expect(store.getState().manualRects).toEqual([]);
    expect(store.getState().selection).toBeNull();
    expect(store.undo()).toBe(true);
    expect(store.getState().manualRects).toHaveLength(1);
  });

  it('pipeline edits are undoable and bounded by the undo limit', () => {
    const store = new AppStore();
    for (let i = 0; i < 55; i++) {
      store.mutateEditing((s) => ({ pipeline: { ...s.pipeline, padding: { pixels: i } } }));
    }
    expect(store.getState().pipeline.padding.pixels).toBe(54);
    for (let i = 0; i < 50; i++) store.undo();
    expect(store.canUndo).toBe(false);
    expect(store.getState().pipeline.padding.pixels).toBe(4); // 55-50 pushes kept
  });
});

describe('pngHasAlpha (IHDR contract, renderer copy)', () => {
  const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

  function fakePng(colorType: number): Uint8Array {
    const buffer = new Uint8Array(33);
    buffer.set(signature);
    const view = new DataView(buffer.buffer);
    view.setUint32(16, 8); // width
    view.setUint32(20, 8); // height
    buffer[24] = 8; // bit depth
    buffer[25] = colorType;
    return buffer;
  }

  it('detects alpha for colorType 4 and 6', () => {
    expect(pngHasAlpha(fakePng(6))).toBe(true);
    expect(pngHasAlpha(fakePng(4))).toBe(true);
  });

  it('reports no alpha for RGB (2), grayscale (0), and palette without tRNS (3)', () => {
    expect(pngHasAlpha(fakePng(2))).toBe(false);
    expect(pngHasAlpha(fakePng(0))).toBe(false);
    expect(pngHasAlpha(fakePng(3))).toBe(false);
  });
});
