import { Application, Container, Graphics, Sprite, Texture } from 'pixi.js';
import type { ManualRect, PipelineResult, Rect } from '@gameasset-forge/core';
import type { Selection } from './state.js';

/**
 * PixiJS interactive canvas (charter §18): zoom, pan, fit, reset, detected
 * rect overlays, selection highlight, pivot marker, and the manual rectangle
 * editor (drag to create, move, resize via corner handle, delete).
 * PixiJS never leaks into core — this module talks to the store via callbacks.
 */

export type CanvasTool = 'select' | 'pan' | 'rect';

export interface CanvasCallbacks {
  getManualRects(): readonly ManualRect[];
  onRectCommitted(rect: Rect): void;
  onRectChanged(index: number, rect: Rect): void;
  onSelectionChanged(selection: Selection | null): void;
}

interface DisplayedRect {
  readonly rect: Rect;
  readonly selection: Selection;
  readonly isManual: boolean;
}

const HANDLE_SIZE = 9; // screen px

export class ForgeCanvas {
  private app: Application | null = null;
  private world = new Container();
  private imageSprite: Sprite | null = null;
  private overlay = new Graphics();
  private draft = new Graphics();

  private bitmap: ImageBitmap | null = null;
  private result: PipelineResult | null = null;
  private view: 'source' | 'atlas' = 'source';
  private page = 0;
  private selection: Selection | null = null;
  private manualRects: readonly ManualRect[] = [];

  private scale = 1;
  private offsetX = 0;
  private offsetY = 0;

  private tool: CanvasTool = 'select';
  private drag: {
    mode: 'pan' | 'draft' | 'move' | 'resize';
    startWorld: { x: number; y: number };
    startOffset: { x: number; y: number };
    originRect?: Rect;
    moveIndex?: number;
    startScreen: { x: number; y: number };
  } | null = null;
  private draftRect: Rect | null = null;

  constructor(
    private readonly host: HTMLElement,
    private readonly callbacks: CanvasCallbacks,
  ) {}

  async init(): Promise<void> {
    this.app = new Application();
    await this.app.init({ background: 0x17181c, antialias: false, resizeTo: this.host });
    this.app.canvas.addEventListener('wheel', this.onWheel, { passive: false });
    this.app.canvas.addEventListener('pointerdown', this.onPointerDown);
    this.app.canvas.addEventListener('pointermove', this.onPointerMove);
    this.app.canvas.addEventListener('pointerup', this.onPointerUp);
    this.app.canvas.addEventListener('pointerleave', this.onPointerUp);
    this.app.stage.addChild(this.world);
    this.world.addChild(this.overlay);
    this.world.addChild(this.draft);
    this.host.appendChild(this.app.canvas);
    this.app.canvas.style.width = '100%';
    this.app.canvas.style.height = '100%';
    new ResizeObserver(() =>
      this.app?.renderer.resize(this.host.clientWidth, this.host.clientHeight),
    ).observe(this.host);
  }

  destroy(): void {
    void this.app?.destroy(true, { children: true });
    this.app = null;
  }

  // --- state ingestion -------------------------------------------------------

  setSource(bitmap: ImageBitmap | null): void {
    if (this.imageSprite !== null) {
      this.world.removeChild(this.imageSprite);
      this.imageSprite.destroy();
      this.imageSprite = null;
    }
    this.bitmap = bitmap;
    if (bitmap !== null) {
      this.imageSprite = new Sprite(Texture.from(bitmap));
      this.world.addChildAt(this.imageSprite, 0);
    }
    this.fit();
    this.redraw();
  }

  setResult(result: PipelineResult | null): void {
    this.result = result;
    this.redraw();
  }

  setView(view: 'source' | 'atlas', page: number): void {
    this.view = view;
    this.page = page;
    this.redraw();
  }

  setSelection(selection: Selection | null): void {
    this.selection = selection;
    this.redraw();
  }

  setManualRects(rects: readonly ManualRect[]): void {
    this.manualRects = rects;
    this.redraw();
  }

  setTool(tool: CanvasTool): void {
    this.tool = tool;
    this.app!.canvas.style.cursor =
      tool === 'rect' ? 'crosshair' : tool === 'pan' ? 'grab' : 'default';
  }

  // --- transforms ------------------------------------------------------------

  private get viewSize(): { width: number; height: number } {
    return { width: this.host.clientWidth, height: this.host.clientHeight };
  }

  private screenToWorld(sx: number, sy: number): { x: number; y: number } {
    return { x: (sx - this.offsetX) / this.scale, y: (sy - this.offsetY) / this.scale };
  }

