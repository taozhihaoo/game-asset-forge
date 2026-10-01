import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { crc32, deflateSync } from 'node:zlib';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  createRasterImage,
  parsePreset,
  setPixel,
  type Pixel,
  type RasterImage,
} from '@gameasset-forge/core';
import { runAnalyze } from '../packages/cli/src/commands/analyze.js';
import { renderQualityReportHtml } from '../packages/cli/src/reporting/html.js';

const CLI_JS = fileURLToPath(new URL('../packages/cli/dist/main.js', import.meta.url));
const NO_LOG = (): void => {};

const SOLID: Pixel = [200, 200, 200, 255];
const OTHER: Pixel = [30, 30, 200, 255];
const CLEAR: Pixel = [0, 0, 0, 0];

function encodePngFile(file: string, image: RasterImage): void {
  const chunk = (type: string, data: Buffer): Buffer => {
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    const typeBuffer = Buffer.from(type, 'latin1');
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])) >>> 0);
    return Buffer.concat([length, typeBuffer, data, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(image.width, 0);
  ihdr.writeUInt32BE(image.height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const raw = Buffer.alloc(image.height * (1 + image.width * 4));
  let offset = 0;
  for (let y = 0; y < image.height; y++) {
    raw[offset++] = 0;
    for (let x = 0; x < image.width; x++) {
      const i = (y * image.width + x) * 4;
      raw.set(image.data.subarray(i, i + 4), offset);
      offset += 4;
    }
  }
  writeFileSync(
    file,
    Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      chunk('IHDR', ihdr),
      chunk('IDAT', deflateSync(raw)),
      chunk('IEND', Buffer.alloc(0)),
    ]),
  );
}

function solid(w: number, h: number, color: Pixel = SOLID): RasterImage {
  const image = createRasterImage(w, h, { hasAlpha: true });
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) setPixel(image, x, y, color);
  }
  return image;
}

let work: string;

beforeEach(() => {
  work = mkdtempSync(join(tmpdir(), 'gaf-analyze-'));
});

afterEach(() => {
  rmSync(work, { recursive: true, force: true });
});

