import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createRasterImage, parsePreset, setPixel } from '@gameasset-forge/core';
import { AiDisabledError, MockVisionProvider } from '@gameasset-forge/ai';
import { encodePng } from '../packages/cli/src/png.js';
import { runAnalyze as runQualityAnalyze } from '../packages/cli/src/commands/analyze.js';
import { runAiAnalyze, type AiAnalyzeOptions } from '../packages/cli/src/commands/ai-analyze.js';

/**
 * V3 CLI tests (all mock — CI never touches a network).
 * Core quality invariants verified here: AI artifacts are sidecars (C3) and
 * never perturb the deterministic pipeline outputs (C6).
 */

const CLI_JS = fileURLToPath(new URL('../packages/cli/dist/main.js', import.meta.url));
const NO_LOG = (): void => {};

const GREEN: [number, number, number, number] = [40, 200, 40, 255];
const BLUE: [number, number, number, number] = [40, 40, 220, 255];

function writeSheet(file: string): void {
  const image = createRasterImage(24, 8, { hasAlpha: true });
  for (let y = 2; y < 6; y++) {
    for (let x = 2; x < 6; x++) setPixel(image, x, y, GREEN);
  }
  for (let y = 2; y < 6; y++) {
    for (let x = 14; x < 18; x++) setPixel(image, x, y, BLUE);
  }
  writeFileSync(file, encodePng(image));
}

let work: string;

beforeEach(() => {
  work = mkdtempSync(join(tmpdir(), 'gaf-ai-'));
});

afterEach(() => {
  rmSync(work, { recursive: true, force: true });
});

const MOCK_CONFIG = { enabled: true, provider: 'mock' as const };

function makeOptions(outputDir: string, provider?: MockVisionProvider): AiAnalyzeOptions {
  return {
    root: work,
    outputDir,
    config: { ...MOCK_CONFIG },
    log: NO_LOG,
    ...(provider !== undefined ? { providerFactory: () => provider } : {}),
  };
}

