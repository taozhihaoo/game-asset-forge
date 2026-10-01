import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { PipelineResult } from '@gameasset-forge/core';
import { encodePng } from './png.js';

/**
 * Output writing: atlas-N.png pages + atlas.json manifest into a directory.
 * Filenames are fixed and sanitized by construction (charter §14).
 */

export interface WrittenOutput {
  readonly file: string;
  readonly bytes: number;
}

export function writePipelineOutputs(result: PipelineResult, outputDir: string): WrittenOutput[] {
  mkdirSync(outputDir, { recursive: true });
  const written: WrittenOutput[] = [];

  result.pages.forEach((page, index) => {
    const file = join(outputDir, `atlas-${index}.png`);
    const bytes = encodePng(page);
    writeFileSync(file, bytes);
    written.push({ file, bytes: bytes.length });
  });

  const manifestFile = join(outputDir, 'atlas.json');
  const manifestBytes = Buffer.from(`${JSON.stringify(result.manifest, null, 2)}\n`, 'utf8');
  writeFileSync(manifestFile, manifestBytes);
  written.push({ file: manifestFile, bytes: manifestBytes.length });

  return written;
}

export interface BatchSummary {
  readonly total: number;
  readonly succeeded: number;
  readonly failed: number;
  readonly durationMs: number;
  readonly outputs: readonly string[];
  readonly errors: readonly { source: string; stage: string; error: string }[];
}

export function writeSummary(summary: BatchSummary, outputFile: string): void {
  const bytes = `${JSON.stringify(summary, null, 2)}\n`;
  writeFileSync(outputFile, bytes, 'utf8');
}
