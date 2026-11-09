// Captures the README screenshots from the REAL built renderer (no mocks of
// the UI): launches a local Chromium/Edge with playwright-core, loads
// dist-gui/index.html, injects a synthetic sprite sheet through a real
// drag-and-drop event, and screenshots the Pipeline (before/after) and
// Quality pages in English and Simplified Chinese.
//
// Usage:
//   npm run build && node scripts/capture-screenshots.mjs          # write docs/screenshots/*.png
//   npm run build && node scripts/capture-screenshots.mjs --check  # CI: assert the UI, write nothing
//
// Override the browser with CHROME_PATH=/path/to/browser.
// In CI install the browser first: npx playwright-core install chromium

import { chromium } from 'playwright-core';
import { mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const outDir = join(root, 'docs', 'screenshots');
const indexHtml = fileURLToPath(new URL('../packages/gui/dist-gui/index.html', import.meta.url));
const checkOnly = process.argv.includes('--check');
if (!checkOnly) mkdirSync(outDir, { recursive: true });

const browserCandidates = [
  process.env.CHROME_PATH,
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
  chromium.executablePath(),
].filter(Boolean);

const executablePath = browserCandidates.find((candidate) => existsSync(candidate));
if (executablePath === undefined) {
  throw new Error('No local Chromium/Edge/Chrome found. Set CHROME_PATH to a browser binary.');
}

/** A 4-sprite transparent sheet with distinct colours and a highlight. */
function makeSheet() {
  const width = 128;
  const height = 64;
  const png = new PNG({ width, height });
  png.data.fill(0);
  const palette = [
    [255, 106, 106],
    [96, 190, 255],
    [255, 199, 89],
    [139, 233, 158],
  ];
  const put = (x, y, color) => {
    if (x < 0 || y < 0 || x >= width || y >= height) return;
    const i = (y * width + x) * 4;
    png.data[i] = color[0];
    png.data[i + 1] = color[1];
    png.data[i + 2] = color[2];
    png.data[i + 3] = 255;
  };
  palette.forEach((base, index) => {
    const ox = 5 + index * 31;
    const oy = 18;
    for (let y = 0; y < 28; y++) {
      for (let x = 0; x < 22; x++) {
        const dx = Math.abs(x - 10.5) / 10.5;
        const dy = Math.abs(y - 13.5) / 13.5;
        if (dx + dy > 1.12) continue;
        const shade = x < 9 && y < 12 ? 1.32 : y > 20 ? 0.72 : 1;
        put(
          ox + x,
          oy + y,
          base.map((c) => Math.min(255, Math.round(c * shade))),
        );
      }
    }
    put(ox + 7, oy + 11, [255, 255, 255]);
    put(ox + 14, oy + 11, [255, 255, 255]);
    put(ox + 7, oy + 12, [32, 38, 54]);
    put(ox + 14, oy + 12, [32, 38, 54]);
  });
  return PNG.sync.write(png);
}

const bridgeStub = () => {
  window.forge = {
    openPngFiles: async () => [],
    openPreset: async () => null,
    savePreset: async () => null,
    chooseOutputDir: async () => null,
    readFile: async () => new Uint8Array(),
    writeFile: async () => '',
  };
};

const bytes = Array.from(makeSheet());

const browser = await chromium.launch({
  executablePath,
  headless: true,
  args: [
    '--no-sandbox',
    '--disable-dev-shm-usage',
    '--enable-unsafe-swiftshader',
    '--use-gl=angle',
    '--use-angle=swiftshader',
    '--hide-scrollbars',
  ],
});

function assert(condition, message) {
  if (!condition) throw new Error(`ASSERT_FAILED: ${message} (got ${condition})`);
}

async function capture(lang, suffix) {
  const context = await browser.newContext({
    viewport: { width: 1600, height: 980 },
    deviceScaleFactor: 1,
  });
  await context.addInitScript(bridgeStub);
  const page = await context.newPage();
  const url = `file://${indexHtml.replace(/\\/g, '/')}?lang=${lang}`;
  await page.goto(url, { waitUntil: 'load' });
  await page.waitForSelector('#assets-list', { timeout: 20000 });

  // Language is applied to the document and to the static chrome.
  const htmlLang = await page.evaluate(() => document.documentElement.lang);
  assert(htmlLang === (lang === 'zh' ? 'zh-CN' : 'en'), `${lang} document lang`);
  const pipelineTab = await page.textContent('#tab-pipeline');
  assert(pipelineTab.includes(lang === 'zh' ? '流水线' : 'Pipeline'), `${lang} tab translation`);

  await page.evaluate((data) => {
    const file = new File([new Uint8Array(data)], 'hero_sheet.png', { type: 'image/png' });
    const transfer = new DataTransfer();
    transfer.items.add(file);
    document.dispatchEvent(
      new DragEvent('drop', { dataTransfer: transfer, bubbles: true, cancelable: true }),
    );
  }, bytes);

  // Wait until the debounced preview produced sprites and a composed atlas.
  await page.waitForFunction(
    () => {
      const meta = document.querySelector('#assets-list .asset-meta');
      const count = document.querySelector('#stat-sprites');
      return (
        meta !== null &&
        !meta.textContent.includes('…') &&
        count !== null &&
        Number(count.textContent) > 0
      );
    },
    undefined,
    { timeout: 25000 },
  );
  await page.waitForTimeout(900);

  assert(
    await page.evaluate(() => document.querySelector('#canvas-host canvas') !== null),
    `${lang} pixi canvas`,
  );
  const spriteCount = Number(await page.textContent('#stat-sprites'));
  assert(spriteCount === 4, `${lang} sprite count (got ${spriteCount})`);

  if (!checkOnly) await page.screenshot({ path: join(outDir, `gui-${suffix}.png`) });

  // "After (atlas)" view — proves the composed page pixels are rendered.
  await page.selectOption('#view-select', 'atlas');
  await page.waitForTimeout(700);
  const hudMode = await page.textContent('#canvas-mode');
  assert(hudMode === (lang === 'zh' ? '图集' : 'ATLAS'), `${lang} atlas HUD (got ${hudMode})`);
  if (!checkOnly) await page.screenshot({ path: join(outDir, `gui-atlas-${suffix}.png`) });
  await page.selectOption('#view-select', 'source');
  await page.waitForTimeout(200);

  await page.click('#tab-quality');
  await page.waitForFunction(
    () => (document.querySelector('#quality-list')?.textContent ?? '').includes('hero_sheet.png'),
    undefined,
    { timeout: 20000 },
  );
  assert(
    await page.evaluate(() => document.querySelector('.rules-card') !== null),
    `${lang} rules card`,
  );
  await page.waitForTimeout(300);
  if (!checkOnly) await page.screenshot({ path: join(outDir, `gui-quality-${suffix}.png`) });

  console.log(
    `[${lang}] ${checkOnly ? 'verified' : 'captured'} pipeline + atlas + quality (${suffix})`,
  );
  await context.close();
}

try {
  await capture('en', 'en');
  await capture('zh', 'zh');
  console.log(checkOnly ? 'RENDERER_SMOKE_PASS' : 'SCREENSHOTS_OK');
} finally {
  await browser.close();
}
