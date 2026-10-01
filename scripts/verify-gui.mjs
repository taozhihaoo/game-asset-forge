// GUI interactive verification (prerequisite 0.2, charter honesty: real app,
// real window, real drag-and-drop — assertions on the live DOM, not mocks).
//
// Launches the built Electron app via playwright-core, drops a synthetic
// sprite sheet onto the window, asserts the preview pipeline ran (asset
// entry + sprite count + properties panel), switches to the atlas view,
// and saves a screenshot to temp/gui-verification.png.
//
// Usage: node scripts/verify-gui.mjs   (run `npm run build` first)

import { _electron } from 'playwright-core';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { PNG } from 'pngjs';

const root = process.cwd();
const electronExe = join(root, 'node_modules', 'electron', 'dist', 'electron.exe');

function makeSheet() {
  const png = new PNG({ width: 24, height: 8 });
  for (let y = 2; y < 6; y++) {
    for (let x = 2; x < 6; x++) {
      const i = (y * 24 + x) * 4;
      png.data[i] = 255;
      png.data[i + 3] = 255;
    }
  }
  for (let y = 2; y < 6; y++) {
    for (let x = 14; x < 18; x++) {
      const i = (y * 24 + x) * 4;
      png.data[i + 1] = 255;
      png.data[i + 3] = 255;
    }
  }
  return PNG.sync.write(png);
}

function fail(message) {
  console.error('GUI_E2E_FAIL:', message);
  process.exit(1);
}

const app = await _electron.launch({
  executablePath: electronExe,
  args: [join(root, 'packages/gui'), '--disable-gpu'],
});
const failures = [];

try {
  const win = await app.firstWindow();
  await win.waitForSelector('#assets-list', { timeout: 20000 });

  const bytes = Array.from(makeSheet());
  await win.evaluate((data) => {
    const file = new File([new Uint8Array(data)], 'demo_sheet.png', { type: 'image/png' });
    const transfer = new DataTransfer();
    transfer.items.add(file);
    document.dispatchEvent(
      new DragEvent('drop', { dataTransfer: transfer, bubbles: true, cancelable: true }),
    );
  }, bytes);

  await win.waitForFunction(
    () => (document.querySelector('#assets-list')?.textContent ?? '').includes('2 sprites'),
    undefined,
    { timeout: 20000 },
  );
  const assetsText = await win.textContent('#assets-list');
  if (!assetsText.includes('demo_sheet.png')) failures.push(`asset name missing: ${assetsText}`);
  if (!assetsText.includes('24x8')) failures.push('dimensions missing');

  const props = await win.textContent('#properties-body');
  for (const expected of ['Detection', 'Trim', 'Resize', 'Margins', 'Pivot', 'Atlas', 'Export']) {
    if (!props.includes(expected)) failures.push(`properties section missing: ${expected}`);
  }

  const overlayInfo = await win.evaluate(() => {
    const canvas = document.querySelector('#canvas-host canvas');
    return canvas ? { w: canvas.width, h: canvas.height } : null;
  });
  if (overlayInfo === null) failures.push('pixi canvas missing');

  await win.selectOption('#view-select', 'atlas');
  await win.waitForTimeout(300);

  // quality page (V2): tab switch runs the analysis and renders warnings
  await win.click('#tab-quality');
  await win.waitForFunction(
    () => (document.querySelector('#quality-summary')?.textContent ?? '').includes('asset(s)'),
    undefined,
    { timeout: 20000 },
  );
  const qualityText = await win.textContent('#quality-list');
  if (!qualityText.includes('demo_sheet.png')) failures.push('quality list missing asset');
  await win.screenshot({ path: join(root, 'temp', 'gui-quality-verification.png') });
  await win.click('#tab-pipeline');
  await win.waitForTimeout(200);

  const log = await win.textContent('#log');
  if (!log.includes('loaded demo_sheet.png')) failures.push('log missing load line');

  mkdirSync('temp', { recursive: true });
  await win.screenshot({ path: join(root, 'temp', 'gui-verification.png') });
} catch (error) {
  fail(error instanceof Error ? `${error.message}\n${error.stack ?? ''}` : String(error));
}

await app.close();

if (failures.length > 0) {
  for (const f of failures) console.error('GUI_E2E_FAIL:', f);
  process.exit(1);
}
console.log('GUI_E2E_PASS screenshot=temp/gui-verification.png');
