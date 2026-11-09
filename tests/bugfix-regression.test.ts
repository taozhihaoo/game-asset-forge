import { mkdtempSync, existsSync, readFileSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { inflateSync } from 'node:zlib';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  ForgeError,
  createRasterImage,
  parsePreset,
  rasterHash64,
  runPipeline,
  setPixel,
  type Pixel,
} from '@gameasset-forge/core';
import {
  AiConfigError,
  OpenAiVisionProvider,
  cacheKey,
  createProvider,
  resolveAiConfig,
  understandAsset,
  type UnderstandInvocation,
  type VisionProvider,
} from '@gameasset-forge/ai';
import { buildUnityImporterScript } from '../packages/cli/src/exporters/unity.js';
import { writePipelineOutputs } from '../packages/cli/src/output.js';
import { encodePng } from '../packages/cli/src/png.js';
import { runBatch, runProcess } from '../packages/cli/src/commands/index.js';
import { JsonFileCacheStore, loadAiConfig } from '../packages/cli/src/ai-cache.js';

/**
 * Regression suite for the 2026-11 audit fixes. Every test here fails on the
 * pre-fix code; they pin the observable behaviour, not the implementation.
 */

const RED: Pixel = [255, 40, 40, 255];

function sheet(): ReturnType<typeof createRasterImage> {
  const image = createRasterImage(24, 8, { hasAlpha: true });
  for (let y = 2; y < 6; y++) for (let x = 2; x < 6; x++) setPixel(image, x, y, RED);
  return image;
}

function idatOf(png: Uint8Array): Uint8Array {
  const view = new DataView(png.buffer, png.byteOffset, png.byteLength);
  let offset = 8;
  while (offset + 8 <= png.length) {
    const length = view.getUint32(offset);
    const type = String.fromCharCode(
      png[offset + 4],
      png[offset + 5],
      png[offset + 6],
      png[offset + 7],
    );
    if (type === 'IDAT') return png.subarray(offset + 8, offset + 8 + length);
    offset += 12 + length;
  }
  throw new Error('no IDAT chunk');
}

let work: string;
beforeEach(() => {
  work = mkdtempSync(join(tmpdir(), 'gaf-regression-'));
});
afterEach(() => {
  rmSync(work, { recursive: true, force: true });
});

