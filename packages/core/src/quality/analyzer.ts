import type { AssetFile, AssetReport, QualityIssue, QualityReport } from './models.js';
import { QUALITY_RULES, DEFAULT_QUALITY_CONFIG, type QualityConfig } from './models.js';
import { namingIssues } from './naming.js';
import { transparencyIssues } from './transparency.js';
import { sizeIssuesByAsset } from './size.js';
import { duplicateIssues } from './duplicate.js';
import { pivotIssues } from './pivot.js';

/**
 * Asset Quality Analyzer (V2 core entry point).
 *
 * Detection first, suggestion second, modification optional: `analyze()`
 * only ever reports — it never mutates inputs or writes files.
 *
 * Determinism: assets are reported sorted by name; within an asset,
 * warnings follow the fixed QUALITY_RULES order.
 */

export function analyze(
  assets: readonly AssetFile[],
  config: QualityConfig = DEFAULT_QUALITY_CONFIG,
): QualityReport {
  const sorted = [...assets].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));

  const sizeWarnings = sizeIssuesByAsset(sorted);
  const duplicateWarnings = new Map<string, QualityIssue>();
  for (const warning of duplicateIssues(sorted, config)) {
    duplicateWarnings.set(warning.asset, warning);
  }

  const issues: AssetReport[] = [];
  let warningCount = 0;
  for (const asset of sorted) {
    const byRule: readonly QualityIssue[][] = [
      namingIssues(asset, config),
      transparencyIssues(asset, config),
      take(sizeWarnings.get(asset.name)),
      take(duplicateWarnings.get(asset.name)),
      pivotIssues(asset, config),
    ];
    const warnings: QualityIssue[] = [];
    byRule.forEach((ruleIssues, ruleIndex) => {
      for (const issue of ruleIssues) {
        warnings.push({ ...issue, rule: QUALITY_RULES[ruleIndex] });
      }
    });
    warningCount += warnings.length;
    issues.push({ asset: asset.name, warnings });
  }

  return { version: 2, assets: sorted.length, warnings: warningCount, issues };
}

function take(issue: QualityIssue | undefined): QualityIssue[] {
  return issue === undefined ? [] : [issue];
}

export type { AssetFile, QualityConfig, QualityIssue, QualityReport };
