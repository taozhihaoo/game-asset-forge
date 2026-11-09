import {
  analyze,
  parsePreset,
  serializePreset,
  runPipeline,
  type Pipeline,
  type QualityReport,
  type RasterImage,
  type Rect,
} from '@gameasset-forge/core';
import { decodePngInBrowser, encodePngInBrowser, joinPath } from './decode.js';
import { ForgeCanvas, type CanvasTool } from './canvas.js';
import { AppStore, effectivePipeline, type AppState, type SourceMeta } from './state.js';
import { logLine, renderAssets, renderProperties } from './panels.js';
import {
  buildQualityAssets,
  renderQualityList,
  toReportJson,
  type QualityReportJson,
} from './quality.js';
import { buildSpriteFramesTres } from '../../../cli/src/exporters/godot.js';
import { buildUnityImporterScript } from '../../../cli/src/exporters/unity.js';
import { renderQualityReportHtml } from '../../../cli/src/reporting/html.js';
import {
  describeSuggestions as describeAiSuggestions,
  deriveFrom as deriveAiFrom,
  getMockProvider as getAiMockProvider,
  renderAiResults,
  runUnderstanding as runAiUnderstanding,
  type AiEntryState,
  type AiSuggestionSet,
} from './ai-assistant.js';
import { createEditorPage } from './editor-page.js';
import { getLang, initI18n, LANGUAGE_EVENT, setLang, t, type Lang } from './i18n.js';

/**
 * App wiring: toolbar, drag & drop, preview loop (debounced), preset
 * load/save through the SAME schema as the CLI, and export via the
 * preload bridge. No pipeline logic lives here — core does the work.
 *
 * The store subscription is the single source of truth for the UI: it feeds
 * the assets/properties panels, the canvas view/selection, the HUD and the
 * status bar. Results (with composed atlas page bitmaps) are pushed by the
 * preview loop, which is the only place that runs the pipeline.
 */

interface LoadedSource {
  readonly meta: SourceMeta;
  readonly bitmap: ImageBitmap;
  readonly image: Parameters<typeof runPipeline>[0];
  /** Encoded file size from the original bytes (quality KB reporting). */
  readonly byteSize: number;
}

const store = new AppStore();
const loaded = new Map<string, LoadedSource>();
let previewTimer: number | undefined;
let previewGeneration = 0;
let editorPageRef: { refresh: () => void } | null = null;

const $ = (id: string): HTMLElement => {
  const el = document.getElementById(id);
  if (el === null) throw new Error(`missing #${id}`);
  return el;
};

const canvas = new ForgeCanvas($('canvas-host'), {
  getManualRects: () => store.getState().manualRects,
  onRectCommitted: (rect: Rect) => {
    store.addManualRect(rect);
    log($('log'), t('log.manualRectAdded', { w: rect.width, h: rect.height }));
    schedulePreview();
  },
  onRectChanged: (index: number, rect: Rect) => {
    store.updateManualRect(index, rect);
    schedulePreview();
  },
  onSelectionChanged: (selection) => store.set({ selection }),
  onZoomChanged: (zoom) => {
    $('canvas-zoom').textContent = `${Math.round(zoom * 100)}%`;
  },
});

function log(host: HTMLElement, line: string): void {
  logLine(host, line);
}

/** RasterImage → ImageBitmap (no PNG round-trip needed for the atlas preview). */
async function rasterToBitmap(image: RasterImage): Promise<ImageBitmap> {
  return createImageBitmap(
    new ImageData(new Uint8ClampedArray(image.data), image.width, image.height),
  );
}

// --- quality page (V2) ---------------------------------------------------------

let lastQualityReport: QualityReport | null = null;