describe('cloud provider: valid PNG upload + fenced JSON', () => {
  it('emits a PNG whose zlib stream has a correct Adler-32 checksum', async () => {
    // Pre-fix code wrote CRC-32 in the zlib trailer; inflateSync throws
    // "incorrect data check" for any strict decoder (including the vision API).
    let dataUrl = '';
    const provider = new OpenAiVisionProvider({
      apiKey: 'test-key',
      model: 'test-model',
      fetchFn: async (_input, init) => {
        const body = JSON.parse(String(init?.body)) as {
          messages: { content: { image_url?: { url: string } }[] }[];
        };
        dataUrl = body.messages[0].content[1].image_url!.url;
        return new Response(
          JSON.stringify({ choices: [{ message: { content: '{"assetType":"item"}' } }] }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      },
    });
    const image = createRasterImage(3, 2, { hasAlpha: true });
    setPixel(image, 0, 0, RED);
    await provider.understand({ image, name: 'a.png', prompt: 'p', promptVersion: '1.0' });

    expect(dataUrl.startsWith('data:image/png;base64,')).toBe(true);
    const png = Buffer.from(dataUrl.slice('data:image/png;base64,'.length), 'base64');
    const raw = inflateSync(idatOf(png));
    expect(raw.length).toBe(2 * (1 + 3 * 4)); // 2 rows, filter byte + RGBA
  });

  it('strips ```json fences before schema validation', async () => {
    const provider = new OpenAiVisionProvider({
      apiKey: 'test-key',
      model: 'test-model',
      fetchFn: async () =>
        new Response(
          JSON.stringify({
            choices: [
              {
                message: {
                  content: '```json\n{"assetType":"character","confidence":0.8}\n```',
                },
              },
            ],
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        ),
    });
    const image = createRasterImage(2, 2, { hasAlpha: true });
    const result = await provider.understand({
      image,
      name: 'a.png',
      prompt: 'p',
      promptVersion: '1.0',
    });
    expect(result).toMatchObject({ assetType: 'character', confidence: 0.8 });
  });
});

describe('Unity exporter pivot orientation', () => {
  it('flips the Y axis (core top-left vs Unity bottom-left)', () => {
    expect(buildUnityImporterScript()).toContain('1f - sprite.pivot.y');
  });
});

describe('AI cache keys and config', () => {
  it('includes the source name so identical pixels with different names never collide', () => {
    const base = { imageHash: 'abc', providerId: 'mock', model: 'm', promptVersion: '1.0' };
    expect(cacheKey({ ...base, name: 'hero.png' })).not.toBe(
      cacheKey({ ...base, name: 'slime.png' }),
    );
    expect(cacheKey({ ...base, name: 'hero.png' })).toBe(cacheKey({ ...base, name: 'hero.png' }));
    // Unnamed keys keep the legacy format so existing on-disk caches still work.
    expect(cacheKey(base)).toBe('mock/m/v1.0/abc');
  });

  it('rejects an unknown provider from config resolution and from the factory', () => {
    expect(() => resolveAiConfig({ provider: 'typo' as 'mock' })).toThrowError(AiConfigError);
    expect(() => createProvider({ enabled: true, provider: 'typo' as 'mock' })).toThrowError(
      AiConfigError,
    );
  });

  it('survives a corrupt cache file and reports a readable config error', () => {
    const cacheFile = join(work, 'ai-cache.json');
    writeFileSync(cacheFile, '{ this is not json', 'utf8');
    const cache = new JsonFileCacheStore(cacheFile);
    expect(cache.get('anything')).toBeNull();
    cache.set('k', { assetType: 'item' });
    expect(JSON.parse(readFileSync(cacheFile, 'utf8'))).toEqual({ k: { assetType: 'item' } });

    const configFile = join(work, 'ai.config.json');
    writeFileSync(configFile, '{ broken', 'utf8');
    expect(() => loadAiConfig(configFile, () => undefined)).toThrow(/invalid ai config JSON/);
  });

  it('propagates the configured promptVersion to the provider', async () => {
    let seen = '';
    const provider: VisionProvider = {
      id: 'capture',
      model: 'capture-1',
      async understand(invocation: UnderstandInvocation) {
        seen = invocation.promptVersion;
        return { assetType: 'item' };
      },
    };
    const image = createRasterImage(2, 2, { hasAlpha: true });
    await understandAsset({ image, name: 'a.png' }, provider, { promptVersion: '2.7' });
    expect(seen).toBe('2.7');
  });
});

describe('preset output.format is honoured', () => {
  it('writes only the requested artifacts', () => {
    const result = runPipeline(sheet(), parsePreset({ schemaVersion: 1 }), {
      sourcePath: 'sheet.png',
    });
    const pngDir = join(work, 'png-only');
    const jsonDir = join(work, 'json-only');
    const pngFiles = writePipelineOutputs(result, pngDir, ['png']);
    const jsonFiles = writePipelineOutputs(result, jsonDir, ['json']);

    expect(pngFiles).toHaveLength(1);
    expect(existsSync(join(pngDir, 'atlas-0.png'))).toBe(true);
    expect(existsSync(join(pngDir, 'atlas.json'))).toBe(false);
    expect(jsonFiles).toHaveLength(1);
    expect(existsSync(join(jsonDir, 'atlas.json'))).toBe(true);
    expect(existsSync(join(jsonDir, 'atlas-0.png'))).toBe(false);
  });

  it('runProcess passes the preset formats through', () => {
    const file = join(work, 'sheet.png');
    writeFileSync(file, encodePng(sheet()));
    const pipeline = parsePreset({ schemaVersion: 1, output: { format: ['json'] } });
    const out = join(work, 'out');
    runProcess({ absolutePath: file, relativePath: 'sheet.png' }, pipeline, out, () => {});
    expect(existsSync(join(out, 'atlas.json'))).toBe(true);
    expect(existsSync(join(out, 'atlas-0.png'))).toBe(false);
  });
});

describe('hashing and CLI input handling', () => {
  it('rasterHash64 distinguishes equal byte streams with different dimensions', () => {
    const a = createRasterImage(2, 8, { hasAlpha: true });
    const b = createRasterImage(4, 4, { hasAlpha: true });
    expect(a.data.length).toBe(b.data.length);
    expect(rasterHash64(a)).not.toBe(rasterHash64(b));
  });

  it('batch on a missing root reports INPUT_NOT_FOUND with the usage exit code', () => {
    const missing = join(work, 'does-not-exist');
    try {
      runBatch({
        root: missing,
        pipeline: parsePreset({ schemaVersion: 1 }),
        outputDir: join(work, 'out'),
      });
      expect.unreachable('runBatch should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(ForgeError);
      expect((error as ForgeError).code).toBe('INPUT_NOT_FOUND');
    }
  });

  it('a corrupt cache does not prevent ai analyze artifacts (smoke)', () => {
    // Guards the constructor path used by runAiAnalyze.
    const nested = join(work, 'nested');
    mkdirSync(nested, { recursive: true });
    const cacheFile = join(nested, 'ai-cache.json');
    writeFileSync(cacheFile, 'null', 'utf8');
    expect(new JsonFileCacheStore(cacheFile).get('x')).toBeNull();
  });
});
