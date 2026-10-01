import { describe, expect, it } from 'vitest';
import {
  DEFAULT_PIPELINE,
  CURRENT_PRESET_SCHEMA_VERSION,
  migratePreset,
  normalizePreset,
  parsePreset,
  serializePreset,
  validatePreset,
} from '../src/preset.js';
import { InvalidPresetError } from '../src/errors.js';

function problemsOf(raw: unknown): { path: string; code: string }[] {
  try {
    validatePreset(raw);
  } catch (e) {
    expect(e).toBeInstanceOf(InvalidPresetError);
    return (e as InvalidPresetError).problems.map((p) => ({ path: p.path, code: p.code }));
  }
  throw new Error('expected validatePreset to throw');
}

describe('validatePreset', () => {
  it('accepts a minimal preset with only schemaVersion', () => {
    const preset = validatePreset({ schemaVersion: 1 });
    expect(preset.schemaVersion).toBe(1);
  });

  it('accepts a fully populated v1 preset', () => {
    validatePreset({
      schemaVersion: 1,
      input: { format: 'png', recursive: false, include: ['a/**/*.png'], exclude: ['tmp/**'] },
      detect: {
        mode: 'alpha-connected-components',
        alphaThreshold: 16,
        minPixels: 9,
        connectivity: 4,
      },
      trim: { enabled: false, alphaThreshold: 32 },
      resize: { enabled: true, mode: 'scale', scale: 2, filter: 'linear' },
      padding: { pixels: 4 },
      bleed: { pixels: 1 },
      pivot: { mode: 'manual', x: 0.25, y: 0.75 },
      atlas: { maxWidth: 1024, maxHeight: 512, algorithm: 'maxrects', spacing: 0 },
      output: { format: ['json'], godot: { enabled: true }, unity: { enabled: false } },
    });
  });

  it('rejects non-object presets', () => {
    expect(problemsOf(null)[0].code).toBe('PRESET_MALFORMED');
    expect(problemsOf([1, 2])[0].code).toBe('PRESET_MALFORMED');
    expect(problemsOf('preset')[0].code).toBe('PRESET_MALFORMED');
  });

  it('rejects malformed and unsupported schemaVersions', () => {
    const malformed = problemsOf({});
    expect(malformed[0]).toEqual({ path: 'schemaVersion', code: 'PRESET_MALFORMED' });

    expect(problemsOf({ schemaVersion: '1' })[0].code).toBe('PRESET_MALFORMED');
    expect(problemsOf({ schemaVersion: 1.5 })[0].code).toBe('PRESET_MALFORMED');
    expect(problemsOf({ schemaVersion: 0 })[0].code).toBe('PRESET_MALFORMED');

    const unsupported = problemsOf({ schemaVersion: CURRENT_PRESET_SCHEMA_VERSION + 1 });
    expect(unsupported[0].code).toBe('PRESET_SCHEMA_VERSION_UNSUPPORTED');
  });

  it('rejects unknown keys at any level (typos must fail loudly)', () => {
    expect(problemsOf({ schemaVersion: 1, unknownTop: 1 })[0].path).toBe('$.unknownTop');
    expect(problemsOf({ schemaVersion: 1, atlas: { algoritm: 'maxrects' } })[0].path).toBe(
      'atlas.algoritm',
    );
  });

  it('rejects invalid detect sections', () => {
    expect(problemsOf({ schemaVersion: 1, detect: { mode: 'magic' } })[0].path).toBe('detect.mode');
    expect(problemsOf({ schemaVersion: 1, detect: { mode: 'grid' } })[0].path).toBe('detect');
    expect(
      problemsOf({
        schemaVersion: 1,
        detect: { mode: 'grid', rows: 2, columns: 2, cellWidth: 8 },
      })[0].path,
    ).toBe('detect');
    expect(problemsOf({ schemaVersion: 1, detect: { mode: 'manual' } })[0].path).toBe(
      'detect.rects',
    );
    expect(
      problemsOf({
        schemaVersion: 1,
        detect: { mode: 'manual', rects: [{ x: 0, y: 0, width: 0, height: 5 }] },
      })[0].path,
    ).toBe('detect.rects[0].width');
  });

  it('rejects out-of-range numeric values with precise paths', () => {
    expect(
      problemsOf({
        schemaVersion: 1,
        detect: { mode: 'alpha-connected-components', alphaThreshold: 256 },
      })[0].path,
    ).toBe('detect.alphaThreshold');
    expect(
      problemsOf({
        schemaVersion: 1,
        detect: { mode: 'alpha-connected-components', alphaThreshold: -1 },
      })[0].path,
    ).toBe('detect.alphaThreshold');
    expect(
      problemsOf({
        schemaVersion: 1,
        detect: { mode: 'alpha-connected-components', connectivity: 5 },
      })[0].path,
    ).toBe('detect.connectivity');
    expect(problemsOf({ schemaVersion: 1, atlas: { spacing: 129 } })[0].path).toBe('atlas.spacing');
    expect(problemsOf({ schemaVersion: 1, resize: { scale: 0 } })[0].path).toBe('resize.scale');
    expect(problemsOf({ schemaVersion: 1, pivot: { mode: 'manual' } }).map((p) => p.path)).toEqual([
      'pivot.x',
      'pivot.y',
    ]);
    expect(problemsOf({ schemaVersion: 1, padding: { pixels: 65 } })[0].path).toBe(
      'padding.pixels',
    );
  });

  it('rejects duplicate and unknown output formats', () => {
    expect(problemsOf({ schemaVersion: 1, output: { format: ['png', 'png'] } })[0].path).toBe(
      'output.format',
    );
    expect(problemsOf({ schemaVersion: 1, output: { format: ['webp'] } })[0].path).toBe(
      'output.format[0]',
    );
  });

  it('collects multiple problems in one error, in schema order', () => {
    try {
      validatePreset({ schemaVersion: 99, atlas: { spacing: -1 }, bleed: { pixels: 1.5 } });
      throw new Error('expected throw');
    } catch (e) {
      const err = e as InvalidPresetError;
      expect(err).toBeInstanceOf(InvalidPresetError);
      expect(err.problems.map((p) => p.path)).toEqual([
        'schemaVersion',
        'bleed.pixels',
        'atlas.spacing',
      ]);
      expect(err.stage).toBe('preset');
      expect(err.code).toBe('PRESET_SCHEMA_VERSION_UNSUPPORTED');
    }
  });
});

