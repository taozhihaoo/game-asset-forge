import {
  DEFAULT_PIPELINE,
  type ManualRect,
  type Pipeline,
  type PipelineResult,
  type Rect,
} from '@gameasset-forge/core';
import { parsePreset } from '@gameasset-forge/core';

/**
 * Renderer application state — DOM-free and unit-testable.
 *
 * Charter §27 (no hidden state): every pipeline parameter lives in
 * `pipeline` (the same normalized structure CLI uses); `manualRects` is the
 * documented manual-fallback overlay that feeds `detect.mode = manual`.
 * The only UI-only fields are view/page/selection, which never affect
 * pipeline output.
 */

export interface SourceMeta {
  /** Display + id name ('/'-normalized, no directories in drop context). */
  readonly name: string;
  readonly status: 'ready' | 'error';
  readonly width: number;
  readonly height: number;
  readonly hasAlpha: boolean;
  readonly spriteCount: number | null;
  readonly errorMessage: string | null;
}

export interface Selection {
  readonly type: 'sprite' | 'manual';
  readonly index: number;
}

export interface AppState {
  readonly pipeline: Pipeline;
  /** Manual fallback rects (charter §18: designed degradation, not an error). */
  readonly manualRects: readonly ManualRect[];
  readonly sources: readonly SourceMeta[];
  readonly activeSource: string | null;
  readonly result: PipelineResult | null;
  readonly lastError: string | null;
  /** UI-only: source (before) vs atlas (after) preview. */
  readonly view: 'source' | 'atlas';
  readonly page: number;
  readonly selection: Selection | null;
}

/** Undo snapshots cover exactly the things that change output/input semantics. */
interface UndoEntry {
  readonly pipeline: Pipeline;
  readonly manualRects: readonly ManualRect[];
}

const UNDO_LIMIT = 50;

export function initialState(): AppState {
  return {
    pipeline: parsePreset({ schemaVersion: 1 }),
    manualRects: [],
    sources: [],
    activeSource: null,
    result: null,
    lastError: null,
    view: 'source',
    page: 0,
    selection: null,
  };
}

/**
 * Manual rects apply when detect mode is `manual` (drawing a rect switches
 * the mode — the documented fallback path). In auto modes the manual list is
 * kept for the user but does not affect detection.
 */
export function effectivePipeline(state: Pick<AppState, 'pipeline' | 'manualRects'>): Pipeline {
  if (state.pipeline.detect.mode !== 'manual') return state.pipeline;
  return { ...state.pipeline, detect: { mode: 'manual', rects: state.manualRects } };
}

export function defaultPipeline(): Pipeline {
  return DEFAULT_PIPELINE;
}

export class AppStore {
  private state: AppState = initialState();
  private undoStack: UndoEntry[] = [];
  private readonly listeners = new Set<() => void>();

  getState(): AppState {
    return this.state;
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit(): void {
    for (const listener of this.listeners) listener();
  }

  /** Non-undoable patch (view/page/selection/result/status fields). */
  set(patch: Partial<AppState>): void {
    this.state = { ...this.state, ...patch };
    this.emit();
  }

  /** Undoable pipeline/manual-rect mutation. */
  mutateEditing(mutate: (state: AppState) => Partial<AppState>): void {
    this.pushUndo();
    this.set(mutate(this.state));
  }

  private pushUndo(): void {
    this.undoStack.push({ pipeline: this.state.pipeline, manualRects: this.state.manualRects });
    if (this.undoStack.length > UNDO_LIMIT) this.undoStack.shift();
  }

  get canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  undo(): boolean {
    const entry = this.undoStack.pop();
    if (entry === undefined) return false;
    this.state = { ...this.state, pipeline: entry.pipeline, manualRects: entry.manualRects };
    this.emit();
    return true;
  }

  // --- manual rect operations (all undoable) --------------------------------

  addManualRect(rect: Rect): void {
    this.mutateEditing((state) => {
      const id = `rect-${String(state.manualRects.length + 1).padStart(4, '0')}`;
      return {
        pipeline:
          state.pipeline.detect.mode === 'manual'
            ? state.pipeline
            : { ...state.pipeline, detect: { mode: 'manual', rects: [] } },
        manualRects: [...state.manualRects, { ...rect, id }],
      };
    });
  }

  updateManualRect(index: number, rect: Rect): void {
    this.mutateEditing((state) => ({
      manualRects: state.manualRects.map((r, i) => (i === index ? { ...rect, id: r.id } : r)),
    }));
  }

  deleteManualRect(index: number): void {
    this.mutateEditing((state) => ({
      manualRects: state.manualRects.filter((_, i) => i !== index),
      selection: null,
    }));
  }
}
