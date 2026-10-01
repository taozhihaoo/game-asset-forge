import { describe, expect, it } from 'vitest';
import {
  DEFAULT_QUALITY_CONFIG,
  analyze,
  dHash64,
  hammingDistance64,
  parseAssetName,
  rasterHash64,
  transparentRatio,
  type AssetFile,
  type Pixel,
  type QualityConfig,
  type RasterImage,
} from '../src/index.js';
import { createRasterImage, setPixel } from '../src/image.js';

function raster(w: number, h: number, fill: Pixel = [255, 255, 255, 255]): RasterImage {
  const image = createRasterImage(w, h, { hasAlpha: true });
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) setPixel(image, x, y, fill);
  }
  return image;
}

function asset(name: string, image: RasterImage, extra: Partial<AssetFile> = {}): AssetFile {
  return { name, raster: image, ...extra };
}

const TINY: Pixel = [10, 10, 10, 255];
const OTHER: Pixel = [200, 30, 30, 255];

describe('parseAssetName', () => {
  it('extracts group and frame index', () => {
    expect(parseAssetName('assets/hero_idle_01.png')).toEqual({
      stem: 'assets/hero_idle_01',
      group: 'assets/hero_idle',
      index: 1,
    });
  });

  it('handles dashes, missing index, and extensionless names', () => {
    expect(parseAssetName('hero-run-3.gif').group).toBe('hero-run');
    expect(parseAssetName('tree.png')).toEqual({ stem: 'tree', group: 'tree', index: null });
    expect(parseAssetName('slash/12.png').index).toBe(12);
  });
});

describe('naming_convention rule', () => {
  const config: QualityConfig = { ...DEFAULT_QUALITY_CONFIG };

  it('flags doc-style junk names via built-in defaults', () => {
    for (const name of ['IMG_001.png', 'final2.png', 'new.png', 'aaa.png', 'test.png']) {
      const issues = analyze([asset(name, raster(8, 8))], config).issues[0].warnings;
      expect(
        issues.some((w) => w.rule === 'naming_convention'),
        name,
      ).toBe(true);
    }
  });

  it('leaves descriptive names alone', () => {
    const issues = analyze([asset('hero_idle_01.png', raster(8, 8))], config).issues[0].warnings;
    expect(issues.some((w) => w.rule === 'naming_convention')).toBe(false);
  });

  it('supports custom patterns and explicit disable', () => {
    const custom: QualityConfig = {
      ...config,
      nonDescriptivePatterns: ['^temp_'],
    };
    expect(
      analyze([asset('temp_thing.png', raster(8, 8))], custom).issues[0].warnings,
    ).toHaveLength(1);
    const disabled: QualityConfig = { ...config, nonDescriptivePatterns: [] };
    const issues = analyze([asset('img_9.png', raster(8, 8))], disabled).issues[0].warnings;
    expect(issues.some((w) => w.rule === 'naming_convention')).toBe(false);
  });
});

function checker(w: number, h: number, invert = false): RasterImage {
  const image = createRasterImage(w, h, { hasAlpha: true });
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const bright = (Math.floor(x / 4) + Math.floor(y / 4)) % 2 === 0;
      const v = bright !== invert ? 240 : 10;
      setPixel(image, x, y, [v, v, v, 255]);
    }
  }
  return image;
}

describe('transparent_area rule', () => {
  it('flags canvases that are mostly fully transparent', () => {
    const image = raster(10, 10, [5, 5, 5, 255]);
    for (let y = 0; y < 3; y++) {
      for (let x = 0; x < 10; x++) setPixel(image, x, y, [0, 0, 0, 0]);
    }
    for (let y = 3; y < 10; y++) {
      for (let x = 7; x < 10; x++) setPixel(image, x, y, [0, 0, 0, 0]);
    }
    // 30 + 21 = 51/100 fully transparent → ratio 0.51 < 0.6 → no warning
    expect(analyze([asset('a.png', image)]).issues[0].warnings).toHaveLength(0);

    for (let y = 3; y < 10; y++) {
      for (let x = 5; x < 10; x++) setPixel(image, x, y, [0, 0, 0, 0]);
    }
    // 30 + 35 = 65% → warning fires above the 0.6 default
    const warnings = analyze([asset('a.png', image)]).issues[0].warnings;
    const warning = warnings.find((w) => w.rule === 'transparent_area');
    expect(warning?.severity).toBe('medium');
    expect(warning?.message).toContain('65%');
  });

  it('does not count semi-transparent edge pixels as unused', () => {
    const image = raster(4, 4, [1, 1, 1, 255]);
    setPixel(image, 0, 0, [0, 0, 0, 8]);
    expect(transparentRatio(image)).toBe(0);
  });

  it('respects maxTransparentRatio config', () => {
    const strict: QualityConfig = { ...DEFAULT_QUALITY_CONFIG, maxTransparentRatio: 0.1 };
    const image = raster(10, 10, [9, 9, 9, 255]);
    for (let x = 0; x < 5; x++) {
      for (let y = 0; y < 3; y++) setPixel(image, x, y, [0, 0, 0, 0]);
    }
    // 15/100 = 0.15 > 0.1
    const warnings = analyze([asset('a.png', image)], strict).issues[0].warnings;
    expect(warnings.some((w) => w.rule === 'transparent_area')).toBe(true);
  });
});

