import { composeAtlasPages, packAtlas } from './atlas.js';
import { buildSprites, type BuildSpritesResult } from './sprites.js';
import { buildManifest } from './manifest.js';
import type { Atlas, ExportManifest, Pipeline, RasterImage } from './types.js';

/**
 * The one-entry-point pure pipeline (charter §17):
 *   detect → trim → resize → bleed → padding → pack → manifest
 *
 * Filesystem stays outside: callers decode PNG → RasterImage, run this,
 * then encode the returned page rasters + manifest to disk.
 */
export interface RunPipelineOptions {
  /** '/'-normalized source path used in sprite IDs and the manifest. */
  readonly sourcePath: string;
}

export interface PipelineResult extends BuildSpritesResult {
  readonly atlas: Atlas;
  /** Composed page pixels, ordered by page index; encode these as atlas-N.png. */
  readonly pages: readonly RasterImage[];
  readonly manifest: ExportManifest;
}

export function runPipeline(
  image: RasterImage,
  pipeline: Pipeline,
  options: RunPipelineOptions,
): PipelineResult {
  const { sprites, skipped } = buildSprites(image, pipeline, options);
  const atlas = packAtlas(sprites, pipeline.atlas);
  const pages = composeAtlasPages(atlas, sprites);
  const manifest = buildManifest(atlas, sprites, options.sourcePath);
  return { sprites, skipped, atlas, pages, manifest };
}
