import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  analyze,
  createRasterImage,
  DEFAULT_QUALITY_CONFIG,
  runPipeline,
  setPixel,
  type AssetFile,
  type Pixel,
  type RasterImage,
} from '@gameasset-forge/core';
import { buildFixtures } from './fixtures.js';

/**
 * Golden tests (charter §23 C): each fixture runs through the full pipeline
 * and the result's manifest + skipped list are compared exactly against a
 * committed golden JSON. Goldens contain NO timestamps and NO pixel blobs —
 * they pin detection rects, trim results, pivots, placements, page extents,
 * and ordering. Regenerate deliberately with UPDATE_GOLDENS=1.
 */

const UPDATE = process.env.UPDATE_GOLDENS === '1';
const GOLDEN_DIR = fileURLToPath(new URL('./goldens/', import.meta.url));

interface GoldenData {
  readonly manifest: unknown;
  readonly skipped: unknown;
}

const fixtures = buildFixtures();

describe('golden fixtures', () => {
  for (const fixture of fixtures) {
    it(`golden: ${fixture.name}`, () => {
      const result = runPipeline(fixture.image, fixture.pipeline, {
        sourcePath: fixture.sourcePath,
      });
      const data: GoldenData = { manifest: result.manifest, skipped: result.skipped };
      const file = `${GOLDEN_DIR}${fixture.name}.json`;

      if (UPDATE || !existsSync(file)) {
        mkdirSync(GOLDEN_DIR, { recursive: true });
        writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
      }
      const golden = JSON.parse(readFileSync(file, 'utf8')) as GoldenData;
      expect(data).toEqual(golden);
    });
  }

  it('golden dir matches the expected list exactly (no stale, none missing)', () => {
    mkdirSync(GOLDEN_DIR, { recursive: true });
    const expected = new Set<string>([
      ...fixtures.map((f) => `${f.name}.json`),
      'quality-report.json',
    ]);
    const actual = new Set(readdirSync(GOLDEN_DIR).filter((f) => f.endsWith('.json')));
    for (const file of actual) expect(expected.has(file), `stale golden: ${file}`).toBe(true);
    for (const file of expected) expect(actual.has(file), `missing golden: ${file}`).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Quality report golden (V2): one deterministic synthetic set touching all
// five rules; the analyzer output is pinned exactly.
// ---------------------------------------------------------------------------

function solidRaster(width: number, height: number, color: Pixel): RasterImage {
  const image = createRasterImage(width, height, { hasAlpha: true });
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) setPixel(image, x, y, color);
  }
  return image;
}

const RED: Pixel = [255, 0, 0, 255];
const GREEN: Pixel = [0, 255, 0, 255];
const BLUE: Pixel = [0, 0, 255, 255];
const GRAY: Pixel = [90, 90, 90, 255];
const CLEAR: Pixel = [0, 0, 0, 0];

function qualityFixture(): readonly AssetFile[] {
  // faint.png: 10x10 canvas, only a 4x4 region has pixels → ratio 0.84
  const faint = createRasterImage(10, 10, { hasAlpha: true });
  for (let y = 0; y < 10; y++) {
    for (let x = 0; x < 10; x++) setPixel(faint, x, y, CLEAR);
  }
  for (let y = 3; y < 7; y++) {
    for (let x = 3; x < 7; x++) setPixel(faint, x, y, GREEN);
  }

  return [
    // naming_convention (low): default junk pattern ^img[ _-]?\d+$
    { name: 'IMG_003.png', raster: solidRaster(8, 8, RED), byteSize: 300 },
    // pivot_check (medium): character pattern matches, pivot deviates from feet
    { name: 'hero.png', raster: solidRaster(16, 16, GREEN), pivot: { x: 0.5, y: 0.5 } },
    // clean keeper of the duplicate group
    { name: 'hero_idle_01.png', raster: solidRaster(8, 8, BLUE) },
    // duplicate_frames (high): byte-identical to hero_idle_01
    {
      name: 'hero_idle_01_copy.png',
      raster: solidRaster(8, 8, BLUE),
      byteSize: 512,
    },
    // transparent_area (medium): 84% fully transparent
    { name: 'faint.png', raster: faint },
    // size_mismatch (high): deviant frame inside the walk group
    { name: 'walk_01.png', raster: solidRaster(32, 32, GRAY) },
    { name: 'walk_02.png', raster: solidRaster(32, 32, GRAY) },
    { name: 'walk_03.png', raster: solidRaster(64, 64, GRAY) },
  ];
}

const qualityConfig = { ...DEFAULT_QUALITY_CONFIG, characterPatterns: ['^hero'] };

describe('quality report golden', () => {
  it('golden: quality-report', () => {
    const report = analyze(qualityFixture(), qualityConfig);
    const data = { report };
    const file = `${GOLDEN_DIR}quality-report.json`;

    if (UPDATE || !existsSync(file)) {
      mkdirSync(GOLDEN_DIR, { recursive: true });
      writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
    }
    const golden = JSON.parse(readFileSync(file, 'utf8'));
    expect(data).toEqual(golden);
  });
});
