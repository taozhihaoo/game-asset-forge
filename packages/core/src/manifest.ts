import { AtlasPackingError } from './errors.js';
import { CORE_VERSION } from './version.js';
import type { Atlas, AtlasPlacement, ExportManifest, Sprite } from './types.js';

/**
 * Builds the deterministic ExportManifest (charter §13, amendment A3).
 * Fixed key order, no timestamps; page files are named `atlas-N.png`.
 */
export function buildManifest(
  atlas: Atlas,
  sprites: readonly Sprite[],
  source: string,
): ExportManifest {
  const placementBySprite = new Map<string, { placement: AtlasPlacement; page: number }>();
  for (const page of atlas.pages) {
    for (const placement of page.placements) {
      placementBySprite.set(placement.spriteId, { placement, page: page.index });
    }
  }

  const manifestSprites = sprites.map((sprite) => {
    const entry = placementBySprite.get(sprite.id);
    if (entry === undefined) {
      throw new AtlasPackingError(`sprite ${sprite.id} has no atlas placement`);
    }
    return {
      id: sprite.id,
      page: entry.page,
      rect: entry.placement.rect,
      sourceRect: sprite.sourceRect,
      trimmedRect: sprite.trimmedRect,
      pivot: sprite.pivot,
    };
  });

  return {
    schemaVersion: 1,
    generator: { name: 'gameasset-forge', version: CORE_VERSION },
    source,
    pages: atlas.pages.map((page) => ({
      file: `atlas-${page.index}.png`,
      width: page.width,
      height: page.height,
    })),
    sprites: manifestSprites,
  };
}
