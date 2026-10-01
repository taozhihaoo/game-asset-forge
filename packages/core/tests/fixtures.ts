import {
  createRasterImage,
  parsePreset,
  setPixel,
  type Pixel,
  type Pipeline,
  type RasterImage,
} from '../src/index.js';

/**
 * Synthetic deterministic fixtures for golden tests (charter §23 C).
 * No external assets — everything is generated in code with a seeded PRNG,
 * so fixtures are reproducible forever and CI-safe.
 */

/** mulberry32 — tiny seeded PRNG, deterministic across environments. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface Fixture {
  readonly name: string;
  readonly image: RasterImage;
  readonly pipeline: Pipeline;
  readonly sourcePath: string;
}

function sheet(
  width: number,
  height: number,
): { image: RasterImage; put: (x: number, y: number, p: Pixel) => void } {
  const image = createRasterImage(width, height, { hasAlpha: true });
  return { image, put: (x, y, p) => setPixel(image, x, y, p) };
}

function blob(
  target: { put: (x: number, y: number, p: Pixel) => void },
  x: number,
  y: number,
  w: number,
  h: number,
  color: Pixel,
): void {
  for (let dy = 0; dy < h; dy++) for (let dx = 0; dx < w; dx++) target.put(x + dx, y + dy, color);
}

function px(r: number, g: number, b: number, a = 255): Pixel {
  return [r, g, b, a];
}

export function buildFixtures(): Fixture[] {
  // 1. simple: uniform 2x2 grid of solid sprites
  const simple = sheet(64, 64);
  for (const [ox, oy, c] of [
    [2, 2, px(200, 10, 10)],
    [34, 2, px(10, 200, 10)],
    [2, 34, px(10, 10, 200)],
    [34, 34, px(200, 200, 10)],
  ] as const) {
    blob(simple, ox, oy, 28, 28, c);
  }

  // 2. irregular: three sprites, different sizes and alignment
  const irregular = sheet(100, 80);
  blob(irregular, 2, 2, 20, 30, px(180, 60, 60));
  blob(irregular, 40, 3, 40, 10, px(60, 180, 60));
  blob(irregular, 60, 50, 12, 12, px(60, 60, 180));

  // 3. noisy: two sprites + faint transparent borders + specks below minPixels
  const noisy = sheet(80, 60);
  const rand = mulberry32(20261002);
  blob(noisy, 3, 3, 15, 15, px(150, 150, 30));
  blob(noisy, 40, 20, 22, 25, px(30, 150, 150));
  // faint ring (alpha 3) around sprite 1 — below the alpha threshold 8
  for (let x = 1; x <= 19; x++) {
    noisy.put(x, 1, px(255, 255, 255, 3));
    noisy.put(x, 21, px(255, 255, 255, 3));
  }
  // random specks: 1-2 px, alpha 255 — removed by minPixels 4
  for (let i = 0; i < 12; i++) {
    const x = Math.floor(rand() * 80);
    const y = Math.floor(rand() * 60);
    noisy.put(x, y, px(255, 0, 255, 255));
    if (rand() > 0.5) noisy.put(Math.min(79, x + 1), y, px(255, 0, 255, 255));
  }

  // 4. multi-page: 4 sprites of 16x16 forced onto 32x16 pages (2 per page)
  const multiPage = sheet(80, 20);
  for (const [ox, c] of [
    [2, px(120, 0, 0)],
    [22, px(0, 120, 0)],
    [42, px(0, 0, 120)],
    [62, px(120, 120, 0)],
  ] as const) {
    blob(multiPage, ox, 2, 16, 16, c);
  }

  // 5. resize: one gradient sprite, scaled 2x nearest
  const resize = sheet(16, 16);
  for (let y = 2; y < 10; y++) {
    for (let x = 2; x < 10; x++) {
      resize.put(x, y, px(x * 28, y * 28, 90));
    }
  }

  // 6. bleed: two sprites with transparent interior gaps (edge extrusion visible)
  const bleed = sheet(40, 24);
  blob(bleed, 1, 1, 10, 10, px(255, 128, 0));
  blob(bleed, 20, 8, 12, 12, px(0, 128, 255));

  // 7. manual: explicit rects incl. ids and one empty region (skip path)
  const manual = sheet(48, 16);
  blob(manual, 1, 1, 8, 8, px(90, 90, 90));
  blob(manual, 30, 4, 10, 10, px(180, 90, 0));

  return [
    {
      name: '01-simple-grid',
      image: simple.image,
      pipeline: parsePreset({ schemaVersion: 1, padding: { pixels: 1 }, bleed: { pixels: 1 } }),
      sourcePath: 'fixtures/01-simple-grid.png',
    },
    {
      name: '02-irregular',
      image: irregular.image,
      pipeline: parsePreset({ schemaVersion: 1, padding: { pixels: 0 }, bleed: { pixels: 0 } }),
      sourcePath: 'fixtures/02-irregular.png',
    },
    {
      name: '03-noisy',
      image: noisy.image,
      pipeline: parsePreset({
        schemaVersion: 1,
        detect: { mode: 'alpha-connected-components', alphaThreshold: 8, minPixels: 4 },
        padding: { pixels: 2 },
        bleed: { pixels: 2 },
      }),
      sourcePath: 'fixtures/03-noisy.png',
    },
    {
      name: '04-multi-page',
      image: multiPage.image,
      pipeline: parsePreset({
        schemaVersion: 1,
        atlas: { maxWidth: 32, maxHeight: 16, spacing: 0 },
        padding: { pixels: 0 },
        bleed: { pixels: 0 },
      }),
      sourcePath: 'fixtures/04-multi-page.png',
    },
    {
      name: '05-resize',
      image: resize.image,
      pipeline: parsePreset({
        schemaVersion: 1,
        resize: { enabled: true, scale: 2, filter: 'nearest' },
        padding: { pixels: 0 },
        bleed: { pixels: 0 },
      }),
      sourcePath: 'fixtures/05-resize.png',
    },
    {
      name: '06-bleed',
      image: bleed.image,
      pipeline: parsePreset({ schemaVersion: 1, padding: { pixels: 1 }, bleed: { pixels: 2 } }),
      sourcePath: 'fixtures/06-bleed.png',
    },
    {
      name: '07-manual',
      image: manual.image,
      pipeline: parsePreset({
        schemaVersion: 1,
        detect: {
          mode: 'manual',
          rects: [
            { x: 0, y: 0, width: 10, height: 10, id: 'hero' },
            { x: 14, y: 0, width: 8, height: 8 }, // empty region → skipped
            { x: 28, y: 0, width: 16, height: 16, id: 'emblem' },
          ],
        },
        padding: { pixels: 1 },
        bleed: { pixels: 1 },
      }),
      sourcePath: 'fixtures/07-manual.png',
    },
  ];
}