function runQualityAnalysis(): void {
  try {
    const state = store.getState();
    const sources = [...loaded.entries()].map(([name, source]) => ({
      name,
      raster: source.image,
      byteSize: source.byteSize,
    }));
    lastQualityReport = analyze(buildQualityAssets(sources), state.pipeline.quality);
    renderQualityList($('quality-list'), lastQualityReport);
    const report = lastQualityReport;
    $('quality-summary').textContent = t('quality.summary', {
      assets: report.assets,
      warnings: report.warnings,
    });
    log($('log'), t('log.qualityDone', { warnings: report.warnings, assets: report.assets }));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    lastQualityReport = null;
    renderQualityList($('quality-list'), null);
    log($('log'), t('log.analysisFailed', { message }));
  }
}

async function exportQualityReport(): Promise<void> {
  if (lastQualityReport === null) {
    log($('log'), t('log.qualityNeedRun'));
    return;
  }
  const dir = await window.forge.chooseOutputDir();
  if (dir === null) return;
  const reportJson: QualityReportJson = toReportJson(lastQualityReport);
  await window.forge.writeFile(
    joinPath(dir, 'quality_report.json'),
    new TextEncoder().encode(`${JSON.stringify(reportJson, null, 2)}\n`),
  );
  await window.forge.writeFile(
    joinPath(dir, 'quality_report.html'),
    new TextEncoder().encode(renderQualityReportHtml(reportJson)),
  );
  log($('log'), t('log.qualityExported', { dir }));
}

function showTab(tab: 'pipeline' | 'quality' | 'ai' | 'editor'): void {
  const views: Record<typeof tab, string> = {
    pipeline: 'pipeline-view',
    quality: 'quality-view',
    ai: 'ai-view',
    editor: 'editor-view',
  };
  for (const [name, id] of Object.entries(views)) $(id).hidden = name !== tab;
  for (const id of ['tab-pipeline', 'tab-quality', 'tab-ai', 'tab-editor']) {
    $(id).classList.toggle('active', $(id).dataset.tab === tab);
  }
  if (tab === 'quality') runQualityAnalysis();
  if (tab === 'ai') void runAiPage();
  if (tab === 'editor') editorPageRef?.refresh();
}

// --- AI Assistant page (V3) ------------------------------------------------------

const aiProvider = getAiMockProvider();
let aiStates: AiEntryState[] = [];
let aiSuggestions: AiSuggestionSet | null = null;
let aiAssetCount = 0;

async function runAiPage(): Promise<void> {
  try {
    const sources = [...loaded.values()].map((source) => ({
      name: source.meta.name,
      raster: source.image,
      byteSize: source.byteSize,
    }));
    if (sources.length === 0) {
      $('ai-summary').textContent = t('ai.noAssets');
      aiSuggestions = null;
      aiStates = [];
      aiAssetCount = 0;
      renderAiResults($('ai-results'), [], { onApply: () => {}, onIgnore: () => {} });
      return;
    }
    const understandings = await runAiUnderstanding(sources, aiProvider);
    aiSuggestions = deriveAiFrom(
      understandings.map((entry) => ({ name: entry.source, result: entry.result })),
    );
    aiStates = describeAiSuggestions(aiSuggestions);
    aiAssetCount = understandings.length;
    $('ai-summary').textContent = t('ai.summary', { assets: aiAssetCount, n: aiStates.length });
    renderAiPageEntries();
    log($('log'), t('log.aiDone', { n: aiStates.length, assets: aiAssetCount }));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log($('log'), t('log.analysisFailed', { message }));
  }
}

