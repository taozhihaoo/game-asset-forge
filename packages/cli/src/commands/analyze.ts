import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { analyze, ForgeError, type AssetFile, type Pipeline } from '@gameasset-forge/core';
import { discoverPngFiles } from '../discover.js';
import { assertPngFile, decodePng } from '../png.js';
import { renderQualityReportHtml } from '../reporting/html.js';

/**
 * `gameassetforge analyze` (V2): asset quality analysis over a folder.
 * Detection first, suggestion second, modification optional — the command
 * only writes reports (JSON + HTML); it never touches the source files.
 */

export type AnalyzeLog = (line: string) => void;

export interface AnalyzeOptions {
  readonly root: string;
  readonly pipeline: Pipeline;
  readonly outputDir: string;
  readonly log?: AnalyzeLog;
}

export interface AnalyzeResult {
  readonly summary: {
    total: number;
    analyzed: number;
    failed: number;
    warnings: number;
    high: number;
    medium: number;
    low: number;
    info: number;
    durationMs: number;
    outputFiles: string[];
    errors: { source: string; error: string }[];
  };
  readonly report: unknown;
}

export function runAnalyze(options: AnalyzeOptions): AnalyzeResult {
  const log = options.log ?? ((line: string) => process.stdout.write(`${line}\n`));
  const startedAt = Date.now();
  if (!existsSync(options.root)) {
    throw new ForgeError({
      stage: 'input',
      code: 'INPUT_NOT_FOUND',
      message: `input not found: ${options.root}`,
    });
  }

  const files = discoverPngFiles({
    root: options.root,
    recursive: options.pipeline.input.recursive,
    include: options.pipeline.input.include,
    exclude: options.pipeline.input.exclude,
  });
  mkdirSync(options.outputDir, { recursive: true });

  const assets: AssetFile[] = [];
  const errors: { source: string; error: string }[] = [];
  for (const file of files) {
    try {
      assertPngFile(file.relativePath);
      const buffer = readFileSync(file.absolutePath);
      const raster = decodePng(buffer, file.relativePath);
      assets.push({ name: file.relativePath, raster, byteSize: buffer.length });
    } catch (error) {
      errors.push({
        source: file.relativePath,
        error: error instanceof Error ? error.message : String(error),
      });
      log(`fail ${file.relativePath}`);
    }
  }

  const report = analyze(assets, options.pipeline.quality);
  const bySeverity = { high: 0, medium: 0, low: 0, info: 0 };
  for (const entry of report.issues) {
    for (const warning of entry.warnings) bySeverity[warning.severity] += 1;
  }

  const reportJson = {
    version: report.version,
    summary: {
      assets: report.assets,
      warnings: report.warnings,
      ...bySeverity,
    },
    issues: report.issues,
    errors,
  };

  const jsonFile = join(options.outputDir, 'quality_report.json');
  mkdirSync(options.outputDir, { recursive: true });
  writeFileSync(jsonFile, `${JSON.stringify(reportJson, null, 2)}\n`, 'utf8');
  const htmlFile = join(options.outputDir, 'quality_report.html');
  writeFileSync(htmlFile, renderQualityReportHtml(reportJson), 'utf8');

  const summary = {
    total: files.length,
    analyzed: assets.length,
    failed: errors.length,
    warnings: report.warnings,
    ...bySeverity,
    durationMs: Date.now() - startedAt,
    outputFiles: [jsonFile, htmlFile],
    errors,
  };

  log(
    `analyze done: ${summary.analyzed}/${summary.total} assets analyzed, ` +
      `${summary.warnings} warnings (${summary.high} high / ${summary.medium} medium / ` +
      `${summary.low} low / ${summary.info} info)`,
  );
  log(`report: ${jsonFile}`);
  log(`report: ${htmlFile}`);
  return { summary, report: reportJson };
}
