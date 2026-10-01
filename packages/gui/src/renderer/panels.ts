import type { ManualRect, Pipeline, PipelineResult, Rect } from '@gameasset-forge/core';
import type { AppState, Selection, SourceMeta } from './state.js';

/**
 * DOM panels (charter §18): LEFT assets, RIGHT properties, BOTTOM log.
 * All pipeline parameters render from — and write back to — the same
 * normalized Pipeline the CLI uses (charter §27: no hidden state).
 */

// ---------------------------------------------------------------------------
// assets (LEFT)
// ---------------------------------------------------------------------------

export function renderAssets(
  host: HTMLElement,
  sources: readonly SourceMeta[],
  activeSource: string | null,
  onSelect: (name: string) => void,
): void {
  host.replaceChildren();
  for (const source of sources) {
    const item = document.createElement('li');
    item.className = source.name === activeSource ? 'asset active' : 'asset';
    const title = document.createElement('div');
    title.className = 'asset-name';
    title.textContent = source.name;
    title.addEventListener('click', () => onSelect(source.name));
    const meta = document.createElement('div');
    meta.className = 'asset-meta';
    meta.textContent =
      source.status === 'error'
        ? `error: ${source.errorMessage ?? 'unknown'}`
        : `${source.width}x${source.height}${source.hasAlpha ? '' : ' · no alpha'} · ${
            source.spriteCount ?? '…'
          } sprites`;
    meta.className = source.status === 'error' ? 'asset-meta error' : 'asset-meta';
    item.append(title, meta);
    host.append(item);
  }
}

// ---------------------------------------------------------------------------
// properties (RIGHT)
// ---------------------------------------------------------------------------

export interface PropertyCallbacks {
  onPipelineChange(mutate: (pipeline: Pipeline) => Pipeline): void;
  onDetectModeChange(mode: 'alpha-connected-components' | 'grid' | 'manual'): void;
  onSelectionChange(selection: Selection | null): void;
  onDeleteManual(index: number): void;
}