function renderAiPageEntries(): void {
  renderAiResults($('ai-results'), aiStates, {
    onApply: (index: number) => {
      aiStates = aiStates.map((entry, i) =>
        i === index ? { ...entry, status: 'applied' as const } : entry,
      );
      log($('log'), t('log.suggestionApplied', { text: aiStates[index]?.text ?? '' }));
      renderAiPageEntries();
    },
    onIgnore: (index: number) => {
      aiStates = aiStates.map((entry, i) =>
        i === index ? { ...entry, status: 'ignored' as const } : entry,
      );
      renderAiPageEntries();
    },
  });
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
      byteSize: bytes.length,
    });
    const sources = buildSources();
    store.set({ sources, activeSource: name, result: null, page: 0, selection: null });
    canvas.setSource(decoded.bitmap);
    canvas.setResult(null, []);
    log(
      $('log'),
      t('log.loaded', {
        name,
        w: decoded.image.width,
        h: decoded.image.height,
        alpha: decoded.image.hasAlpha ? '' : t('assets.noAlpha'),
      }),
    );
    schedulePreview();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    // A failed reload must not leave a stale decoded source (and hence a
    // dangling activeSource) behind.
    loaded.delete(name);
    const current = store.getState();
    const activeSource = current.activeSource === name ? null : current.activeSource;
    store.set({
      sources: [
        ...current.sources.filter((s) => s.name !== name),
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
      activeSource,
      result: activeSource === null ? null : current.result,
    });
    canvas.setSource(activeSource === null ? null : (loaded.get(activeSource)?.bitmap ?? null));
    canvas.setResult(null, []);
    log($('log'), t('log.loadFailed', { name, message }));
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
  previewTimer = window.setTimeout(() => void rerunPreview(), 250);
}

async function rerunPreview(): Promise<void> {
  const generation = ++previewGeneration;
  const state = store.getState();
  const active = state.activeSource;
  if (active === null) return;
  const source = loaded.get(active);
  if (source === undefined) return;
  try {
    const result = runPipeline(source.image, effectivePipeline(state), { sourcePath: active });
    const bitmaps = await Promise.all(result.pages.map(rasterToBitmap));
    if (generation !== previewGeneration) {
      for (const bitmap of bitmaps) bitmap.close();
      return;
    }
    canvas.setResult(result, bitmaps);
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
    canvas.setResult(null, []);
    store.set({ lastError: message, result: null });
    log($('log'), t('log.previewError', { message }));
  }
}

// --- export ---------------------------------------------------------------------

