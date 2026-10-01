import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: ['**/dist/**', '**/dist-gui/**', '**/node_modules/**', 'coverage/**'],
  },
  ...tseslint.configs.recommended,
  {
    files: ['packages/core/src/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: [
                'fs',
                'path',
                'process',
                'child_process',
                'os',
                'crypto',
                'electron',
                'pixi.js',
                'node:*',
              ],
              message:
                'Core must stay IO/UI-independent: no filesystem, no Node APIs, no Electron/PixiJS (V1 charter, sections 1.10-1.12).',
            },
          ],
        },
      ],
      'no-restricted-globals': [
        'error',
        { name: 'window', message: 'Core must stay UI-independent.' },
        { name: 'document', message: 'Core must stay UI-independent.' },
        { name: 'process', message: 'Core must stay IO-independent.' },
        { name: 'Buffer', message: 'Core must stay environment-independent; use typed arrays.' },
        { name: 'require', message: 'Core is ESM-only.' },
      ],
    },
  },
);
