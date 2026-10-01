import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { crc32, deflateSync } from 'node:zlib';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  createRasterImage,
  parsePreset,
  serializePreset,
  setPixel,
  type Pixel,
  type RasterImage,
} from '@gameasset-forge/core';
import { encodePng, readPngInfo } from '../packages/cli/src/png.js';
import {
  runBatch,
  runInit,
  runInspect,
  runProcess,
  runValidate,
} from '../packages/cli/src/commands/index.js';

const CLI_JS = fileURLToPath(new URL('../packages/cli/dist/main.js', import.meta.url));
const NO_LOG = (): void => {};

const RED: Pixel = [255, 0, 0, 255];
const GREEN: Pixel = [0, 255, 0, 255];

function blob(image: RasterImage, x: number, y: number, w: number, h: number, color: Pixel): void {
  for (let dy = 0; dy < h; dy++)
    for (let dx = 0; dx < w; dx++) setPixel(image, x + dx, y + dy, color);
}

/** Writes a sheet with two separated 4x4 sprites (RGBA, via pngjs). */
function writeTwoSpriteSheet(file: string): void {
  const image = createRasterImage(24, 8, { hasAlpha: true });
  blob(image, 2, 2, 4, 4, RED);
  blob(image, 14, 2, 4, 4, GREEN);
  writeFileSync(file, encodePng(image));
}

function pngChunk(type: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const typeBuffer = Buffer.from(type, 'latin1');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])) >>> 0);
  return Buffer.concat([length, typeBuffer, data, crc]);
}

/**
 * Encodes a TRUE RGB PNG (colorType 2, no alpha). pngjs only writes RGBA,
 * so the no-alpha contract needs a hand-built encoder.
 */
