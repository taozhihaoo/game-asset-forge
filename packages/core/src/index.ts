/**
 * GameAsset Forge — Core public API.
 *
 * Phase 1: domain types, typed errors, rect validation, Preset/Pipeline contract.
 * Phase 2: image operations — detect / trim / resize / bleed / padding / pivot,
 * plus the `buildSprites` assembly. All pure, fs-free, UI-free.
 * Phase 3: atlas packing (MaxRects BSSF), page compositing, manifest, and the
 * `runPipeline` entry point.
 *
 * Charter section 17 name mapping: trimSprite → `trimRaster` + `composeCellRaster`,
 * resizeSprite → `resizeRaster`; assembly lives in `buildSprites`.
 */

export * from './types.js';
export * from './errors.js';
export * from './rect.js';
export * from './preset.js';
export * from './image.js';
export * from './detect.js';
export * from './trim.js';
export * from './resize.js';
export * from './bleed.js';
export * from './pivot.js';
export * from './sprites.js';
export * from './atlas.js';
export * from './manifest.js';
export * from './pipeline.js';
export * from './quality/index.js';
export * from './version.js';
