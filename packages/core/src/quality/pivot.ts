import type { AssetFile, QualityConfig, QualityIssue } from './models.js';

/**
 * Rule: pivot_check (amendment B6 — detection only, never auto-modify).
 *
 * - `characterPatterns` configured + name matches:
 *     pivot present  → medium warning when it deviates from bottom-center;
 *     pivot missing  → info that the character pivot is unknown.
 * - no patterns (default): any known pivot deviating from bottom-center
 *   yields an info-level note; missing pivots are ignored.
 *
 * All coordinates are normalized [0,1] against the trimmed (content) rect.
 */

const FEET_PIVOT = { x: 0.5, y: 1.0 };
const DEVIATION_EPSILON = 0.05;

function deviationFromFeet(pivot: { x: number; y: number }): number {
  return Math.hypot(pivot.x - FEET_PIVOT.x, pivot.y - FEET_PIVOT.y);
}

function matchesCharacter(name: string, config: QualityConfig): boolean {
  const dot = name.lastIndexOf('.');
  const stem = (dot > 0 ? name.slice(0, dot) : name).toLowerCase();
  return config.characterPatterns.some((pattern) => {
    try {
      return new RegExp(pattern, 'i').test(stem);
    } catch {
      return false; // invalid user pattern: skip instead of crashing analysis
    }
  });
}

export function pivotIssues(asset: AssetFile, config: QualityConfig): QualityIssue[] {
  const isCharacter = matchesCharacter(asset.name, config);
  if (!isCharacter) {
    if (asset.pivot !== undefined && deviationFromFeet(asset.pivot) > DEVIATION_EPSILON) {
      return [
        {
          rule: 'pivot_check',
          severity: 'info',
          message: `Pivot (${asset.pivot.x}, ${asset.pivot.y}) deviates from bottom-center (0.5, 1.0)`,
          suggestion: 'Set the normalized pivot to (0.5, 1.0) if this sprite anchors at its feet',
        },
      ];
    }
    return [];
  }

  if (asset.pivot === undefined) {
    return [
      {
        rule: 'pivot_check',
        severity: 'info',
        message: `Character sprite '${asset.name}' has no pivot metadata`,
        suggestion: 'Set the normalized pivot to (0.5, 1.0) so the sprite anchors at its feet',
      },
    ];
  }
  if (deviationFromFeet(asset.pivot) > DEVIATION_EPSILON) {
    return [
      {
        rule: 'pivot_check',
        severity: 'medium',
        message: 'Character sprite pivot is not near feet',
        suggestion: 'Set the normalized pivot to (0.5, 1.0)',
      },
    ];
  }
  return [];
}
