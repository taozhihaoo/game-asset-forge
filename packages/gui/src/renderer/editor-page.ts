import {
  proposeEditorLayers,
  stampBrush,
  type EditorLayer,
  type Mask,
  type Pipeline,
  type RasterImage,
} from './editor.js';

/**
 * Editor Mode page (V4 Feature 11, prototype): propose layers, paint masks,
 * export .forge. Pure DOM module — the caller owns source/preset access
 * and re-renders (§27: no hidden state).
 */

export interface EditorPageCallbacks {
  readonly log: (line: string) => void;
  readonly getActiveSource: () => { name: string; image: RasterImage } | null;
  readonly getPipeline: () => Pipeline;
  readonly onExportForge: (
    sourceName: string,
    image: RasterImage,
    layers: readonly EditorLayer[],
  ) => void;
}

export interface EditorPageHandles {
  readonly canvasHost: HTMLCanvasElement;
  readonly layersList: HTMLElement;
  readonly summary: HTMLElement;
  readonly btnPropose: HTMLElement;
  readonly btnExportForge: HTMLElement;
  readonly btnUndo: HTMLElement;
  readonly btnBrushAdd: HTMLElement;
  readonly btnBrushErase: HTMLElement;
}

interface PageState {
  layers: EditorLayer[];
  activeLayer: number;
  brushValue: 0 | 255;
  source: { name: string; image: RasterImage } | null;
  undoStack: EditorLayer[][];
}

export function createEditorPage(
  handles: EditorPageHandles,
  callbacks: EditorPageCallbacks,
): { refresh: () => void } {
  const state: PageState = {
    layers: [],
    activeLayer: 0,
    brushValue: 255,
    source: null,
    undoStack: [],
  };
  const context = handles.canvasHost.getContext('2d')!;
  if (context === null) throw new Error('editor: cannot acquire 2d context');
  const scale = 4;

  function pushUndo(): void {
    state.undoStack.push(state.layers.map((l) => ({ ...l, mask: cloneMask(l.mask) })));
    if (state.undoStack.length > 50) state.undoStack.shift();
  }

  function cloneMask(mask: Mask): Mask {
    return { width: mask.width, height: mask.height, data: new Uint8Array(mask.data) };
  }

  function refresh(): void {
    renderCanvas();
    renderLayerList();
  }

  function renderCanvas(): void {
    const source = state.source;
    if (source === null) {
      context.clearRect(0, 0, handles.canvasHost.width, handles.canvasHost.height);
      return;
    }
    handles.canvasHost.width = source.image.width * scale;
    handles.canvasHost.height = source.image.height * scale;
    context.imageSmoothingEnabled = false;
    const tmp = document.createElement('canvas');
    tmp.width = source.image.width;
    tmp.height = source.image.height;
    const tmpCtx = tmp.getContext('2d');
    if (tmpCtx !== null) {
      tmpCtx.putImageData(
        new ImageData(
          new Uint8ClampedArray(source.image.data),
          source.image.width,
          source.image.height,
        ),
        0,
        0,
      );
      context.drawImage(tmp, 0, 0, handles.canvasHost.width, handles.canvasHost.height);
    }
    state.layers.forEach((layer, index) => {
      if (!layer.visible) return;
      const bounds = boundsOf(layer.mask);
      if (bounds === null) return;
      context.strokeStyle = index === state.activeLayer ? '#ffd54a' : '#41c7ff';
      context.lineWidth = 1;
      context.strokeRect(
        bounds.x * scale,
        bounds.y * scale,
        bounds.width * scale,
        bounds.height * scale,
      );
    });
    handles.summary.textContent = `${state.layers.length} layer(s) · active: ${state.layers[state.activeLayer]?.name ?? 'none'}`;
  }

  function boundsOf(mask: Mask): { x: number; y: number; width: number; height: number } | null {
    let minX = mask.width;
    let minY = mask.height;
    let maxX = -1;
    let maxY = -1;
    for (let y = 0; y < mask.height; y++) {
      for (let x = 0; x < mask.width; x++) {
        if (mask.data[y * mask.width + x] !== 0) {
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;
        }
      }
    }
    if (maxX < 0) return null;
    return { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 };
  }

  function renderLayerList(): void {
    handles.layersList.replaceChildren();
    state.layers.forEach((layer, index) => {
      const item = document.createElement('li');
      item.className = index === state.activeLayer ? 'asset active' : 'asset';
      const label = document.createElement('span');
      label.textContent = layer.name;
      label.addEventListener('click', () => {
        state.activeLayer = index;
        refresh();
      });
      item.append(label);
      handles.layersList.append(item);
    });
  }

  function proposeLayers(): void {
    const source = state.source ?? callbacks.getActiveSource();
    if (source === null) {
      callbacks.log('editor: no assets loaded');
      return;
    }
    state.source = source;
    pushUndo();
    state.layers = proposeEditorLayers(source.image, callbacks.getPipeline(), 2);
    state.activeLayer = 0;
    callbacks.log(`editor: ${state.layers.length} layer proposal(s)`);
    refresh();
  }

  function exportForge(): void {
    if (state.source === null || state.layers.length === 0) {
      callbacks.log('editor: nothing to export');
      return;
    }
    callbacks.onExportForge(state.source.name, state.source.image, state.layers);
  }

  function paintAt(clientX: number, clientY: number): void {
    const active = state.layers[state.activeLayer];
    if (active === undefined) return;
    const rect = handles.canvasHost.getBoundingClientRect();
    const x = Math.floor((clientX - rect.left) / scale);
    const y = Math.floor((clientY - rect.top) / scale);
    stampBrush(active.mask, x, y, 6, state.brushValue);
    refresh();
  }

  handles.btnPropose.addEventListener('click', () => {
    pushUndo();
    proposeLayers();
  });
  handles.btnExportForge.addEventListener('click', () => exportForge());
  handles.btnUndo.addEventListener('click', () => {
    const previous = state.undoStack.pop();
    if (previous === undefined) {
      callbacks.log('editor: nothing to undo');
      return;
    }
    state.layers = previous;
    callbacks.log('editor: undo');
    refresh();
  });
  handles.btnBrushAdd.addEventListener('click', () => {
    state.brushValue = 255;
  });
  handles.btnBrushErase.addEventListener('click', () => {
    state.brushValue = 0;
  });

  let dragging = false;
  handles.canvasHost.addEventListener('pointerdown', (event) => {
    if (state.layers.length === 0) return;
    dragging = true;
    pushUndo();
    paintAt(event.clientX, event.clientY);
  });
  handles.canvasHost.addEventListener('pointermove', (event) => {
    if (!dragging) return;
    paintAt(event.clientX, event.clientY);
  });
  handles.canvasHost.addEventListener('pointerup', () => {
    dragging = false;
  });

  return {
    refresh,
  };
}