describe('duplicate_frames rule', () => {
  it('flags byte-identical rasters as exact duplicates with 100% similarity', () => {
    const a = asset('hero_idle_01.png', raster(8, 8, TINY), { byteSize: 4096 });
    const b = asset('hero_idle_copy.png', raster(8, 8, TINY), { byteSize: 4096 });
    const report = analyze([a, b]);
    const warnings = report.issues.find((i) => i.asset === 'hero_idle_copy.png')?.warnings ?? [];
    const dup = warnings.find((w) => w.rule === 'duplicate_frames');
    expect(dup?.severity).toBe('high');
    expect(dup?.message).toContain('hero_idle_01.png');
    expect(dup?.message).toContain('100%');
    expect(dup?.message).toContain('potential saving: ~4 KB');
    expect(report.issues.find((i) => i.asset === 'hero_idle_01.png')?.warnings ?? []).toHaveLength(
      0,
    );
  });

  it('flags near duplicates within the Hamming threshold', () => {
    const base = checker(16, 16);
    const near = checker(16, 16);
    setPixel(near, 8, 8, OTHER);
    const report = analyze([asset('a.png', base), asset('b.png', near)]);
    const dup = report.issues
      .find((i) => i.asset === 'b.png')
      ?.warnings.find((w) => w.rule === 'duplicate_frames');
    expect(dup?.severity).toBe('medium');
    expect(dup?.message).toContain('a.png');
  });

  it('ignores clearly different images', () => {
    const report = analyze([
      asset('a.png', checker(16, 16)),
      asset('b.png', checker(16, 16, true)),
    ]);
    for (const entry of report.issues) {
      expect(entry.warnings.some((w) => w.rule === 'duplicate_frames')).toBe(false);
    }
  });

  it('is order-independent about which asset is the keeper', () => {
    const a = asset('a.png', raster(8, 8, TINY));
    const b = asset('b.png', raster(8, 8, TINY));
    const report = analyze([a, b]);
    const flagged = report.issues.filter((i) =>
      i.warnings.some((w) => w.rule === 'duplicate_frames'),
    );
    expect(flagged).toHaveLength(1);
    expect(flagged[0].asset).toBe('b.png'); // sorted order: later name is the duplicate
  });
});

describe('dHash / hamming', () => {
  it('gives identical rasters zero distance and different rasters a large one', () => {
    const d1 = dHash64(checker(16, 16));
    expect(hammingDistance64(d1, d1)).toBe(0);
    const d2 = dHash64(checker(16, 16, true));
    expect(hammingDistance64(d1, d2)).toBeGreaterThan(5);
  });

  it('rasterHash64 is stable and content-sensitive', () => {
    expect(rasterHash64(raster(8, 8, TINY))).toBe(rasterHash64(raster(8, 8, TINY)));
    expect(rasterHash64(raster(8, 8, TINY))).not.toBe(rasterHash64(raster(8, 8, OTHER)));
  });
});

describe('size_mismatch rule', () => {
  it('flags deviants against the group majority size', () => {
    const assets = [
      asset('hero_walk_01.png', raster(128, 128)),
      asset('hero_walk_02.png', raster(128, 128)),
      asset('hero_walk_03.png', raster(256, 256)),
    ];
    const report = analyze(assets);
    const deviant = report.issues.find((i) => i.asset === 'hero_walk_03.png');
    const warning = deviant?.warnings.find((w) => w.rule === 'size_mismatch');
    expect(warning?.severity).toBe('high');
    expect(warning?.message).toContain('expected 128x128');
  });

  it('ignores singleton groups and consistent groups', () => {
    const assets = [
      asset('tree.png', raster(32, 32)),
      asset('hero_walk_01.png', raster(64, 64)),
      asset('hero_walk_02.png', raster(64, 64)),
    ];
    const report = analyze(assets);
    for (const entry of report.issues) {
      expect(entry.warnings.some((w) => w.rule === 'size_mismatch')).toBe(false);
    }
  });
});