export function renderProperties(
  host: HTMLElement,
  state: AppState,
  callbacks: PropertyCallbacks,
): void {
  host.replaceChildren();
  const pipeline = state.pipeline;
  const change = callbacks.onPipelineChange;

  const section = (title: string): HTMLDetailsElement => {
    const details = document.createElement('details');
    details.open = true;
    const summary = document.createElement('summary');
    summary.textContent = title;
    details.append(summary);
    host.append(details);
    const body = document.createElement('div');
    body.className = 'prop-body';
    details.append(body);
    return details;
  };

  const row = (parent: HTMLElement, label: string): HTMLDivElement => {
    const div = document.createElement('div');
    div.className = 'prop-row';
    const span = document.createElement('label');
    span.textContent = label;
    div.append(span);
    parent.append(div);
    return div;
  };

  const numberInput = (
    parent: HTMLElement,
    label: string,
    value: number,
    onCommit: (v: number) => void,
    step = 1,
  ): void => {
    const div = row(parent, label);
    const input = document.createElement('input');
    input.type = 'number';
    input.step = String(step);
    input.value = String(value);
    input.addEventListener('change', () => {
      const parsed = Number(input.value);
      if (Number.isFinite(parsed)) onCommit(parsed);
    });
    div.append(input);
  };

  const checkInput = (
    parent: HTMLElement,
    label: string,
    value: boolean,
    onCommit: (v: boolean) => void,
  ): void => {
    const div = row(parent, label);
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.checked = value;
    input.addEventListener('change', () => onCommit(input.checked));
    div.append(input);
  };

  const selectInput = <T extends string>(
    parent: HTMLElement,
    label: string,
    value: T,
    options: readonly { value: T; label: string }[],
    onCommit: (v: T) => void,
  ): void => {
    const div = row(parent, label);
    const select = document.createElement('select');
    for (const option of options) {
      const el = document.createElement('option');
      el.value = option.value;
      el.textContent = option.label;
      select.append(el);
    }
    select.value = value;
    select.addEventListener('change', () => onCommit(select.value as T));
    div.append(select);
  };

  // detection -----------------------------------------------------------------
  const detect = section(`Detection (${pipeline.detect.mode})`);
  selectInput(
    detect,
    'mode',
    pipeline.detect.mode,
    [
      { value: 'alpha-connected-components', label: 'alpha-connected-components' },
      { value: 'grid', label: 'grid' },
      { value: 'manual', label: 'manual' },
    ],
    (mode) => callbacks.onDetectModeChange(mode),
  );
  if (pipeline.detect.mode === 'alpha-connected-components') {
    numberInput(detect, 'alphaThreshold', pipeline.detect.alphaThreshold, (v) =>
      change((p) =>
        p.detect.mode === 'alpha-connected-components'
          ? { ...p, detect: { ...p.detect, alphaThreshold: clampInt(v, 0, 255) } }
          : p,
      ),
    );
    numberInput(detect, 'minPixels', pipeline.detect.minPixels, (v) =>
      change((p) =>
        p.detect.mode === 'alpha-connected-components'
          ? { ...p, detect: { ...p.detect, minPixels: clampInt(v, 1, Number.MAX_SAFE_INTEGER) } }
          : p,
      ),
    );
  }
  if (pipeline.detect.mode === 'grid') {
    if (pipeline.detect.rows !== undefined) {
      numberInput(detect, 'rows', pipeline.detect.rows, (v) =>
        change((p) =>
          p.detect.mode === 'grid'
            ? { ...p, detect: { ...p.detect, rows: clampInt(v, 1, 10000) } }
            : p,
        ),
      );
    }
    if (pipeline.detect.columns !== undefined) {
      numberInput(detect, 'columns', pipeline.detect.columns, (v) =>
        change((p) =>
          p.detect.mode === 'grid'
            ? { ...p, detect: { ...p.detect, columns: clampInt(v, 1, 10000) } }
            : p,
        ),
      );
    }
    if (pipeline.detect.cellWidth !== undefined) {
      numberInput(detect, 'cellWidth', pipeline.detect.cellWidth, (v) =>
        change((p) =>
          p.detect.mode === 'grid'
            ? { ...p, detect: { ...p.detect, cellWidth: clampInt(v, 1, 16384) } }
            : p,
        ),
      );
    }
    if (pipeline.detect.cellHeight !== undefined) {
      numberInput(detect, 'cellHeight', pipeline.detect.cellHeight, (v) =>
        change((p) =>
          p.detect.mode === 'grid'
            ? { ...p, detect: { ...p.detect, cellHeight: clampInt(v, 1, 16384) } }
            : p,
        ),
      );
    }
  }

  // trim ----------------------------------------------------------------------
  const trim = section('Trim');
  checkInput(trim, 'enabled', pipeline.trim.enabled, (v) =>
    change((p) => ({ ...p, trim: { ...p.trim, enabled: v } })),
  );
  numberInput(trim, 'alphaThreshold', pipeline.trim.alphaThreshold, (v) =>
    change((p) => ({ ...p, trim: { ...p.trim, alphaThreshold: clampInt(v, 0, 255) } })),
  );

  // resize --------------------------------------------------------------------
  const resize = section('Resize');
  checkInput(resize, 'enabled', pipeline.resize.enabled, (v) =>
    change((p) => ({ ...p, resize: { ...p.resize, enabled: v } })),
  );
  numberInput(
    resize,
    'scale',
    pipeline.resize.scale,
    (v) =>
      change((p) => ({ ...p, resize: { ...p.resize, scale: Math.min(64, Math.max(0.01, v)) } })),
    0.5,
  );
  selectInput(
    resize,
    'filter',
    pipeline.resize.filter,
    [
      { value: 'nearest', label: 'nearest' },
      { value: 'linear', label: 'linear' },
    ],
    (filter) => change((p) => ({ ...p, resize: { ...p.resize, filter } })),
  );

  // margins ---------------------------------------------------------------------
  const margins = section('Margins');
  numberInput(margins, 'padding (px)', pipeline.padding.pixels, (v) =>
    change((p) => ({ ...p, padding: { pixels: clampInt(v, 0, 64) } })),
  );
  numberInput(margins, 'bleed (px)', pipeline.bleed.pixels, (v) =>
    change((p) => ({ ...p, bleed: { pixels: clampInt(v, 0, 64) } })),
  );

  // pivot -----------------------------------------------------------------------
  const pivot = section('Pivot');
  selectInput(
    pivot,
    'mode',
    pipeline.pivot.mode,
    [
      { value: 'center', label: 'center' },
      { value: 'bottom-center', label: 'bottom-center' },
      { value: 'manual', label: 'manual' },
    ],
    (mode) => {
      change((p) =>
        mode === 'manual'
          ? { ...p, pivot: { mode: 'manual', x: 0.5, y: 1 } }
          : { ...p, pivot: { mode } },
      );
    },
  );
  if (pipeline.pivot.mode === 'manual') {
    numberInput(
      pivot,
      'x',
      pipeline.pivot.x,
      (v) =>
        change((p) =>
          p.pivot.mode === 'manual'
            ? { ...p, pivot: { mode: 'manual', x: clamp01(v), y: p.pivot.y } }
            : p,
        ),
      0.05,
    );
    numberInput(
      pivot,
      'y',
      pipeline.pivot.y,
      (v) =>
        change((p) =>
          p.pivot.mode === 'manual'
            ? { ...p, pivot: { mode: 'manual', x: p.pivot.x, y: clamp01(v) } }
            : p,
        ),
      0.05,
    );
  }

  // atlas -----------------------------------------------------------------------
  const atlas = section('Atlas');
  numberInput(atlas, 'maxWidth', pipeline.atlas.maxWidth, (v) =>
    change((p) => ({ ...p, atlas: { ...p.atlas, maxWidth: clampInt(v, 1, 16384) } })),
  );
  numberInput(atlas, 'maxHeight', pipeline.atlas.maxHeight, (v) =>
    change((p) => ({ ...p, atlas: { ...p.atlas, maxHeight: clampInt(v, 1, 16384) } })),
  );
  numberInput(atlas, 'spacing', pipeline.atlas.spacing, (v) =>
    change((p) => ({ ...p, atlas: { ...p.atlas, spacing: clampInt(v, 0, 128) } })),
  );

  // output ----------------------------------------------------------------------
  const output = section('Export');
  checkInput(output, 'godot .tres', pipeline.output.godot.enabled, (v) =>
    change((p) => ({ ...p, output: { ...p.output, godot: { enabled: v } } })),
  );
  checkInput(output, 'unity importer', pipeline.output.unity.enabled, (v) =>
    change((p) => ({ ...p, output: { ...p.output, unity: { enabled: v } } })),
  );

  // selection info ----------------------------------------------------------------
  const info = section('Selection');
  if (state.selection === null) {
    info.append(text('nothing selected'));
  } else if (state.selection.type === 'sprite') {
    const sprite = state.result?.sprites[state.selection.index];
    info.append(
      text(
        sprite === undefined
          ? 'sprite unavailable'
          : `${sprite.id}\nsourceRect (${sprite.sourceRect.x}, ${sprite.sourceRect.y}) ${sprite.sourceRect.width}x${sprite.sourceRect.height}\ncontent ${sprite.trimmedRect.width}x${sprite.trimmedRect.height}\npivot (${sprite.pivot.x}, ${sprite.pivot.y})`,
      ),
    );
  } else {
    const rect = state.manualRects[state.selection.index];
    if (rect !== undefined) {
      const div = document.createElement('div');
      div.append(
        text(`manual ${rect.id ?? ''}\n(${rect.x}, ${rect.y}) ${rect.width}x${rect.height}`),
      );
      const edit = document.createElement('button');
      edit.textContent = 'Delete rect';
      edit.addEventListener('click', () => callbacks.onDeleteManual(state.selection!.index));
      div.append(edit);
      info.append(div);
    }
  }

  if (state.manualRects.length > 0 && pipeline.detect.mode !== 'manual') {
    host.append(
      text(`note: ${state.manualRects.length} manual rect(s) exist but detect mode is not manual`),
    );
  }
}

function text(content: string): HTMLElement {
  const pre = document.createElement('pre');
  pre.className = 'prop-text';
  pre.textContent = content;
  return pre;
}

function clampInt(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Math.round(value)));
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

// ---------------------------------------------------------------------------
// log (BOTTOM)
// ---------------------------------------------------------------------------

export function logLine(host: HTMLElement, line: string): void {
  const stamp = new Date().toLocaleTimeString();
  host.textContent += `[${stamp}] ${line}\n`;
  while ((host.textContent ?? '').split('\n').length > 500) {
    host.textContent = (host.textContent ?? '').split('\n').slice(1).join('\n');
  }
  host.scrollTop = host.scrollHeight;
}

export function selectionSummary(state: AppState): string {
  if (state.selection === null) return '';
  if (state.selection.type === 'manual') {
    const rect: ManualRect | undefined = state.manualRects[state.selection.index];
    return rect ? `manual ${rect.width}x${rect.height}` : '';
  }
  const sprite: PipelineResult['sprites'][number] | undefined =
    state.result?.sprites[state.selection.index];
  return sprite ? sprite.id : '';
}

export type { Rect };
