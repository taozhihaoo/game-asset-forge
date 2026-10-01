import type { Pivot, Pipeline } from './types.js';

/**
 * Pivot calculation. Result is normalized [0,1] against the CONTENT
 * (trimmed) rect — never the cell raster, never engine conventions
 * (Phase 0 review amendment ④). Exporters convert per engine.
 */
export function calculatePivot(pivot: Pipeline['pivot']): Pivot {
  switch (pivot.mode) {
    case 'center':
      return { x: 0.5, y: 0.5 };
    case 'bottom-center':
      return { x: 0.5, y: 1.0 };
    case 'manual':
      return { x: pivot.x, y: pivot.y };
  }
}
