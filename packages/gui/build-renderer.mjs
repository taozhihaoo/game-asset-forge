// Bundles the renderer (browser) with esbuild and copies static assets.
// esbuild is justified per charter §32: bare-module resolution for pixi.js in
// the renderer is a real problem; the bundle is a plain IIFE loaded as a
// classic script (Electron preload must stay CJS, package is CJS).
import { build } from 'esbuild';
import { copyFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const pkgRoot = fileURLToPath(new URL('.', import.meta.url));
const outDir = join(pkgRoot, 'dist-gui');

mkdirSync(outDir, { recursive: true });

await build({
  entryPoints: [join(pkgRoot, 'src/renderer/app.ts')],
  bundle: true,
  outfile: join(outDir, 'renderer.js'),
  platform: 'browser',
  format: 'iife',
  target: 'chrome120',
  logLevel: 'warning',
});

copyFileSync(join(pkgRoot, 'src/renderer/index.html'), join(outDir, 'index.html'));
copyFileSync(join(pkgRoot, 'src/renderer/styles.css'), join(outDir, 'styles.css'));
console.log('renderer bundled -> dist-gui/renderer.js');