  fit(): void {
    const source = this.displaySize();
    if (source === null || this.app === null) return;
    const view = this.viewSize;
    if (view.width < 10 || view.height < 10) return;
    const margin = 32;
    this.scale = Math.min(
      (view.width - margin) / source.width,
      (view.height - margin) / source.height,
      8,
    );
    this.scale = Math.max(this.scale, 0.02);
    this.offsetX = (view.width - source.width * this.scale) / 2;
    this.offsetY = (view.height - source.height * this.scale) / 2;
    this.redraw();
  }

  zoom100(): void {
    const view = this.viewSize;
    this.scale = 1;
    this.offsetX = (view.width - (this.displaySize()?.width ?? 0)) / 2;
    this.offsetY = (view.height - (this.displaySize()?.height ?? 0)) / 2;
    this.redraw();
  }

  private displaySize(): { width: number; height: number } | null {
    if (this.view === 'atlas') {
      const page = this.result?.atlas.pages[this.page];
      return page ? { width: page.width, height: page.height } : null;
    }
    return this.bitmap ? { width: this.bitmap.width, height: this.bitmap.height } : null;
  }

  // --- displayed rects ---------------------------------------------------------

  private displayedRects(): DisplayedRect[] {
    if (this.result === null) return [];
    if (this.view === 'atlas') {
      const page = this.result.atlas.pages[this.page];
      if (page === undefined) return [];
      return page.placements.map((placement, index) => ({
        rect: placement.rect,
        selection: { type: 'sprite' as const, index },
        isManual: false,
      }));
    }
    return this.result.sprites.map((sprite, index) => ({
      rect: sprite.sourceRect,
      selection: { type: 'sprite' as const, index },
      isManual: false,
    }));
  }

  // --- drawing -----------------------------------------------------------------

  redraw(): void {
    if (this.app === null) return;
    this.world.scale.set(this.scale);
    this.world.position.set(this.offsetX, this.offsetY);

    if (this.view === 'atlas' && this.result !== null) {
      const page = this.result.atlas.pages[this.page];
      if (page !== undefined && this.imageSprite === null) {
        // atlas view without a source bitmap: page pixels arrive via setSource(null)
      }
    }

    this.overlay.clear();
    for (const displayed of this.displayedRects()) {
      const selected =
        this.selection !== null &&
        this.selection.type === displayed.selection.type &&
        this.selection.index === displayed.selection.index;
      this.overlay
        .rect(displayed.rect.x, displayed.rect.y, displayed.rect.width, displayed.rect.height)
        .stroke({ width: (selected ? 2 : 1) / this.scale, color: selected ? 0xffd54a : 0x41c7ff });
      if (selected && displayed.selection.type === 'sprite') {
        this.drawPivotMarker(displayed);
      }
    }

    // manual rects sit on top (source view only; they are source-space rects)
    if (this.view === 'source') {
      this.manualRects.forEach((rect, index) => {
        const selected = this.selection?.type === 'manual' && this.selection.index === index;
        this.overlay.rect(rect.x, rect.y, rect.width, rect.height).stroke({
          width: (selected ? 2 : 1.5) / this.scale,
          color: selected ? 0xffd54a : 0xff8a3d,
        });
        if (selected) this.drawHandle(rect);
      });
      if (this.draftRect !== null) {
        this.overlay
          .rect(this.draftRect.x, this.draftRect.y, this.draftRect.width, this.draftRect.height)
          .stroke({ width: 1.5 / this.scale, color: 0xff8a3d });
      }
    }
  }

  private drawPivotMarker(displayed: DisplayedRect): void {
    const sprite = this.result?.sprites[displayed.selection.index];
    if (sprite === undefined) return;
    const cx = sprite.sourceRect.x + sprite.pivot.x * sprite.trimmedRect.width;
    const cy = sprite.sourceRect.y + sprite.pivot.y * sprite.trimmedRect.height;
    const r = 6 / this.scale;
    this.overlay
      .moveTo(cx - r, cy)
      .lineTo(cx + r, cy)
      .moveTo(cx, cy - r)
      .lineTo(cx, cy + r)
      .stroke({ width: 1.5 / this.scale, color: 0xff4a6b });
  }

  private drawHandle(rect: Rect): void {
    const hs = HANDLE_SIZE / 2 / this.scale;
    this.overlay
      .rect(rect.x + rect.width - hs, rect.y + rect.height - hs, hs * 2, hs * 2)
      .fill({ color: 0xff8a3d, alpha: 0.9 });
  }

  // --- interaction ---------------------------------------------------------------

  private localPoint(event: PointerEvent): { x: number; y: number } {
    const bounds = this.app!.canvas.getBoundingClientRect();
    return { x: event.clientX - bounds.left, y: event.clientY - bounds.top };
  }

  private onWheel = (event: Event): void => {
    const wheel = event as WheelEvent;
    wheel.preventDefault();
    const before = this.screenToWorld(wheel.offsetX, wheel.offsetY);
    this.scale = Math.min(40, Math.max(0.02, this.scale * Math.exp(-wheel.deltaY * 0.0015)));
    this.offsetX = wheel.offsetX - before.x * this.scale;
    this.offsetY = wheel.offsetY - before.y * this.scale;
    this.redraw();
  };

