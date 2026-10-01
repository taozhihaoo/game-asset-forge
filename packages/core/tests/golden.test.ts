import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { runPipeline } from '../src/pipeline.js';
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

  it('golden dir matches the fixture list exactly (no stale, none missing)', () => {
    mkdirSync(GOLDEN_DIR, { recursive: true });
    const expected = new Set(fixtures.map((f) => `${f.name}.json`));
    const actual = new Set(readdirSync(GOLDEN_DIR).filter((f) => f.endsWith('.json')));
    for (const file of actual) expect(expected.has(file), `stale golden: ${file}`).toBe(true);
    for (const file of expected) expect(actual.has(file), `missing golden: ${file}`).toBe(true);
  });
});
