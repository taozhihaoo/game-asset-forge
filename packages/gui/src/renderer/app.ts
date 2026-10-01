import {
  parsePreset,
  serializePreset,
  runPipeline,
  type Pipeline,
  type Rect,
} from '@gameasset-forge/core';
import { decodePngInBrowser, encodePngInBrowser, joinPath } from './decode.js';
import { ForgeCanvas, type CanvasTool } from './canvas.js';
import { AppStore, effectivePipeline, type SourceMeta } from './state.js';
import { logLine, renderAssets, renderProperties } from './panels.js';
import { buildSpriteFramesTres } from '../../../cli/src/exporters/godot.js';
import { buildUnityImporterScript } from '../../../cli/src/exporters/unity.js';

/**
 * App wiring: toolbar, drag & drop, preview loop (debounced), preset
 * load/save through the SAME schema as the CLI, and export via the
 * preload bridge. No pipeline logic lives here — core does the work.
 */

interface LoadedSource {
  readonly meta: SourceMeta;
  readonly bitmap: ImageBitmap;
  readonly image: Parameters<typeof runPipeline>[0];
}

const store = new AppStore();
const loaded = new Map<string, LoadedSource>();
let previewTimer: number | undefined;

const $ = (id: string): HTMLElement => {
  const el = document.getElementById(id);
  if (el === null) throw new Error(`missing #${id}`);
  return el;
};

const canvas = new ForgeCanvas($('canvas-host'), {
  getManualRects: () => store.getState().manualRects,
  onRectCommitted: (rect: Rect) => {
    store.addManualRect(rect);
    log($('log'), `manual rect added (${rect.width}x${rect.height}) — detect mode is now manual`);
  },
  onRectChanged: (index: number, rect: Rect) => {
    store.updateManualRect(index, rect);
  },
  onSelectionChanged: (selection) => store.set({ selection }),
});

function log(host: HTMLElement, line: string): void {
  logLine(host, line);
}

// --- sources -----------------------------------------------------------------

function basename(filePath: string): string {
  const parts = filePath.split(/[\\/]/);
  return parts[parts.length - 1] ?? filePath;
}

async function addSource(name: string, bytes: Uint8Array): Promise<void> {
  try {
    const decoded = await decodePngInBrowser(bytes);
    loaded.set(name, {
      meta: emptyMeta(name, decoded.image.width, decoded.image.height, decoded.image.hasAlpha),
      bitmap: decoded.bitmap,
      image: decoded.image,
    });
    const sources = buildSources();
    store.set({ sources, activeSource: name, result: null, page: 0, selection: null });
    canvas.setSource(decoded.bitmap);
    log(
      $('log'),
      `loaded ${name} (${decoded.image.width}x${decoded.image.height}${decoded.image.hasAlpha ? '' : ', no alpha'})`,
    );
    schedulePreview();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    store.set({
      sources: [
        ...store.getState().sources.filter((s) => s.name !== name),
        {
          name,
          status: 'error',
          width: 0,
          height: 0,
          hasAlpha: false,
          spriteCount: null,
          errorMessage: message,
        },
      ],
    });
    log($('log'), `failed to load ${name}: ${message}`);
  }
}

function emptyMeta(name: string, width: number, height: number, hasAlpha: boolean): SourceMeta {
  return { name, status: 'ready', width, height, hasAlpha, spriteCount: null, errorMessage: null };
}

function buildSources(): SourceMeta[] {
  const metas: SourceMeta[] = [];
  for (const [name, loadedItem] of loaded) {
    const existing = store.getState().sources.find((s) => s.name === name);
    metas.push({
      ...emptyMeta(
        name,
        loadedItem.image.width,
        loadedItem.image.height,
        loadedItem.image.hasAlpha,
      ),
      spriteCount: existing?.spriteCount ?? null,
    });
  }
  return metas;
}

// --- preview loop (debounced) --------------------------------------------------

function schedulePreview(): void {
  window.clearTimeout(previewTimer);
  previewTimer = window.setTimeout(rerunPreview, 250);
}