  private hitTestManual(world: { x: number; y: number }): number | null {
    for (let i = this.manualRects.length - 1; i >= 0; i--) {
      const r = this.manualRects[i];
      if (world.x >= r.x && world.x <= r.x + r.width && world.y >= r.y && world.y <= r.y + r.height)
        return i;
    }
    return null;
  }

  private onPointerDown = (event: Event): void => {
    const pointer = event as PointerEvent;
    if (pointer.button !== 0 && pointer.button !== 1) return;
    (event.target as HTMLElement).setPointerCapture(pointer.pointerId);
    const screen = this.localPoint(pointer);
    const world = this.screenToWorld(screen.x, screen.y);

    if (
      pointer.button === 1 ||
      this.tool === 'pan' ||
      (this.tool === 'select' && pointer.shiftKey)
    ) {
      this.drag = {
        mode: 'pan',
        startWorld: world,
        startOffset: { x: this.offsetX, y: this.offsetY },
        startScreen: screen,
      };
      return;
    }

    if (this.tool === 'rect') {
      this.drag = {
        mode: 'draft',
        startWorld: world,
        startOffset: { x: this.offsetX, y: this.offsetY },
        startScreen: screen,
      };
      this.draftRect = { x: Math.floor(world.x), y: Math.floor(world.y), width: 1, height: 1 };
      this.redraw();
      return;
    }

    // select tool
    const manualIndex = this.hitTestManual(world);
    if (manualIndex !== null) {
      const rect = this.manualRects[manualIndex];
      const hs = HANDLE_SIZE / this.scale;
      const onHandle = world.x >= rect.x + rect.width - hs && world.y >= rect.y + rect.height - hs;
      this.selection = { type: 'manual', index: manualIndex };
      this.callbacks.onSelectionChanged(this.selection);
      this.drag = {
        mode: onHandle ? 'resize' : 'move',
        startWorld: world,
        startOffset: { x: this.offsetX, y: this.offsetY },
        originRect: rect,
        moveIndex: manualIndex,
        startScreen: screen,
      };
      this.redraw();
      return;
    }

    const displayed = this.displayedRects();
    for (let i = displayed.length - 1; i >= 0; i--) {
      const d = displayed[i];
      const r = d.rect;
      if (
        world.x >= r.x &&
        world.x <= r.x + r.width &&
        world.y >= r.y &&
        world.y <= r.y + r.height
      ) {
        this.selection = d.selection;
        this.callbacks.onSelectionChanged(this.selection);
        this.redraw();
        return;
      }
    }
    this.selection = null;
    this.callbacks.onSelectionChanged(null);
    this.redraw();
  };

  private onPointerMove = (event: Event): void => {
    if (this.drag === null) return;
    const pointer = event as PointerEvent;
    const screen = this.localPoint(pointer);

    if (this.drag.mode === 'pan') {
      this.offsetX = this.drag.startOffset.x + (screen.x - this.drag.startScreen.x);
      this.offsetY = this.drag.startOffset.y + (screen.y - this.drag.startScreen.y);
      this.redraw();
      return;
    }

    const world = this.screenToWorld(screen.x, screen.y);
    if (this.drag.mode === 'draft') {
      this.draftRect = normalizeRect(this.drag.startWorld, world);
      this.redraw();
      return;
    }

    const index = this.drag.moveIndex;
    const origin = this.drag.originRect;
    if (index === undefined || origin === undefined) return;
    if (this.drag.mode === 'move') {
      const dx = Math.round(world.x - this.drag.startWorld.x);
      const dy = Math.round(world.y - this.drag.startWorld.y);
      this.callbacks.onRectChanged(index, { ...origin, x: origin.x + dx, y: origin.y + dy });
    } else {
      const width = Math.max(1, Math.round(world.x - origin.x));
      const height = Math.max(1, Math.round(world.y - origin.y));
      this.callbacks.onRectChanged(index, { x: origin.x, y: origin.y, width, height });
    }
  };

  private onPointerUp = (): void => {
    if (this.drag !== null && this.drag.mode === 'draft' && this.draftRect !== null) {
      this.callbacks.onRectCommitted(this.draftRect);
    }
    this.drag = null;
    this.draftRect = null;
    this.redraw();
  };
}

function normalizeRect(a: { x: number; y: number }, b: { x: number; y: number }): Rect {
  const x = Math.floor(Math.min(a.x, b.x));
  const y = Math.floor(Math.min(a.y, b.y));
  const width = Math.max(1, Math.floor(Math.abs(a.x - b.x)));
  const height = Math.max(1, Math.floor(Math.abs(a.y - b.y)));
  return { x, y, width, height };
}