async function exportOutputs(): Promise<void> {
  const state = store.getState();
  if (state.result === null || state.activeSource === null) {
    log($('log'), t('log.exportNothing'));
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
    log($('log'), t('log.exported', { n: result.pages.length, dir }));
    if (state.pipeline.output.godot.enabled) {
      await window.forge.writeFile(
        joinPath(dir, `${baseName}_spriteframes.tres`),
        new TextEncoder().encode(buildSpriteFramesTres(result.manifest)),
      );
      log($('log'), t('log.exportedTres', { name: baseName }));
    }
    if (state.pipeline.output.unity.enabled) {
      await window.forge.writeFile(
        joinPath(dir, 'GameAssetForgeImporter.cs'),
        new TextEncoder().encode(buildUnityImporterScript()),
      );
      log($('log'), t('log.exportedUnity'));
    }
  } catch (error) {
    log($('log'), t('log.exportFailed', { message: errorMessage(error) }));
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

// --- preset -----------------------------------------------------------------------

async function loadPresetDialog(): Promise<void> {
  const path = await window.forge.openPreset();
  if (path === null) return;
  try {
    const bytes = await window.forge.readFile(path);
    const pipeline = parsePreset(JSON.parse(new TextDecoder().decode(bytes)));
    store.mutateEditing(() => ({ pipeline }));
    log($('log'), t('log.presetLoaded', { name: basename(path) }));
    schedulePreview();
  } catch (error) {
    log($('log'), t('log.presetLoadFailed', { message: errorMessage(error) }));
  }
}

async function savePresetDialog(): Promise<void> {
  const content = serializePreset(effectivePipeline(store.getState()));
  const saved = await window.forge.savePreset('preset.json', content);
  if (saved !== null) log($('log'), t('log.presetSaved', { name: basename(saved) }));
}

function newPreset(): void {
  store.mutateEditing(() => ({ pipeline: parsePreset({ schemaVersion: 1 }), manualRects: [] }));
  log($('log'), t('log.presetReset'));
  schedulePreview();
}

// --- UI chrome ------------------------------------------------------------------

function updateHud(state: AppState): void {
  const hasSource = state.activeSource !== null;
  $('canvas-empty').hidden = hasSource;
  $('canvas-hud').hidden = !hasSource;
  $('assets-empty').hidden = state.sources.length > 0;
  $('assets-count').textContent = String(state.sources.length);
  if (!hasSource) return;

  const page = state.result?.atlas.pages[state.page];
  const source = loaded.get(state.activeSource ?? '');
  const size =
    state.view === 'atlas'
      ? page !== undefined
        ? `${page.width}×${page.height}`
        : '—'
      : source !== undefined
        ? `${source.image.width}×${source.image.height}`
        : '—';
  $('canvas-mode').textContent =
    state.view === 'atlas' ? t('canvas.hudAtlas') : t('canvas.hudSource');
  $('canvas-size').textContent = size;
  $('canvas-zoom').textContent = `${Math.round(canvas.zoom * 100)}%`;
}

function updateStatusBar(state: AppState): void {
  const ready = state.sources.filter((s) => s.status === 'ready').length;
  const active = state.sources.find((s) => s.name === state.activeSource);
  $('stat-assets').textContent = String(ready);
  $('stat-sprites').textContent = String(active?.spriteCount ?? 0);
  $('stat-pages').textContent = String(state.result?.atlas.pages.length ?? 0);
  const message = $('status-message');
  if (state.lastError !== null) {
    message.textContent = state.lastError;
    message.classList.add('status-error');
  } else {
    message.textContent = ready === 0 ? t('status.noAssets') : t('status.ready');
    message.classList.remove('status-error');
  }
  $('status-lang').textContent = getLang() === 'zh' ? '中文' : 'EN';
}

function renderAll(): void {
  // Re-render everything that contains translated text. store.set({}) emits
  // to the subscription, which owns panels/HUD/status/page selects.
  store.set({});
  renderQualityList($('quality-list'), lastQualityReport);
  if (lastQualityReport !== null) {
    $('quality-summary').textContent = t('quality.summary', {
      assets: lastQualityReport.assets,
      warnings: lastQualityReport.warnings,
    });
  }
  if (aiSuggestions !== null) {
    const statuses = aiStates.map((entry) => entry.status);
    aiStates = describeAiSuggestions(aiSuggestions).map((entry, i) => ({
      ...entry,
      status: statuses[i] ?? 'open',
    }));
    $('ai-summary').textContent = t('ai.summary', { assets: aiAssetCount, n: aiStates.length });
    renderAiPageEntries();
  } else {
    renderAiResults($('ai-results'), [], { onApply: () => {}, onIgnore: () => {} });
  }
  editorPageRef?.refresh();
}

function isEditingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return (
    target.tagName === 'INPUT' ||
    target.tagName === 'TEXTAREA' ||
    target.tagName === 'SELECT' ||
    target.isContentEditable
  );
}

// --- boot ----------------------------------------------------------------------------

async function boot(): Promise<void> {
  initI18n();
  await canvas.init();

  store.subscribe(() => {
    const state = store.getState();
    renderAssets($('assets-list'), state.sources, state.activeSource, (name) => {
      store.set({ activeSource: name, result: null, selection: null, page: 0 });
      const source = loaded.get(name);
      canvas.setSource(source?.bitmap ?? null);
      canvas.setResult(null, []);
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
    const showPages = state.view === 'atlas' && pages > 1;
    $('page-wrap').hidden = !showPages;
    pageSelect.hidden = !showPages;
    if (pageSelect.options.length !== pages) {
      pageSelect.replaceChildren(
        ...Array.from(
          { length: pages },
          (_, i) => new Option(`${t('canvas.page')} ${i}`, String(i)),
        ),
      );
    }
    if (pages > 0) pageSelect.value = String(Math.min(state.page, pages - 1));
    canvas.setView(state.view, state.page);
    canvas.setSelection(state.selection);
    canvas.setManualRects(state.manualRects);
    updateHud(state);
    updateStatusBar(state);
    void state.lastError; // surfaced via log + status bar
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
    if (!store.undo()) log($('log'), t('log.undoNothing'));
    schedulePreview();
  });
  $('btn-fit').addEventListener('click', () => canvas.fit());
  $('btn-100').addEventListener('click', () => canvas.zoom100());

  // log panel
  $('btn-log-clear').addEventListener('click', () => {
    $('log').textContent = '';
  });
  $('btn-log-toggle').addEventListener('click', () => {
    $('log-panel').classList.toggle('collapsed');
  });

  // language switch
  const langSelect = $('lang-select') as HTMLSelectElement;
  langSelect.value = getLang();
  langSelect.addEventListener('change', () => {
    const lang = langSelect.value as Lang;
    setLang(lang);
    log($('log'), t('log.language', { lang: lang === 'zh' ? t('lang.zh') : t('lang.en') }));
  });
  document.addEventListener(LANGUAGE_EVENT, () => {
    langSelect.value = getLang();
    renderAll();
  });

  // quality / ai / editor pages
  showTab('pipeline');
  $('tab-pipeline').addEventListener('click', () => showTab('pipeline'));
  $('tab-quality').addEventListener('click', () => showTab('quality'));
  $('tab-ai').addEventListener('click', () => showTab('ai'));
  $('btn-ai-analyze').addEventListener('click', () => void runAiPage());
  $('tab-editor').addEventListener('click', () => showTab('editor'));
  $('btn-analyze').addEventListener('click', () => runQualityAnalysis());
  $('btn-export-report').addEventListener('click', () => void exportQualityReport());

  editorPageRef = createEditorPage(
    {
      canvasHost: $('ed-canvas') as HTMLCanvasElement,
      layersList: $('ed-layers'),
      summary: $('ed-summary'),
      btnPropose: $('btn-ed-propose'),
      btnExportForge: $('btn-ed-export'),
      btnUndo: $('btn-ed-undo'),
      btnBrushAdd: $('btn-ed-brush-add'),
      btnBrushErase: $('btn-ed-brush-erase'),
    },
    {
      log: (line) => log($('log'), line),
      getActiveSource: () => {
        const state = store.getState();
        const name = state.activeSource;
        if (name === null) return null;
        const source = loaded.get(name);
        return source ? { name, image: source.image } : null;
      },
      getPipeline: () => store.getState().pipeline,
      onExportForge: (sourceName, image, layers) => {
        void window.forge
          .chooseOutputDir()
          .then((dir) => {
            if (dir === null) return;
            const project = {
              forgeVersion: 1,
              asset: { source: sourceName, width: image.width, height: image.height },
              layers: layers.map((l, i) => ({
                id: l.id,
                name: l.name,
                z: i,
                sourceRect: { x: 0, y: 0, width: 0, height: 0 },
                dilation: l.dilation,
              })),
              bones: [],
              mesh: [],
              weights: [],
              animationTemplates: ['idle', 'breathing'],
            };
            return window.forge.writeFile(
              joinPath(dir, 'project.forge'),
              new TextEncoder().encode(`${JSON.stringify(project, null, 2)}\n`),
            );
          })
          .then(() => log($('log'), t('log.forgeExported')));
      },
    },
  );

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
    store.set({ view: viewSelect.value as 'source' | 'atlas', page: 0 });
  });
  const pageSelect = $('page-select') as HTMLSelectElement;
  pageSelect.addEventListener('change', () => {
    store.set({ page: Number(pageSelect.value) });
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

  // keyboard — never steal keys from text inputs, selects or editable content.
  document.addEventListener('keydown', (e) => {
    if (isEditingTarget(e.target)) return;
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
      e.preventDefault();
      if (!store.undo()) log($('log'), t('log.undoNothing'));
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

  store.set({});
  log($('log'), t('log.ready'));
}

void boot();
