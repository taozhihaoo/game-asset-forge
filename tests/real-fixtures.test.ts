import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parsePreset, runPipeline } from '@gameasset-forge/core';
import { decodePng, readPngInfo } from '../packages/cli/src/png.js';
import { writeFileSync } from 'node:fs';

/**
 * Real-world fixture validation (charter §24, DoD [15]).
 *
 * Runs the full pipeline over actual game sprite sheets stored in
 * `fixtures-local/` (gitignored; provenance in samples/README.md). Skips
 * entirely when the directory is absent — CI uses synthetic fixtures only.
 *
 * Run with GAF_WRITE_REAL_RESULTS=1 to (re)write docs/phase-5-real-results.json
 * (counts and dimensions only — never image bytes).
 */

const REAL_DIR = fileURLToPath(new URL('../fixtures-local/', import.meta.url));
const RESULTS_FILE = fileURLToPath(new URL('../docs/phase-5-real-results.json', import.meta.url));
const HAS_FIXTURES = existsSync(REAL_DIR);

/**
 * Preset per sheet family:
 * - Buch 16x16 sheets are strict grids → grid mode with cell size from the
 *   documented convention.
 * - Kenney sheets: packed/irregular → alpha-CC.
 */
function presetFor(fileName: string): Record<string, unknown> {
  if (fileName.startsWith('characters_7')) {
    return { schemaVersion: 1, detect: { mode: 'grid', cellWidth: 32, cellHeight: 32 } };
  }
  return { schemaVersion: 1 };
}

describe.skipIf(!HAS_FIXTURES)('real-world fixtures', () => {
  const files = readdirSync(REAL_DIR)
    .filter((f) => /\.png$/i.test(f))
    .sort();

  it('found at least 3 real sprite sheets', () => {
    expect(files.length).toBeGreaterThanOrEqual(3);
  });

  const results: unknown[] = [];

  for (const file of files) {
    it(`processes real fixture: ${file}`, () => {
      const absolutePath = join(REAL_DIR, file);
      const buffer = readFileSync(absolutePath);
      const info = readPngInfo(buffer, file);
      expect(info.width).toBeGreaterThan(0);
      expect(info.height).toBeGreaterThan(0);

      const image = decodePng(buffer, file);
      const pipeline = parsePreset(presetFor(file));
      const first = runPipeline(image, pipeline, { sourcePath: `fixtures-local/${file}` });
      const second = runPipeline(image, pipeline, { sourcePath: `fixtures-local/${file}` });

      // determinism on real pixels (DoD [1][3]): identical manifests
      expect(second.manifest).toEqual(first.manifest);

      // alpha-CC sheets must find their content; a zero-detection run would
      // have thrown NoSpritesFoundError, so reaching here means ≥1 sprite
      expect(first.sprites.length).toBeGreaterThan(0);
      expect(first.atlas.pages.length).toBeGreaterThan(0);

      // page extents sane
      for (const page of first.atlas.pages) {
        expect(page.width).toBeLessThanOrEqual(pipeline.atlas.maxWidth);
        expect(page.height).toBeLessThanOrEqual(pipeline.atlas.maxHeight);
        expect(page.placements.length).toBeGreaterThan(0);
      }

      results.push({
        file,
        width: info.width,
        height: info.height,
        hasAlpha: info.hasAlpha,
        colorType: info.colorType,
        detectMode: pipeline.detect.mode,
        sprites: first.sprites.length,
        skipped: first.skipped.length,
        pages: first.atlas.pages.length,
        pageSize: first.atlas.pages.map((p) => `${p.width}x${p.height}`),
      });
    });
  }

  it('writes the real-results summary when GAF_WRITE_REAL_RESULTS=1', () => {
    if (process.env.GAF_WRITE_REAL_RESULTS === '1') {
      writeFileSync(
        `${RESULTS_FILE}`,
        `${JSON.stringify({ fixtures: results }, null, 2)}\n`,
        'utf8',
      );
    }
    expect(results).toHaveLength(files.length);
  });
});
