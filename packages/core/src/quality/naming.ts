import type { AssetFile, QualityConfig, QualityIssue } from './models.js';

/**
 * Rule: naming_convention + asset-name grouping (B4: grouping runs first —
 * the size-consistency rule depends on these groups).
 *
 * A trailing number is a frame index: `hero_idle_01` → group `hero_idle`.
 * Names without a trailing number form singleton groups.
 */

export interface NameParts {
  /** File name without extension. */
  readonly stem: string;
  /** Animation/series group (stem minus the trailing frame index). */
  readonly group: string;
  /** Trailing frame index, or null when absent. */
  readonly index: number | null;
}

export function parseAssetName(name: string): NameParts {
  const dot = name.lastIndexOf('.');
  const stem = dot > 0 ? name.slice(0, dot) : name;
  const match = /^(.*?)[_\-\s]?(\d+)$/.exec(stem);
  if (match !== null && match[1] !== '') {
    return {
      stem,
      group: match[1].replace(/[_\-\s]+$/, ''),
      index: Number.parseInt(match[2], 10),
    };
  }
  return { stem, group: stem, index: null };
}

export function namingIssues(asset: AssetFile, config: QualityConfig): QualityIssue[] {
  const dot = asset.name.lastIndexOf('.');
  const stem = (dot > 0 ? asset.name.slice(0, dot) : asset.name).toLowerCase();
  const patterns = config.nonDescriptivePatterns.length > 0 ? config.nonDescriptivePatterns : [];
  const issues: QualityIssue[] = [];
  for (const pattern of patterns) {
    let regex: RegExp;
    try {
      regex = new RegExp(pattern, 'i');
    } catch {
      continue; // invalid user pattern: skip instead of crashing analysis
    }
    if (regex.test(stem)) {
      issues.push({
        rule: 'naming_convention',
        severity: 'low',
        message: `Non-descriptive filename: ${asset.name}`,
        suggestion: `Rename to describe the content, e.g. '<asset>_<state>_<index>.png' (matched pattern: ${pattern})`,
      });
      break; // one naming warning per asset, first matching pattern wins
    }
  }
  return issues;
}