function writeRgbPng(file: string, image: RasterImage): void {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(image.width, 0);
  ihdr.writeUInt32BE(image.height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // color type: truecolor RGB
  const raw = Buffer.alloc(image.height * (1 + image.width * 3));
  let offset = 0;
  for (let y = 0; y < image.height; y++) {
    raw[offset++] = 0; // filter: none
    for (let x = 0; x < image.width; x++) {
      const i = (y * image.width + x) * 4;
      raw[offset++] = image.data[i];
      raw[offset++] = image.data[i + 1];
      raw[offset++] = image.data[i + 2];
    }
  }
  const png = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', deflateSync(raw)),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
  writeFileSync(file, png);
}

/** Writes a TRUE RGB (no-alpha) sheet with two sprites. */
function writeRgbTwoSpriteSheet(file: string): void {
  const image = createRasterImage(24, 8, { hasAlpha: false });
  blob(image, 2, 2, 4, 4, RED);
  blob(image, 14, 2, 4, 4, GREEN);
  writeRgbPng(file, image);
}

let work: string;

beforeEach(() => {
  work = mkdtempSync(join(tmpdir(), 'gaf-cli-'));
});

afterEach(() => {
  rmSync(work, { recursive: true, force: true });
});

describe('init', () => {
  it('writes a valid default preset with schemaVersion as first key', () => {
    const file = join(work, 'preset.json');
    runInit(file, false, NO_LOG);
    const json = JSON.parse(readFileSync(file, 'utf8'));
    expect(Object.keys(json)[0]).toBe('schemaVersion');
    expect(json.schemaVersion).toBe(1);
    // round-trips through the core validator
    expect(() => parsePreset(json)).not.toThrow();
  });

  it('refuses to overwrite without --force', () => {
    const file = join(work, 'preset.json');
    runInit(file, false, NO_LOG);
    expect(() => runInit(file, false, NO_LOG)).toThrowError(/already exists/);
    expect(() => runInit(file, true, NO_LOG)).not.toThrow();
  });
});

describe('validate', () => {
  it('accepts a valid preset', () => {
    const file = join(work, 'preset.json');
    writeFileSync(file, serializePreset(parsePreset({ schemaVersion: 1 })), 'utf8');
    expect(runValidate(file, NO_LOG)).toMatch(/preset valid/);
  });

  it('rejects an invalid preset with a typed error', () => {
    const file = join(work, 'bad.json');
    writeFileSync(file, JSON.stringify({ schemaVersion: 99 }), 'utf8');
    expect(() => runValidate(file, NO_LOG)).toThrowError(/schema version/);
  });

  it('rejects malformed JSON with the file path', () => {
    const file = join(work, 'broken.json');
    writeFileSync(file, '{not json', 'utf8');
    expect(() => runValidate(file, NO_LOG)).toThrowError(/broken\.json/);
  });
});

describe('inspect', () => {
  it('reports format, alpha, detection count, and estimate', () => {
    const sheet = join(work, 'sheet.png');
    writeTwoSpriteSheet(sheet);
    const report = runInspect({ input: sheet }, NO_LOG);
    expect(report).toMatch(/PNG \(colorType 6/);
    expect(report).toMatch(/alpha:\s+yes/);
    expect(report).toMatch(/2 detected, 0 skipped/);
    expect(report).toMatch(/estimated:\s+1 page\(s\)/);
  });

  it('warns instead of failing on RGB sources with alpha-CC detection', () => {
    const sheet = join(work, 'rgb.png');
    writeRgbTwoSpriteSheet(sheet);
    const report = runInspect({ input: sheet }, NO_LOG);
    expect(report).toMatch(/alpha:\s+no/);
    expect(report).toMatch(/warning:.*no alpha channel/);
    expect(report).not.toMatch(/sprites:/);
  });
});

describe('process', () => {
  it('writes atlas PNG + manifest and is byte-deterministic', () => {
    const sheet = join(work, 'sheet.png');
    writeTwoSpriteSheet(sheet);
    const pipeline = parsePreset({
      schemaVersion: 1,
      padding: { pixels: 1 },
      bleed: { pixels: 1 },
    });

    const outA = join(work, 'out-a');
    const outB = join(work, 'out-b');
    runProcess({ absolutePath: sheet, relativePath: 'sheet.png' }, pipeline, outA, NO_LOG);
    runProcess({ absolutePath: sheet, relativePath: 'sheet.png' }, pipeline, outB, NO_LOG);

    expect(existsSync(join(outA, 'atlas-0.png'))).toBe(true);
    const manifest = JSON.parse(readFileSync(join(outA, 'atlas.json'), 'utf8'));
    expect(manifest.schemaVersion).toBe(1);
    expect(manifest.source).toBe('sheet.png');
    expect(manifest.sprites).toHaveLength(2);
    expect(manifest.pages[0].file).toBe('atlas-0.png');

    // deterministic outputs: identical bytes across runs
    expect(readFileSync(join(outA, 'atlas-0.png'))).toEqual(
      readFileSync(join(outB, 'atlas-0.png')),
    );
    expect(readFileSync(join(outA, 'atlas.json'))).toEqual(readFileSync(join(outB, 'atlas.json')));

    // the atlas PNG decodes back with the manifest's page dimensions
    const info = readPngInfo(readFileSync(join(outA, 'atlas-0.png')));
    expect(info.width).toBe(manifest.pages[0].width);
    expect(info.height).toBe(manifest.pages[0].height);
  });

  it('rejects non-PNG inputs with the charter message', () => {
    const jpg = join(work, 'photo.jpg');
    writeFileSync(jpg, Buffer.from([0xff, 0xd8, 0xff]));
    expect(() =>
      runProcess(
        { absolutePath: jpg, relativePath: 'photo.jpg' },
        parsePreset({ schemaVersion: 1 }),
        join(work, 'out'),
        NO_LOG,
      ),
    ).toThrowError(/PNG is the only supported V1 input format/);
  });

  it('fails on corrupt PNG content (processing failure, not usage)', () => {
    const corrupt = join(work, 'corrupt.png');
    writeFileSync(corrupt, Buffer.from('%PNG-not-really'));
    expect(() =>
      runProcess(
        { absolutePath: corrupt, relativePath: 'corrupt.png' },
        parsePreset({ schemaVersion: 1 }),
        join(work, 'out'),
        NO_LOG,
      ),
    ).toThrowError(/not a PNG file|decode failed/);
  });

  it('fails on RGB input with alpha-CC detection (NoAlphaChannelError)', () => {
    const rgb = join(work, 'rgb.png');
    writeRgbTwoSpriteSheet(rgb);
    expect(() =>
      runProcess(
        { absolutePath: rgb, relativePath: 'rgb.png' },
        parsePreset({ schemaVersion: 1 }),
        join(work, 'out'),
        NO_LOG,
      ),
    ).toThrowError(/no alpha channel/);
  });
});

describe('batch', () => {
  it('processes recursively, mirrors output paths, and writes summary.json', () => {
    writeTwoSpriteSheet(join(work, 'alpha.png'));
    mkdirSync(join(work, 'sub'));
    writeTwoSpriteSheet(join(work, 'sub', 'beta.png'));
    writeFileSync(join(work, 'notes.txt'), 'not an image');
    mkdirSync(join(work, 'output'));
    writeTwoSpriteSheet(join(work, 'output', 'ignored.png')); // default exclude

    const { summary } = runBatch({
      root: work,
      pipeline: parsePreset({ schemaVersion: 1 }),
      outputDir: join(work, 'out'),
      log: NO_LOG,
    });

    expect(summary.total).toBe(2);
    expect(summary.succeeded).toBe(2);
    expect(summary.failed).toBe(0);
    expect(existsSync(join(work, 'out', 'alpha', 'atlas-0.png'))).toBe(true);
    expect(existsSync(join(work, 'out', 'sub', 'beta', 'atlas-0.png'))).toBe(true);
    const written = JSON.parse(readFileSync(join(work, 'out', 'summary.json'), 'utf8'));
    expect(written.total).toBe(2);
    expect(written.errors).toEqual([]);
    expect(written.outputs.length).toBeGreaterThanOrEqual(5); // 2 pages + 2 manifests + summary
  });

  it('records failures per-file and keeps processing the rest', () => {
    writeTwoSpriteSheet(join(work, 'good.png'));
    writeFileSync(join(work, 'broken.png'), Buffer.from('%PNG-not-really'));

    const { summary } = runBatch({
      root: work,
      pipeline: parsePreset({ schemaVersion: 1 }),
      outputDir: join(work, 'out'),
      log: NO_LOG,
    });

    expect(summary.total).toBe(2);
    expect(summary.succeeded).toBe(1);
    expect(summary.failed).toBe(1);
    expect(summary.errors[0]).toMatchObject({ source: 'broken.png', stage: 'decode' });
    expect(existsSync(join(work, 'out', 'good', 'atlas-0.png'))).toBe(true);
  });

  it('honors no-recursive and explicit exclude overrides', () => {
    // inputs live in their own subtree so batch outputs never pollute discovery
    const assets = join(work, 'assets');
    mkdirSync(assets);
    writeTwoSpriteSheet(join(assets, 'alpha.png'));
    mkdirSync(join(assets, 'sub'));
    writeTwoSpriteSheet(join(assets, 'sub', 'beta.png'));

    const pipeline = parsePreset({ schemaVersion: 1, input: { recursive: false } });
    const { summary } = runBatch({
      root: assets,
      pipeline,
      outputDir: join(work, 'out'),
      log: NO_LOG,
    });
    expect(summary.total).toBe(1);
    expect(summary.succeeded).toBe(1);

    const pipelineExcluded = parsePreset({
      schemaVersion: 1,
      input: { exclude: ['**/sub/**'] },
    });
    const { summary: s2 } = runBatch({
      root: assets,
      pipeline: pipelineExcluded,
      outputDir: join(work, 'out2'),
      log: NO_LOG,
    });
    expect(s2.total).toBe(1);
  });
});

describe('exporters via process', () => {
  it('writes Godot SpriteFrames and Unity importer when enabled in the preset', () => {
    const sheet = join(work, 'player.png');
    writeTwoSpriteSheet(sheet);
    const pipeline = parsePreset({
      schemaVersion: 1,
      output: { godot: { enabled: true }, unity: { enabled: true } },
    });
    const out = join(work, 'out');
    runProcess({ absolutePath: sheet, relativePath: 'player.png' }, pipeline, out, NO_LOG);

    const tres = readFileSync(join(out, 'player_spriteframes.tres'), 'utf8');
    expect(tres).toContain('[gd_resource type="SpriteFrames"');
    expect(tres).toContain('path="atlas-0.png"');
    expect(tres).toContain('SubResource("AtlasTexture_1")');

    const cs = readFileSync(join(out, 'GameAssetForgeImporter.cs'), 'utf8');
    expect(cs).toContain('class GameAssetForgeImporter : AssetPostprocessor');
  });
});

describe.skipIf(!existsSync(CLI_JS))('CLI end-to-end (built dist)', () => {
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

  it('help works and lists all five commands', { skip: !existsSync(CLI_JS) }, () => {
    const result = run(['--help']);
    expect(result.status).toBe(0);
    for (const command of ['init', 'inspect', 'validate', 'process', 'batch']) {
      expect(result.stdout).toContain(command);
    }
  });

  it(
    'process exits 0 and produces outputs; unsupported input exits 2',
    { skip: !existsSync(CLI_JS) },
    () => {
      const sheet = join(work, 'sheet.png');
      writeTwoSpriteSheet(sheet);
      const ok = run(['process', 'sheet.png', '-o', 'out']);
      expect(ok.status).toBe(0);
      expect(existsSync(join(work, 'out', 'atlas.json'))).toBe(true);

      const jpg = join(work, 'photo.jpg');
      writeFileSync(jpg, Buffer.from([0xff, 0xd8]));
      const bad = run(['process', 'photo.jpg', '-o', 'out2']);
      expect(bad.status).toBe(2);
      expect(bad.stderr).toMatch(/PNG is the only supported V1 input format/);
    },
  );

  it(
    'batch with failures exits 1; validate of bad preset exits 2',
    { skip: !existsSync(CLI_JS) },
    () => {
      writeTwoSpriteSheet(join(work, 'good.png'));
      writeFileSync(join(work, 'broken.png'), Buffer.from('%PNG-not-really'));
      const batch = run(['batch', '.', '-o', 'out']);
      expect(batch.status).toBe(1);

      const badPreset = join(work, 'bad.json');
      writeFileSync(
        badPreset,
        JSON.stringify({ schemaVersion: 1, atlas: { spacing: -5 } }),
        'utf8',
      );
      const validate = run(['validate', 'bad.json']);
      expect(validate.status).toBe(2);
    },
  );
});
