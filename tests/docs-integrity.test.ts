import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { dictionaries } from '../packages/gui/src/renderer/i18n.js';

/**
 * Release-asset integrity: the bilingual READMEs must point at real,
 * language-matched screenshots; the i18n dictionaries must stay in sync with
 * every key used by the renderer; and the security/license documents must
 * remain English-only. These checks run in CI on every push.
 */

const root = fileURLToPath(new URL('..', import.meta.url));
const read = (relative: string): string => readFileSync(join(root, relative), 'utf8');
const screenshotRefs = (text: string): string[] =>
  [...text.matchAll(/docs\/screenshots\/[\w-]+\.png/g)].map((match) => match[0]);

const enKeys = Object.keys(dictionaries.en).sort();

describe('bilingual documentation', () => {
  it('both README files exist and link to each other', () => {
    const en = read('README.md');
    const zh = read('README.zh-CN.md');
    expect(en).toContain('README.zh-CN.md');
    expect(zh).toContain('README.md');
    expect(en).toContain('English (default)');
    expect(zh).toContain('简体中文');
  });

  it('the English README only embeds English screenshots', () => {
    const refs = screenshotRefs(read('README.md'));
    expect(refs.length).toBeGreaterThanOrEqual(2);
    for (const ref of refs) {
      expect(ref.endsWith('-en.png'), ref).toBe(true);
      expect(existsSync(join(root, ref)), ref).toBe(true);
      expect(statSync(join(root, ref)).size, ref).toBeGreaterThan(10_000);
    }
  });

  it('the Chinese README only embeds Chinese screenshots', () => {
    const refs = screenshotRefs(read('README.zh-CN.md'));
    expect(refs.length).toBeGreaterThanOrEqual(2);
    for (const ref of refs) {
      expect(ref.endsWith('-zh.png'), ref).toBe(true);
      expect(existsSync(join(root, ref)), ref).toBe(true);
      expect(statSync(join(root, ref)).size, ref).toBeGreaterThan(10_000);
    }
  });

  it('each screenshot has both language variants', () => {
    for (const name of ['gui', 'gui-atlas', 'gui-quality']) {
      expect(existsSync(join(root, 'docs', 'screenshots', `${name}-en.png`))).toBe(true);
      expect(existsSync(join(root, 'docs', 'screenshots', `${name}-zh.png`))).toBe(true);
    }
  });
});

describe('i18n dictionaries', () => {
  it('English and Chinese expose exactly the same key set', () => {
    expect(Object.keys(dictionaries.zh).sort()).toEqual(enKeys);
    expect(enKeys.length).toBeGreaterThan(80);
  });

  it('every translation is a non-empty string', () => {
    for (const key of enKeys) {
      const typedKey = key as keyof typeof dictionaries.en;
      expect(dictionaries.en[typedKey].length, `en:${key}`).toBeGreaterThan(0);
      expect(dictionaries.zh[typedKey].length, `zh:${key}`).toBeGreaterThan(0);
    }
  });

  it('every data-i18n attribute in the HTML resolves to a known key', () => {
    const html = read('packages/gui/src/renderer/index.html');
    const keys = [...html.matchAll(/data-i18n(?:-title|-placeholder)?="([^"]+)"/g)].map(
      (match) => match[1],
    );
    expect(keys.length).toBeGreaterThan(40);
    for (const key of keys) expect(enKeys, key).toContain(key);
  });

  it('every t() call in renderer modules resolves to a known key', () => {
    const modules = ['app.ts', 'panels.ts', 'quality.ts', 'ai-assistant.ts', 'editor-page.ts'];
    const used: string[] = [];
    for (const file of modules) {
      const source = read(`packages/gui/src/renderer/${file}`);
      for (const match of source.matchAll(/\bt\(\s*'([^']+)'/g)) used.push(match[1]);
    }
    expect(used.length).toBeGreaterThan(30);
    for (const key of used) expect(enKeys, key).toContain(key);
  });
});

describe('security and licensing documents (English only)', () => {
  it('LICENSE and SECURITY.md exist and contain no CJK text', () => {
    for (const file of ['LICENSE', 'SECURITY.md']) {
      const text = read(file);
      expect(text.length, file).toBeGreaterThan(200);
      expect(text, file).not.toMatch(/[\u3400-\u9fff]/);
    }
    expect(read('LICENSE')).toContain('MIT License');
    expect(read('SECURITY.md')).toContain('Reporting a Vulnerability');
  });

  it('the Chinese README keeps the Security and License sections in English', () => {
    const zh = read('README.zh-CN.md');
    expect(zh).toContain('## Security');
    expect(zh).toContain('## License');
    expect(zh).toContain('SECURITY.md');
    expect(zh).toContain('LICENSE');
  });
});

describe('CI workflow', () => {
  it('runs the renderer smoke check and covers the supported Node versions', () => {
    const ci = read('.github/workflows/ci.yml');
    expect(ci).toContain('renderer-smoke');
    expect(ci).toContain('capture-screenshots.mjs --check');
    expect(ci).toContain('npm test');
    expect(ci).toContain('format:check');
    for (const version of ['22', '24']) expect(ci).toContain(version);
    // vitest 5 requires Node >= 22.12; the old Node 20 CI job could never pass.
    expect(ci).not.toContain("'20'");
    const pkg = JSON.parse(read('package.json')) as { engines: { node: string } };
    expect(pkg.engines.node).toBe('>=22.12.0');
  });
});
