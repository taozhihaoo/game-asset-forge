import { createMask, type Mask } from './types.js';

/**
 * Mask operations — deterministic pixel loops only.
 */

/** Expands set pixels outward by `radius` (Chebyshev, 8-neighborhood). */
export function dilateMask(mask: Mask, radius: number): Mask {
  const out = createMask(mask.width, mask.height);
  for (let y = 0; y < mask.height; y++) {
    for (let x = 0; x < mask.width; x++) {
      let set = 0;
      for (let dy = -radius; dy <= radius && set === 0; dy++) {
        const ny = y + dy;
        if (ny < 0 || ny >= mask.height) continue;
        for (let dx = -radius; dx <= radius; dx++) {
          const nx = x + dx;
          if (nx < 0 || nx >= mask.width) continue;
          if (mask.data[ny * mask.width + nx] !== 0) {
            set = 255;
            break;
          }
        }
      }
      out.data[y * mask.width + x] = set;
    }
  }
  return out;
}

/** Shrinks set pixels inward by `radius`. Radius 0 returns the input. */
export function erodeMask(mask: Mask, radius: number): Mask {
  let current = mask;
  for (let i = 0; i < radius; i++) {
    current = invertMask(dilateMask(invertMask(current), 1));
  }
  return current;
}

export function invertMask(mask: Mask): Mask {
  const out = createMask(mask.width, mask.height);
  for (let i = 0; i < out.data.length; i++) out.data[i] = mask.data[i] === 0 ? 255 : 0;
  return out;
}

/** out = base where base set; union semantics for set pixels. */
export function overlayMask(base: Mask, top: Mask): Mask {
  const out = createMask(base.width, base.height);
  for (let i = 0; i < out.data.length; i++) {
    out.data[i] = base.data[i] !== 0 || top.data[i] !== 0 ? 255 : 0;
  }
  return out;
}

/** Pixels covered by ANY of the masks (occupancy for the reconstruction invariant). */
export function unionMasks(width: number, height: number, masks: readonly Mask[]): Mask {
  const out = createMask(width, height);
  for (const mask of masks) {
    if (mask.width !== width || mask.height !== height) {
      throw new Error(`mask size ${mask.width}x${mask.height} != ${width}x${height}`);
    }
    for (let i = 0; i < out.data.length; i++) {
      if (mask.data[i] !== 0) out.data[i] = 255;
    }
  }
  return out;
}
