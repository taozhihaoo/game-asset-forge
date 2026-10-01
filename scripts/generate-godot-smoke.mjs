// Generates the Godot smoke-test assets via the built CLI (npm run sample:godot).
import { execFileSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { PNG } from 'pngjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const srcDir = join(root, 'samples', 'godot-smoke-src');
const outDir = join(root, 'samples', 'godot-smoke', 'assets');

rmSync(outDir, { recursive: true, force: true });
mkdirSync(srcDir, { recursive: true });

// 24x8 sheet with two 4x4 sprites
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
writeFileSync(join(srcDir, 'player.png'), PNG.sync.write(png));
writeFileSync(
  join(srcDir, 'preset.json'),
  `${JSON.stringify({ schemaVersion: 1, output: { godot: { enabled: true } } }, null, 2)}\n`,
);

execFileSync(
  process.execPath,
  [
    join(root, 'packages', 'cli', 'dist', 'main.js'),
    'process',
    join('samples', 'godot-smoke-src', 'player.png'),
    '-p',
    join('samples', 'godot-smoke-src', 'preset.json'),
    '-o',
    join('samples', 'godot-smoke', 'assets'),
  ],
  { cwd: root, stdio: 'inherit' },
);

console.log('godot smoke assets generated in samples/godot-smoke/assets');