describe('runAnalyze — acceptance Scenario 1', () => {
  it('flags duplicates, naming, size mismatch, and transparency in one run', () => {
    const assets = join(work, 'assets');
    mkdirSync(assets);
    // 1. duplicate: identical content, junk copy name (also naming-flagged)
    const idle = solid(128, 128);
    encodePngFile(join(assets, 'hero_idle_01.png'), idle);
    encodePngFile(join(assets, 'hero_idle_copy.png'), idle);
    // 2. size mismatch: deviant frame in a group (distinct color so the
    //    walk group is not byte-identical to the idle group)
    encodePngFile(join(assets, 'hero_walk_01.png'), solid(128, 128, OTHER));
    encodePngFile(join(assets, 'hero_walk_02.png'), solid(256, 256, OTHER));
    // 3. transparency: mostly empty canvas
    const faint = solid(100, 100, CLEAR);
    for (let y = 40; y < 60; y++) {
      for (let x = 40; x < 60; x++) setPixel(faint, x, y, SOLID);
    }
    encodePngFile(join(assets, 'faint.png'), faint);
    // 4. naming: junk name (non-duplicate content)
    encodePngFile(join(assets, 'bad_name.png'), solid(32, 32, OTHER));

    const { summary, report } = runAnalyze(
      { root: assets, pipeline: parsePreset({ schemaVersion: 2 }), outputDir: join(work, 'out') },
      NO_LOG,
    );

    expect(summary.total).toBe(6);
    expect(summary.analyzed).toBe(6);
    expect(summary.failed).toBe(0);
    expect(existsSync(join(work, 'out', 'quality_report.json'))).toBe(true);
    expect(existsSync(join(work, 'out', 'quality_report.html'))).toBe(true);

    const json = report as {
      version: number;
      summary: Record<string, number>;
      issues: { asset: string; warnings: { rule: string }[] }[];
      errors: unknown[];
    };
    expect(json.version).toBe(2);
    expect(json.errors).toEqual([]);

    const warningsFor = (asset: string): string[] =>
      json.issues.find((i) => i.asset === asset)?.warnings.map((w) => w.rule) ?? [];
    expect(warningsFor('hero_idle_copy.png')).toContain('duplicate_frames');
    expect(warningsFor('bad_name.png')).toContain('naming_convention');
    expect(warningsFor('hero_walk_02.png')).toContain('size_mismatch');
    expect(warningsFor('faint.png')).toContain('transparent_area');
    // keeper and correctly named frames stay clean of those rules
    expect(warningsFor('hero_idle_01.png')).not.toContain('duplicate_frames');
    expect(warningsFor('hero_walk_01.png')).not.toContain('size_mismatch');
    expect(warningsFor('hero_idle_01.png')).not.toContain('naming_convention');
  });

  it('records decode failures and keeps analyzing the rest', () => {
    mkdirSync(join(work, 'assets'));
    writeFileSync(join(work, 'assets', 'broken.png'), Buffer.from('%PNG-not-really'));
    encodePngFile(join(work, 'assets', 'good.png'), solid(8, 8));

    const { summary } = runAnalyze(
      {
        root: join(work, 'assets'),
        pipeline: parsePreset({ schemaVersion: 2 }),
        outputDir: join(work, 'out'),
      },
      NO_LOG,
    );
    expect(summary.total).toBe(2);
    expect(summary.analyzed).toBe(1);
    expect(summary.failed).toBe(1);
    expect(summary.errors[0]).toMatchObject({ source: 'broken.png' });
  });

  it('is deterministic: same input double-run produces byte-identical JSON', () => {
    mkdirSync(join(work, 'assets'));
    encodePngFile(join(work, 'assets', 'a.png'), solid(16, 16));
    encodePngFile(join(work, 'assets', 'a_copy.png'), solid(16, 16));
    const opts = {
      root: join(work, 'assets'),
      pipeline: parsePreset({ schemaVersion: 2 }),
    };
    runAnalyze({ ...opts, outputDir: join(work, 'out1') }, NO_LOG);
    runAnalyze({ ...opts, outputDir: join(work, 'out2') }, NO_LOG);
    expect(readFileSync(join(work, 'out1', 'quality_report.json'))).toEqual(
      readFileSync(join(work, 'out2', 'quality_report.json')),
    );
  });
});

describe('renderQualityReportHtml', () => {
  it('escapes asset names and marks clean assets as Good', () => {
    const html = renderQualityReportHtml({
      version: 2,
      summary: { assets: 2, warnings: 1, high: 1, medium: 0, low: 0, info: 0 },
      issues: [
        {
          asset: '<weird> & "name".png',
          warnings: [
            {
              rule: 'size_mismatch',
              severity: 'high',
              message: 'mismatch <here>',
              suggestion: 'fix "it"',
            },
          ],
        },
        { asset: 'clean.png', warnings: [] },
      ],
    });
    expect(html).toContain('Asset Quality Report');
    expect(html).toContain('&lt;weird&gt; &amp; &quot;name&quot;.png');
    expect(html).not.toContain('<weird>');
    expect(html).toContain('mismatch &lt;here&gt;');
    expect(html).toContain('✓ Good');
  });
});

describe('analyze CLI end-to-end', () => {
  it('exits 0 and writes reports via the built binary', { skip: !existsSync(CLI_JS) }, () => {
    mkdirSync(join(work, 'assets'));
    const image = solid(8, 8);
    encodePngFile(join(work, 'assets', 'one.png'), image);
    encodePngFile(join(work, 'assets', 'two.png'), image); // exact duplicate
    execFileSync(process.execPath, [CLI_JS, 'analyze', 'assets', '-o', 'out'], { cwd: work });
    const report = JSON.parse(readFileSync(join(work, 'out', 'quality_report.json'), 'utf8'));
    expect(report.summary.assets).toBe(2);
    expect(report.summary.warnings).toBeGreaterThanOrEqual(1);
    expect(existsSync(join(work, 'out', 'quality_report.html'))).toBe(true);
  });
});