describe('runAiAnalyze (mock provider)', () => {
  it('understands a folder and writes the three sidecar artifacts', async () => {
    mkdirSync(join(work, 'assets'));
    writeSheet(join(work, 'assets', 'hero.png'));
    writeSheet(join(work, 'assets', 'slime.png'));
    writeSheet(join(work, 'assets', 'tree.png'));

    const { summary } = await runAiAnalyze({
      root: join(work, 'assets'),
      outputDir: join(work, 'out'),
      config: { ...MOCK_CONFIG },
      log: NO_LOG,
    });

    expect(summary.total).toBe(3);
    expect(summary.analyzed).toBe(3);
    expect(summary.failed).toBe(0);
    for (const file of ['ai_report.json', 'classification.json', 'asset_metadata.json']) {
      expect(existsSync(join(work, 'out', file)), file).toBe(true);
    }
    const report = JSON.parse(readFileSync(join(work, 'out', 'ai_report.json'), 'utf8'));
    expect(report.version).toBe(1);
    expect(report.provider).toBe('mock');
    expect(report.results).toHaveLength(3);
    for (const entry of report.results) {
      expect(['character', 'item', 'environment']).toContain(entry.assetType);
    }
    for (const animation of report.suggestions.animation) {
      expect(animation.recommended.length).toBeGreaterThan(0);
    }
    const classification = JSON.parse(
      readFileSync(join(work, 'out', 'classification.json'), 'utf8'),
    );
    expect(classification.items).toHaveLength(3);
    for (const item of classification.items) {
      expect(item.suggestedFolder).toBe(`${item.assetType}s`);
    }
    const metadata = JSON.parse(readFileSync(join(work, 'out', 'asset_metadata.json'), 'utf8'));
    expect(metadata.assets).toHaveLength(3);
  });

  it('cache makes the second run cost zero provider calls (C4)', async () => {
    mkdirSync(join(work, 'assets'));
    writeSheet(join(work, 'assets', 'hero.png'));
    const provider = new MockVisionProvider();
    const out = join(work, 'out');

    const first = await runAiAnalyze(makeOptions(out, provider));
    expect(first.summary.cacheMisses).toBe(1);
    expect(provider.calls).toBe(1);

    const second = await runAiAnalyze(makeOptions(out, provider));
    expect(second.summary.cacheHits).toBe(1);
    expect(second.summary.cacheMisses).toBe(0);
    expect(provider.calls).toBe(1);
  });

  it('AI artifacts never perturb the deterministic quality outputs (C6)', async () => {
    mkdirSync(join(work, 'assets'));
    writeSheet(join(work, 'assets', 'hero.png'));
    const pipeline = parsePreset({ schemaVersion: 2 });

    const before = runQualityAnalyze({
      root: join(work, 'assets'),
      pipeline,
      outputDir: join(work, 'q1'),
      log: NO_LOG,
    });
    await runAiAnalyze({
      root: join(work, 'assets'),
      outputDir: join(work, 'ai-out'),
      config: { ...MOCK_CONFIG },
      log: NO_LOG,
    });
    const after = runQualityAnalyze({
      root: join(work, 'assets'),
      pipeline,
      outputDir: join(work, 'q2'),
      log: NO_LOG,
    });

    const jsonBefore = before.summary.outputFiles[0];
    const jsonAfter = after.summary.outputFiles[0];
    expect(readFileSync(jsonBefore)).toEqual(readFileSync(jsonAfter));
  });

  it('records decode failures and still writes reports', async () => {
    mkdirSync(join(work, 'assets'));
    writeFileSync(join(work, 'assets', 'broken.png'), Buffer.from('%PNG-not-really'));
    const { summary } = await runAiAnalyze({
      root: join(work, 'assets'),
      outputDir: join(work, 'out'),
      config: { ...MOCK_CONFIG },
      log: NO_LOG,
    });
    expect(summary.total).toBe(1);
    expect(summary.analyzed).toBe(0);
    expect(summary.failed).toBe(1);
    expect(existsSync(join(work, 'out', 'ai_report.json'))).toBe(true);
  });

  it('disabled cloud config fails with AiDisabledError', async () => {
    mkdirSync(join(work, 'assets'));
    writeSheet(join(work, 'assets', 'hero.png'));
    await expect(
      runAiAnalyze({
        root: join(work, 'assets'),
        outputDir: join(work, 'out'),
        config: { enabled: false, provider: 'openai' },
        log: NO_LOG,
      }),
    ).rejects.toThrowError(AiDisabledError);
  });

  it('creates the provider through the standard factory when none is injected', async () => {
    mkdirSync(join(work, 'assets'));
    writeSheet(join(work, 'assets', 'hero.png'));
    const { summary } = await runAiAnalyze({
      root: join(work, 'assets'),
      outputDir: join(work, 'out'),
      config: { enabled: true, provider: 'mock' },
      log: NO_LOG,
    });
    expect(summary.analyzed).toBe(1);
  });
});

describe('CLI end-to-end (built dist)', () => {
  const run = (
    args: string[],
    cwd?: string,
  ): { status: number; stdout: string; stderr: string } => {
    try {
      const stdout = execFileSync(process.execPath, [CLI_JS, ...args], {
        cwd: cwd ?? work,
        encoding: 'utf8',
      });
      return { status: 0, stdout, stderr: '' };
    } catch (error) {
      const e = error as { status?: number; stdout?: string; stderr?: string };
      return { status: e.status ?? -1, stdout: e.stdout ?? '', stderr: e.stderr ?? '' };
    }
  };

  it(
    'ai analyze via built binary exits 0 and writes artifacts',
    { skip: !existsSync(CLI_JS) },
    () => {
      mkdirSync(join(work, 'assets'));
      writeSheet(join(work, 'assets', 'hero.png'));
      writeFileSync(
        join(work, 'ai.config.json'),
        JSON.stringify({ enabled: true, provider: 'mock' }),
        'utf8',
      );
      const result = run(['ai', 'analyze', 'assets', '-c', 'ai.config.json', '-o', 'out']);
      expect(result.status).toBe(0);
      expect(result.stdout).toContain('ai analyze done');
      expect(existsSync(join(work, 'out', 'ai_report.json'))).toBe(true);
      expect(existsSync(join(work, 'out', 'classification.json'))).toBe(true);
      expect(existsSync(join(work, 'out', 'asset_metadata.json'))).toBe(true);
    },
  );

  it('broken assets make ai analyze exit 1', { skip: !existsSync(CLI_JS) }, () => {
    mkdirSync(join(work, 'assets'));
    writeFileSync(join(work, 'assets', 'broken.png'), Buffer.from('%PNG-not-really'));
    const result = run(['ai', 'analyze', 'assets', '-o', 'out']);
    expect(result.status).toBe(1);
  });
});
