import {
  createMask,
  detectSprites,
  extractLayer,
  type Mask,
  type Pipeline,
  type RasterImage,
} from '@gameasset-forge/core';

/**
 * Editor Mode helpers (V4 Feature 11, prototype). Pure functions — the
 * caller owns and re-renders all state (§27). Limited deformation ±8°
 * preview only (D3); not an animation editor.
 */

export interface EditorLayer {
  readonly id: string;
  readonly name: string;
  readonly z: number;
  /** Source-space mask (255 = this layer's pixels). */
  readonly mask: Mask;
  readonly visible: boolean;
  readonly dilation: number;
}

/** Mock segmentation: one editor layer proposal per alpha-CC detection. */
export function proposeEditorLayers(
  image: RasterImage,
  pipeline: Pipeline,
  dilation: number,
): EditorLayer[] {
  const detected = detectSprites(image, pipeline.detect);
  return detected.map((sprite, index) => {
    const name = `layer_${String(index + 1).padStart(2, '0')}`;
    const mask = createMask(image.width, image.height);
    const rect = sprite.rect;
    for (let y = rect.y; y < rect.y + rect.height; y++) {
      for (let x = rect.x; x < rect.x + rect.width; x++) {
        mask.data[y * image.width + x] = 255;
      }
    }
    return { id: name, name, z: index, mask, visible: true, dilation };
  });
}

export function createEditorLayer(
  id: string,
  z: number,
  width: number,
  height: number,
  rect: { x: number; y: number; width: number; height: number },
  dilation: number,
): EditorLayer {
  const mask = createMask(width, height);
  for (let y = rect.y; y < rect.y + rect.height; y++) {
    for (let x = rect.x; x < rect.x + rect.width; x++) {
      if (x >= 0 && x < width && y >= 0 && y < height) mask.data[y * width + x] = 255;
    }
  }
  return { id, name: id, z, mask, visible: true, dilation };
}

/** Circular brush stamp (brush + / brush −). */
export function stampBrush(mask: Mask, x: number, y: number, radius: number, value: 0 | 255): void {
  for (let dy = -radius; dy <= radius; dy++) {
    for (let dx = -radius; dx <= radius; dx++) {
      if (dx * dx + dy * dy > radius * radius) continue;
      const nx = x + dx;
      const ny = y + dy;
      if (nx >= 0 && nx < mask.width && ny >= 0 && ny < mask.height) {
        mask.data[ny * mask.width + nx] = value;
      }
    }
  }
}

/** Extracts the visible raster for a layer (L1 dilation + L2 diffusion). */
export function extractEditorLayerRaster(image: RasterImage, layer: EditorLayer): RasterImage {
  return extractLayer(
    image,
    { id: layer.id, mask: layer.mask },
    {
      dilation: layer.dilation,
    },
  ).raster;
}

export type { Mask, Pipeline, RasterImage };