describe('migratePreset', () => {
  it('returns v1 presets unchanged (identity migration)', () => {
    const preset = { schemaVersion: 1, padding: { pixels: 4 } };
    expect(migratePreset(validatePreset(preset))).toEqual(preset);
  });

  it('refuses to migrate from a future version', () => {
    const future = { schemaVersion: CURRENT_PRESET_SCHEMA_VERSION + 1 } as never;
    expect(() => migratePreset(future)).toThrowError(InvalidPresetError);
  });
});

describe('normalizePreset', () => {
  it('fills all defaults for an empty preset', () => {
    const pipeline = normalizePreset({ schemaVersion: 1 });
    expect(pipeline).toEqual(DEFAULT_PIPELINE);
    expect(pipeline.detect.mode).toBe('alpha-connected-components');
    expect(pipeline.trim.alphaThreshold).toBe(8);
  });

  it('defaults trim.alphaThreshold to the RESOLVED detect threshold, not the global default', () => {
    const pipeline = normalizePreset({
      schemaVersion: 1,
      detect: { mode: 'alpha-connected-components', alphaThreshold: 100 },
    });
    expect(pipeline.detect).toMatchObject({
      mode: 'alpha-connected-components',
      alphaThreshold: 100,
    });
    expect(pipeline.trim.alphaThreshold).toBe(100);
  });

  it('keeps an explicit trim.alphaThreshold independent of detect', () => {
    const pipeline = normalizePreset({
      schemaVersion: 1,
      detect: { mode: 'alpha-connected-components', alphaThreshold: 100 },
      trim: { alphaThreshold: 10 },
    });
    expect(pipeline.trim.alphaThreshold).toBe(10);
  });

  it('does not mutate the preset it normalizes', () => {
    const preset = Object.freeze({
      schemaVersion: 1,
      detect: Object.freeze({ mode: 'grid', rows: 2, columns: 2 }),
    });
    expect(() => normalizePreset(preset)).not.toThrow();
    expect(preset.detect).toEqual({ mode: 'grid', rows: 2, columns: 2 });
  });

  it('keeps manual rects and manual pivots', () => {
    const pipeline = parsePreset({
      schemaVersion: 1,
      detect: { mode: 'manual', rects: [{ x: 1, y: 2, width: 3, height: 4, id: 'sword' }] },
      pivot: { mode: 'manual', x: 0.5, y: 0.5 },
    });
    expect(pipeline.detect).toEqual({
      mode: 'manual',
      rects: [{ x: 1, y: 2, width: 3, height: 4, id: 'sword' }],
    });
    expect(pipeline.pivot).toEqual({ mode: 'manual', x: 0.5, y: 0.5 });
  });
});

describe('serializePreset', () => {
  it('emits schemaVersion as the first top-level key', () => {
    const json = serializePreset(DEFAULT_PIPELINE);
    const keys = Object.keys(JSON.parse(json));
    expect(keys[0]).toBe('schemaVersion');
  });

  it('roundtrips: parse(serialize(parse(raw))) is stable', () => {
    const raw = {
      schemaVersion: 1,
      detect: { mode: 'alpha-connected-components', alphaThreshold: 32 },
      atlas: { maxWidth: 512 },
    };
    const once = parsePreset(raw);
    const twice = parsePreset(JSON.parse(serializePreset(once)));
    expect(twice).toEqual(once);
  });

  it('output ends with a newline and is pretty-printed', () => {
    const json = serializePreset(DEFAULT_PIPELINE);
    expect(json.endsWith('\n')).toBe(true);
    expect(json).toContain('\n  "input"');
  });
});

describe('DEFAULT_PIPELINE', () => {
  it('is deeply frozen', () => {
    expect(Object.isFrozen(DEFAULT_PIPELINE)).toBe(true);
    expect(Object.isFrozen(DEFAULT_PIPELINE.input)).toBe(true);
    expect(Object.isFrozen(DEFAULT_PIPELINE.output.godot)).toBe(true);
  });

  it('re-validates as a preset (serializer output is a valid input)', () => {
    expect(() => validatePreset(JSON.parse(serializePreset(DEFAULT_PIPELINE)))).not.toThrow();
  });
});