describe('pivot_check rule', () => {
  const withCharacter = (config: QualityConfig): QualityConfig => ({
    ...config,
    characterPatterns: ['^hero$', '^knight'],
  });

  it('warns (medium) when a configured character pivot deviates from feet', () => {
    const knight = asset('knight.png', raster(8, 8), { pivot: { x: 0.5, y: 0.5 } });
    const report = analyze([knight], withCharacter(DEFAULT_QUALITY_CONFIG));
    const warning = report.issues[0].warnings.find((w) => w.rule === 'pivot_check');
    expect(warning?.severity).toBe('medium');
    expect(warning?.suggestion).toContain('(0.5, 1.0)');
  });

  it('stays silent when a configured character anchors at its feet', () => {
    const knight = asset('knight.png', raster(8, 8), { pivot: { x: 0.5, y: 1.0 } });
    const report = analyze([knight], withCharacter(DEFAULT_QUALITY_CONFIG));
    expect(report.issues[0].warnings.some((w) => w.rule === 'pivot_check')).toBe(false);
  });

  it('gives info when a configured character has no pivot metadata', () => {
    const report = analyze(
      [asset('hero.png', raster(8, 8))],
      withCharacter(DEFAULT_QUALITY_CONFIG),
    );
    const warning = report.issues[0].warnings.find((w) => w.rule === 'pivot_check');
    expect(warning?.severity).toBe('info');
  });

  it('demotes to info for non-configured sprites with deviating pivots', () => {
    const slime = asset('slime.png', raster(8, 8), { pivot: { x: 0.2, y: 0.2 } });
    const report = analyze([slime], DEFAULT_QUALITY_CONFIG);
    const warning = report.issues[0].warnings.find((w) => w.rule === 'pivot_check');
    expect(warning?.severity).toBe('info');
  });

  it('says nothing about pivots when none are injected', () => {
    const report = analyze([asset('slime.png', raster(8, 8))], DEFAULT_QUALITY_CONFIG);
    expect(report.issues[0].warnings.some((w) => w.rule === 'pivot_check')).toBe(false);
  });
});

describe('analyze (end-to-end)', () => {
  it('sorts assets by name and orders warnings by fixed rule order', () => {
    const assets = [
      asset('copy2.png', raster(8, 8, TINY), { byteSize: 2048 }),
      asset('aaa.png', raster(8, 8, TINY)),
    ];
    const report = analyze(assets);
    expect(report.issues.map((i) => i.asset)).toEqual(['aaa.png', 'copy2.png']);
    const copy2 = report.issues.find((i) => i.asset === 'copy2.png');
    expect(copy2?.warnings.map((w) => w.rule)).toEqual(['naming_convention', 'duplicate_frames']);
    const aaa = report.issues.find((i) => i.asset === 'aaa.png');
    expect(aaa?.warnings.map((w) => w.rule)).toEqual(['naming_convention']);
  });

  it('reports summary counts and version', () => {
    const report = analyze([
      asset('a.png', raster(4, 4, TINY)),
      asset('b.png', raster(4, 4, TINY)),
    ]);
    expect(report.version).toBe(2);
    expect(report.assets).toBe(2);
    expect(report.warnings).toBe(1);
    expect(report.issues).toHaveLength(2);
  });

  it('returns an empty report for no assets', () => {
    const report = analyze([]);
    expect(report).toEqual({ version: 2, assets: 0, warnings: 0, issues: [] });
  });

  it('is deterministic: double run deep-equals', () => {
    const build = (): AssetFile[] => [
      asset('knight.png', raster(16, 16, TINY), { pivot: { x: 0.5, y: 0.4 }, byteSize: 800 }),
      asset('IMG_004.png', raster(16, 16, [255, 0, 0, 255])),
      asset('knight_copy.png', raster(16, 16, TINY), { byteSize: 800 }),
      asset('hero_walk_03.png', raster(64, 64)),
      asset('hero_walk_01.png', raster(32, 32)),
      asset('hero_walk_02.png', raster(32, 32)),
    ];
    expect(analyze(build(), DEFAULT_QUALITY_CONFIG)).toEqual(
      analyze(build(), DEFAULT_QUALITY_CONFIG),
    );
  });

  it('does not mutate its inputs', () => {
    const input = Object.freeze([asset('a.png', raster(4, 4, TINY))]);
    expect(() => analyze(input, DEFAULT_QUALITY_CONFIG)).not.toThrow();
  });
});