function rerunPreview(): void {
  const state = store.getState();
  const active = state.activeSource;
  if (active === null) return;
  const source = loaded.get(active);
  if (source === undefined) return;
  try {
    const result = runPipeline(source.image, effectivePipeline(state), { sourcePath: active });
    const sources = store
      .getState()
      .sources.map((s) =>
        s.name === active
          ? { ...s, spriteCount: result.sprites.length, status: 'ready' as const }
          : s,
      );
    store.set({
      result,
      sources,
      lastError: null,
      page: Math.min(state.page, Math.max(0, result.atlas.pages.length - 1)),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    store.set({ lastError: message });
    log($('log'), `preview: ${message}`);
  }
}

// --- export ---------------------------------------------------------------------

async function exportOutputs(): Promise<void> {
  const state = store.getState();
  if (state.result === null || state.activeSource === null) {
    log($('log'), 'export: nothing to export (no preview result)');
    return;
  }
  const dir = await window.forge.chooseOutputDir();
  if (dir === null) return;
  const result = state.result;
  const baseName = state.activeSource.replace(/\.png$/i, '');
  try {
    for (let i = 0; i < result.pages.length; i++) {
      const bytes = await encodePngInBrowser(result.pages[i]);
      await window.forge.writeFile(joinPath(dir, `atlas-${i}.png`), bytes);
    }
    await window.forge.writeFile(
      joinPath(dir, 'atlas.json'),
      new TextEncoder().encode(`${JSON.stringify(result.manifest, null, 2)}\n`),
    );
    log($('log'), `exported ${result.pages.length} page(s) + atlas.json → ${dir}`);
    if (state.pipeline.output.godot.enabled) {
      await window.forge.writeFile(
        joinPath(dir, `${baseName}_spriteframes.tres`),
        new TextEncoder().encode(buildSpriteFramesTres(result.manifest)),
      );
      log($('log'), `exported ${baseName}_spriteframes.tres`);
    }
    if (state.pipeline.output.unity.enabled) {
      await window.forge.writeFile(
        joinPath(dir, 'GameAssetForgeImporter.cs'),
        new TextEncoder().encode(buildUnityImporterScript()),
      );
      log($('log'), 'exported GameAssetForgeImporter.cs');
    }
  } catch (error) {
    log($('log'), `export failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}

// --- preset -----------------------------------------------------------------------

async function loadPresetDialog(): Promise<void> {
  const path = await window.forge.openPreset();
  if (path === null) return;
  try {
    const bytes = await window.forge.readFile(path);
    const pipeline = parsePreset(JSON.parse(new TextDecoder().decode(bytes)));
    store.mutateEditing(() => ({ pipeline }));
    log($('log'), `preset loaded: ${basename(path)}`);
  } catch (error) {
    log($('log'), `preset load failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}

async function savePresetDialog(): Promise<void> {
  const content = serializePreset(effectivePipeline(store.getState()));
  const saved = await window.forge.savePreset('preset.json', content);
  if (saved !== null) log($('log'), `preset saved: ${basename(saved)}`);
}

function newPreset(): void {
  store.mutateEditing(() => ({ pipeline: parsePreset({ schemaVersion: 1 }), manualRects: [] }));
  log($('log'), 'preset reset to defaults');
}

// --- boot ----------------------------------------------------------------------------

async function boot(): Promise<void> {
  await canvas.init();

  store.subscribe(() => {
    const state = store.getState();
    renderAssets($('assets-list'), state.sources, state.activeSource, (name) => {
      store.set({ activeSource: name, result: null, selection: null, page: 0 });
      const source = loaded.get(name);
      canvas.setSource(source?.bitmap ?? null);
      schedulePreview();
    });
    renderProperties($('properties-body'), state, {
      onPipelineChange: (mutate: (pipeline: Pipeline) => Pipeline) => {
        store.mutateEditing((s) => ({ pipeline: mutate(s.pipeline) }));
        schedulePreview();
      },
      onDetectModeChange: (mode) => {
        store.mutateEditing((s) => {
          const prev = s.pipeline.detect;
          if (mode === 'alpha-connected-components') {
            return {
              pipeline: {
                ...s.pipeline,
                detect: {
                  mode,
                  alphaThreshold: prev.mode === 'manual' ? 8 : prev.alphaThreshold,
                  minPixels: 4,
                  connectivity: 8,
                },
              },
            };
          }
          if (mode === 'grid') {
            return {
              pipeline: {
                ...s.pipeline,
                detect: {
                  mode,
                  cellWidth: 32,
                  cellHeight: 32,
                  alphaThreshold: prev.mode === 'manual' ? 8 : prev.alphaThreshold,
                },
              },
            };
          }
          return { pipeline: { ...s.pipeline, detect: { mode: 'manual', rects: s.manualRects } } };
        });
        schedulePreview();
      },
      onSelectionChange: (selection) => store.set({ selection }),
      onDeleteManual: (index) => {
        store.deleteManualRect(index);
        schedulePreview();
      },
    });
    const pageSelect = $('page-select') as HTMLSelectElement;
    const pages = state.result?.atlas.pages.length ?? 0;
    pageSelect.hidden = state.view !== 'atlas' || pages <= 1;
    if (pageSelect.options.length !== pages) {
      pageSelect.replaceChildren(
        ...Array.from({ length: pages }, (_, i) => new Option(`page ${i}`, String(i))),
      );
    }
    pageSelect.value = String(Math.min(state.page, pages - 1));
    canvas.setSelection(state.selection);
    canvas.setManualRects(state.manualRects);
    void state.lastError; // surfaced via log + assets panel
  });

  // toolbar
  $('btn-open').addEventListener('click', async () => {
    for (const path of await window.forge.openPngFiles()) {
      await addSource(basename(path), await window.forge.readFile(path));
    }
  });
  $('btn-export').addEventListener('click', () => void exportOutputs());
  $('btn-preset-new').addEventListener('click', newPreset);
  $('btn-preset-load').addEventListener('click', () => void loadPresetDialog());
  $('btn-preset-save').addEventListener('click', () => void savePresetDialog());
  $('btn-undo').addEventListener('click', () => {
    if (!store.undo()) log($('log'), 'undo: nothing to undo');
    schedulePreview();
  });
  $('btn-fit').addEventListener('click', () => canvas.fit());
  $('btn-100').addEventListener('click', () => canvas.zoom100());

  const setTool = (tool: CanvasTool, buttonId: string): void => {
    canvas.setTool(tool);
    for (const id of ['btn-tool-select', 'btn-tool-pan', 'btn-tool-rect']) {
      $(id).classList.toggle('active', id === buttonId);
    }
  };
  setTool('select', 'btn-tool-select');
  $('btn-tool-select').addEventListener('click', () => setTool('select', 'btn-tool-select'));
  $('btn-tool-pan').addEventListener('click', () => setTool('pan', 'btn-tool-pan'));
  $('btn-tool-rect').addEventListener('click', () => setTool('rect', 'btn-tool-rect'));

  const viewSelect = $('view-select') as HTMLSelectElement;
  viewSelect.addEventListener('change', () => {
    const view = viewSelect.value as 'source' | 'atlas';
    store.set({ view });
    if (view === 'atlas') {
      const source = store.getState().activeSource;
      if (source !== null) canvas.setSource(loaded.get(source)?.bitmap ?? null);
    }
    canvas.setView(view, store.getState().page);
  });
  const pageSelect = $('page-select') as HTMLSelectElement;
  pageSelect.addEventListener('change', () => {
    store.set({ page: Number(pageSelect.value) });
    canvas.setView(store.getState().view, store.getState().page);
  });

  // drag & drop (renderer-side: no fs needed, File.arrayBuffer is sandbox-safe)
  document.addEventListener('dragover', (e) => e.preventDefault());
  document.addEventListener('drop', (e) => {
    e.preventDefault();
    const files = [...(e.dataTransfer?.files ?? [])].filter((f) => /\.png$/i.test(f.name));
    void (async () => {
      for (const file of files) {
        await addSource(file.name, new Uint8Array(await file.arrayBuffer()));
      }
    })();
  });

  // keyboard
  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
      e.preventDefault();
      if (!store.undo()) log($('log'), 'undo: nothing to undo');
      schedulePreview();
      return;
    }
    if (e.key === 'Delete') {
      const selection = store.getState().selection;
      if (selection?.type === 'manual') {
        store.deleteManualRect(selection.index);
        schedulePreview();
      }
      return;
    }
    if (e.key === 'v' || e.key === 'V') setTool('select', 'btn-tool-select');
    if (e.key === 'p' || e.key === 'P') setTool('pan', 'btn-tool-pan');
    if (e.key === 'r' || e.key === 'R') setTool('rect', 'btn-tool-rect');
  });

  log($('log'), 'GameAsset Forge ready — drop PNG files or use Open');
}

void boot();
