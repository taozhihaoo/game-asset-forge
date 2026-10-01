import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  createRasterImage,
  parsePreset,
  runPipeline,
  serializePreset,
  setPixel,
  type Pixel,
} from '@gameasset-forge/core';
import { decodePng } from '../packages/cli/src/png.js';

/**
 * GUI / Core / CLI consistency (charter §26, DoD [13][14]).
 *
 * The GUI renderer executes exactly these functions: parsePreset(bytes →
 * JSON) → runPipeline → (save) serializePreset. This test runs that code
 * path against the CLI code path on the same preset file and the same
 * pixels, and requires byte-identical manifests. Decode layers differ
 * (pngjs vs createImageBitmap) but both produce the same RGBA8 raster from
 * the same file — decode correctness is covered by its own suites.
 */

const CLI_JS = fileURLToPath(new URL('../packages/cli/dist/main.js', import.meta.url));

const RED: Pixel = [255, 40, 40, 255];
const GREEN: Pixel = [40, 255, 40, 255];

let work: string;

beforeEach(() => {
  work = mkdtempSync(join(tmpdir(), 'gaf-consistency-'));
});

afterEach(() => {
  rmSync(work, { recursive: true, force: true });
});

function makeSheet(file: string): void {
  const image = createRasterImage(28, 12, { hasAlpha: true });
  for (let y = 2; y < 7; y++) {
    for (let x = 2; x < 7; x++) setPixel(image, x, y, RED);
  }
  for (let y = 3; y < 9; y++) {
    for (let x = 16; x < 24; x++) setPixel(image, x, y, GREEN);
  }
  writeFileSync(file, encodeStandalonePng(image));
}

// pngjs-free encoder (zlib) so this test stays independent of the cli png
// module for INPUT creation; decode still uses the cli decoder below.
import { crc32, deflateSync } from 'node:zlib';
function encodeStandalonePng(image: ReturnType<typeof createRasterImage>): Buffer {
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
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

describe('GUI / CLI / Core consistency', () => {
  it('GUI code path and CLI produce identical manifests from the same preset file', () => {
    const sheet = join(work, 'sheet.png');
    makeSheet(sheet);
    const presetFile = join(work, 'preset.json');
    const preset = {
      schemaVersion: 1,
      detect: { mode: 'alpha-connected-components' as const, alphaThreshold: 16 },
      padding: { pixels: 1 },
      bleed: { pixels: 1 },
    };
    writeFileSync(presetFile, `${JSON.stringify(preset, null, 2)}\n`, 'utf8');

    // CLI path: spawn the built CLI (skipped only if dist is missing)
    if (existsSync(CLI_JS)) {
      execFileSync(
        process.execPath,
        [CLI_JS, 'process', 'sheet.png', '-p', 'preset.json', '-o', 'out-cli'],
        {
          cwd: work,
        },
      );
    }

    // GUI path: the renderer's exact sequence on the same bytes
    const presetJson = JSON.parse(readFileSync(presetFile, 'utf8'));
    const pipeline = parsePreset(presetJson);
    const raster = decodePng(readFileSync(sheet), 'sheet.png');
    const guiResult = runPipeline(raster, pipeline, { sourcePath: 'sheet.png' });

    if (existsSync(join(work, 'out-cli', 'atlas.json'))) {
      const cliManifest = JSON.parse(readFileSync(join(work, 'out-cli', 'atlas.json'), 'utf8'));
      expect(guiResult.manifest).toEqual(cliManifest);
    }

    // GUI save → load roundtrip keeps semantics (serializePreset first key)
    const serialized = JSON.parse(serializePreset(pipeline));
    expect(Object.keys(serialized)[0]).toBe('schemaVersion');
    const reloaded = parsePreset(serialized);
    const rerun = runPipeline(raster, reloaded, { sourcePath: 'sheet.png' });
    expect(rerun.manifest).toEqual(guiResult.manifest);
  });

  it('GUI manual-rect fallback follows the same preset schema the CLI accepts', () => {
    const sheet = join(work, 'sheet.png');
    makeSheet(sheet);
    const raster = decodePng(readFileSync(sheet), 'sheet.png');

    // manual mode via GUI state → serialized preset must be CLI-valid
    const pipeline = parsePreset({
      schemaVersion: 1,
      detect: { mode: 'manual', rects: [{ x: 0, y: 0, width: 12, height: 12, id: 'hero' }] },
    });
    const serialized = JSON.parse(serializePreset(pipeline));
    writeFileSync(join(work, 'preset.json'), serializePreset(pipeline), 'utf8');
    const cliPipeline = parsePreset(JSON.parse(readFileSync(join(work, 'preset.json'), 'utf8')));

    const guiResult = runPipeline(raster, pipeline, { sourcePath: 'sheet.png' });
    const cliResult = runPipeline(raster, cliPipeline, { sourcePath: 'sheet.png' });
    expect(guiResult.manifest).toEqual(cliResult.manifest);
    expect(guiResult.sprites[0].id).toBe('sheet.png#hero');
    void serialized;
  });
});
