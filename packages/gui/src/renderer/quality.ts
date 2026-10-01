import { analyze, type AssetFile, type QualityReport } from '@gameasset-forge/core';

/**
 * Quality 页（V2 Feature: Asset Quality Assistant 的 GUI 面）。
 * 只渲染 core `analyze()` 的报告——建议列表 + 人工确认，无自动修改。
 */

export interface QualitySourceInput {
  readonly name: string;
  readonly raster: Parameters<typeof analyze>[0][number]['raster'];
  readonly byteSize: number;
}

export function buildQualityAssets(sources: readonly QualitySourceInput[]): AssetFile[] {
  return sources.map((source) => ({
    name: source.name,
    raster: source.raster,
    byteSize: source.byteSize,
  }));
}

/** Report shape as written to quality_report.json / consumed by the HTML renderer. */
export interface QualityReportJson {
  readonly version: number;
  readonly summary: {
    readonly assets: number;
    readonly warnings: number;
    readonly high: number;
    readonly medium: number;
    readonly low: number;
    readonly info: number;
  };
  readonly issues: QualityReport['issues'];
}

export function toReportJson(report: QualityReport): QualityReportJson {
  const bySeverity = { high: 0, medium: 0, low: 0, info: 0 };
  for (const entry of report.issues) {
    for (const warning of entry.warnings) bySeverity[warning.severity] += 1;
  }
  return {
    version: report.version,
    summary: {
      assets: report.assets,
      warnings: report.warnings,
      ...bySeverity,
    },
    issues: report.issues,
  };
}

export function renderQualityList(host: HTMLElement, report: QualityReport | null): void {
  host.replaceChildren();
  if (report === null) {
    const empty = document.createElement('p');
    empty.className = 'hint';
    empty.textContent = 'Run Analyze to inspect the loaded assets.';
    host.append(empty);
    return;
  }

  const summary = document.createElement('p');
  summary.className = 'quality-summary';
  summary.textContent = `${report.assets} asset(s) · ${report.warnings} warning(s)`;
  host.append(summary);

  for (const entry of report.issues) {
    const item = document.createElement('li');
    item.className = 'quality-asset';
    const title = document.createElement('div');
    title.className = 'asset-name';
    title.textContent = entry.asset;
    item.append(title);
    const list = document.createElement('ul');
    if (entry.warnings.length === 0) {
      const ok = document.createElement('li');
      ok.className = 'quality-ok';
      ok.textContent = '✓ Good';
      list.append(ok);
    }
    for (const warning of entry.warnings) {
      const line = document.createElement('li');
      line.className = `quality-warning severity-${warning.severity}`;
      const badge = document.createElement('span');
      badge.className = 'badge';
      badge.textContent = warning.severity;
      const text = document.createElement('span');
      text.textContent = `${warning.message} — ${warning.suggestion}`;
      line.append(badge, text);
      list.append(line);
    }
    item.append(list);
    host.append(item);
  }
}
