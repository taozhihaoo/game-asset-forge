import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  DEFAULT_PIPELINE,
  ForgeError,
  parsePreset,
  runPipeline,
  serializePreset,
  type Pipeline,
} from '@gameasset-forge/core';
import { discoverPngFiles } from '../discover.js';
import { assertPngFile, readPngFile, readPngInfo } from '../png.js';
import { writePipelineOutputs, writeSummary } from '../output.js';
import { buildSpriteFramesTres } from '../exporters/godot.js';
import { buildUnityImporterScript } from '../exporters/unity.js';

/**
 * Command implementations. Each returns a human-readable report string (or a
 * structured result) and may throw typed errors; main.ts maps errors to exit
 * codes 0/1/2. Progress lines go through an injectable `log` so tests stay
 * quiet.
 */

export type Log = (line: string) => void;

const defaultLog: Log = (line) => process.stdout.write(`${line}\n`);

// ---------------------------------------------------------------------------
// init
// ---------------------------------------------------------------------------

/** Writes the default preset. Refuses to overwrite unless `force`. */
export function runInit(outputFile: string, force: boolean, log: Log = defaultLog): string {
  if (!force && existsSync(outputFile)) {
    throw new ForgeError({
      stage: 'input',
      code: 'INPUT_NOT_FOUND',
      message: `${outputFile} already exists — use --force to overwrite`,
    });
  }
  const dir = join(outputFile, '..');
  mkdirSync(dir, { recursive: true });
  writeFileSync(outputFile, serializePreset(DEFAULT_PIPELINE), 'utf8');
  log(`wrote preset to ${outputFile}`);
  return outputFile;
}

// ---------------------------------------------------------------------------
// validate
// ---------------------------------------------------------------------------

export function runValidate(presetFile: string, log: Log = defaultLog): string {
  const pipeline = loadPipeline(presetFile);
  const message = `preset valid (schemaVersion ${pipeline.schemaVersion})`;
  log(message);
  return message;
}

// ---------------------------------------------------------------------------
// inspect
// ---------------------------------------------------------------------------

export interface InspectOptions {
  readonly input: string;
  readonly presetFile?: string;
}

const MAX_LISTED_RECTS = 50;

export function runInspect(options: InspectOptions, log: Log = defaultLog): string {
  if (!existsSync(options.input)) throw inputNotFound(options.input);
  const pipeline = loadPipeline(options.presetFile);
  const info = readPngInfo(readFileSync(options.input), options.input);

  const lines: string[] = [
    `source:     ${options.input}`,
    `format:     PNG (colorType ${info.colorType}, bitDepth ${info.bitDepth})`,
    `dimensions: ${info.width}x${info.height}`,
    `alpha:      ${info.hasAlpha ? 'yes' : 'no'}`,
    `detect:     ${describeDetect(pipeline)}`,
  ];

  if (!info.hasAlpha && pipeline.detect.mode === 'alpha-connected-components') {
    lines.push(
      'warning:    no alpha channel — alpha-connected-components cannot run; use grid or manual detection',
    );
    log(lines.join('\n'));
    return lines.join('\n');
  }

  const image = readPngFile(options.input, options.input);
  const result = runPipeline(image, pipeline, { sourcePath: options.input });
  lines.push(`sprites:    ${result.sprites.length} detected, ${result.skipped.length} skipped`);
  const listed = result.sprites.slice(0, MAX_LISTED_RECTS);
  for (const sprite of listed) {
    lines.push(
      `  ${sprite.id} rect=(${sprite.sourceRect.x},${sprite.sourceRect.y} ` +
        `${sprite.sourceRect.width}x${sprite.sourceRect.height}) ` +
        `content=${sprite.trimmedRect.width}x${sprite.trimmedRect.height}`,
    );
  }
  if (result.sprites.length > listed.length) {
    lines.push(`  ... ${result.sprites.length - listed.length} more`);
  }
  lines.push(`estimated:  ${describeEstimate(result)}`);

  const report = lines.join('\n');
  log(report);
  return report;
}

function describeEstimate(result: ReturnType<typeof runPipeline>): string {
  if (result.atlas.pages.length === 0) return '0 pages (nothing to pack)';
  const pages = result.atlas.pages
    .map((page) => `atlas-${page.index}.png ${page.width}x${page.height}`)
    .join(', ');
  return `${result.atlas.pages.length} page(s) [${pages}]`;
}

// ---------------------------------------------------------------------------
// process
// ---------------------------------------------------------------------------

export interface ProcessTarget {
  readonly absolutePath: string;
  readonly relativePath: string;
}

export interface ProcessOutcome {
  readonly source: string;
  readonly spriteCount: number;
  readonly skippedCount: number;
  readonly pageCount: number;
  readonly outputFiles: readonly string[];
}

export function runProcess(
  target: ProcessTarget,
  pipeline: Pipeline,
  outputDir: string,
  log: Log = defaultLog,
): ProcessOutcome {
  assertPngFile(target.relativePath);
  if (!existsSync(target.absolutePath)) throw inputNotFound(target.absolutePath);
  const image = readPngFile(target.absolutePath, target.relativePath);
  const result = runPipeline(image, pipeline, { sourcePath: target.relativePath });
  const written = writePipelineOutputs(result, outputDir);
  const outputFiles: string[] = written.map((w) => w.file);

  // Engine exporters consume the manifest in the CLI layer; core stays blind.
  const baseName =
    target.relativePath
      .replace(/\.png$/i, '')
      .split('/')
      .pop() ?? 'sprites';
  if (pipeline.output.godot.enabled) {
    const tresFile = join(outputDir, `${baseName}_spriteframes.tres`);
    writeFileSync(tresFile, buildSpriteFramesTres(result.manifest), 'utf8');
    outputFiles.push(tresFile);
  }
  if (pipeline.output.unity.enabled) {
    const importerFile = join(outputDir, 'GameAssetForgeImporter.cs');
    writeFileSync(importerFile, buildUnityImporterScript(), 'utf8');
    outputFiles.push(importerFile);
  }

  const outcome: ProcessOutcome = {
    source: target.relativePath,
    spriteCount: result.sprites.length,
    skippedCount: result.skipped.length,
    pageCount: result.pages.length,
    outputFiles,
  };
  log(`ok   ${target.relativePath} (${outcome.spriteCount} sprites, ${outcome.pageCount} page(s))`);
  return outcome;
}

// ---------------------------------------------------------------------------
// batch
// ---------------------------------------------------------------------------

export interface BatchOptions {
  readonly root: string;
  readonly pipeline: Pipeline;
  readonly outputDir: string;
  readonly log?: Log;
}

export interface BatchResult {
  readonly summary: {
    total: number;
    succeeded: number;
    failed: number;
    durationMs: number;
    outputs: string[];
    errors: { source: string; stage: string; error: string }[];
  };
  readonly outcomes: readonly ProcessOutcome[];
}

export function runBatch(options: BatchOptions): BatchResult {
  const log = options.log ?? defaultLog;
  const startedAt = Date.now();
  const files = discoverPngFiles({
    root: options.root,
    recursive: options.pipeline.input.recursive,
    include: options.pipeline.input.include,
    exclude: options.pipeline.input.exclude,
  });
  mkdirSync(options.outputDir, { recursive: true });

  const outcomes: ProcessOutcome[] = [];
  const errors: BatchResult['summary']['errors'] = [];
  const outputs: string[] = [];

  for (const file of files) {
    // One output subdirectory per source (mirrors the relative path) so
    // same-named sheets from different folders never collide.
    const base = file.relativePath.replace(/\.png$/i, '');
    try {
      const outcome = runProcess(file, options.pipeline, join(options.outputDir, base), log);
      outcomes.push(outcome);
      outputs.push(...outcome.outputFiles);
    } catch (error) {
      const stage = error instanceof ForgeError ? error.stage : 'input';
      errors.push({ source: file.relativePath, stage, error: errorMessage(error) });
      log(`fail ${file.relativePath} (${errorMessage(error)})`);
    }
  }

  const summaryFile = join(options.outputDir, 'summary.json');
  const summary: BatchResult['summary'] = {
    total: files.length,
    succeeded: outcomes.length,
    failed: errors.length,
    durationMs: Date.now() - startedAt,
    outputs: [...outputs, summaryFile],
    errors,
  };
  writeSummary(summary, summaryFile);

  log(`batch done: ${summary.succeeded}/${summary.total} succeeded, ${summary.failed} failed`);
  log(`summary: ${summaryFile}`);
  return { summary, outcomes };
}

// ---------------------------------------------------------------------------
// shared helpers
// ---------------------------------------------------------------------------

/** Loads the preset file (or the built-in default when undefined). */
export function loadPipeline(presetFile: string | undefined): Pipeline {
  if (presetFile === undefined) return parsePreset({ schemaVersion: 1 });
  return parsePreset(readJsonFile(presetFile));
}

function readJsonFile(presetFile: string): unknown {
  try {
    return JSON.parse(readFileSync(presetFile, 'utf8'));
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause);
    throw new ForgeError({
      stage: 'preset',
      code: 'PRESET_MALFORMED',
      message: `cannot read preset ${presetFile}: ${message}`,
      cause,
    });
  }
}

export function describeDetect(pipeline: Pipeline): string {
  const detect = pipeline.detect;
  if (detect.mode === 'alpha-connected-components') {
    return `alpha-connected-components (threshold ${detect.alphaThreshold}, minPixels ${detect.minPixels}, connectivity ${detect.connectivity})`;
  }
  if (detect.mode === 'grid') {
    const form =
      detect.rows !== undefined && detect.columns !== undefined
        ? `rows ${detect.rows} x columns ${detect.columns}`
        : `cells ${detect.cellWidth}x${detect.cellHeight}`;
    return `grid (${form})`;
  }
  return `manual (${detect.rects.length} rect(s))`;
}

export function inputNotFound(path: string): ForgeError {
  return new ForgeError({
    stage: 'input',
    code: 'INPUT_NOT_FOUND',
    message: `input not found: ${path}`,
  });
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
