# Phase 0 Report — Environment / Architecture Audit

Date: 2026-10-02 · Scope: environment check + tech decisions only (no business code, per charter §39).

## A. 环境

| Item | Result |
|---|---|
| Node | v24.19.0 |
| npm | 11.17.0 (registry: https://registry.npmjs.org) |
| TypeScript | 5.x via devDependency (installed Phase 1) |
| Git | 2.55.0.windows.3 — branch `main`, **0 commits**, untracked: guidance doc + `.zcodeignore` |
| OS / shell | Windows 10.0.26200, Git Bash |
| Godot | NOT FOUND → Phase 6 smoke test will report `BLOCKED BY MISSING GODOT RUNTIME` unless installed |
| ImageMagick | NOT FOUND — not required (pure-JS PNG codec planned) |

## B. 技术选型

- **ESM everywhere** (`"type": "module"`), NodeNext module resolution, TS strict.
- **Core: zero runtime dependencies.** Hand-rolled preset validator (deterministic, typed errors, ~250 lines) instead of ajv; `schemas/preset.schema.json` ships as the documented contract (draft-07), not a runtime dep.
- **PNG codec: pngjs** (pure JS, deterministic, no native build) — CLI package, Phase 4. Note: pngjs normalizes RGB PNGs to RGBA, so alpha-channel presence must be read from the IHDR color type, not the decoded buffer (Phase 0 review amendment ①).
- **CLI parser: commander** — Phase 4.
- **Test: vitest**; **Lint: eslint 9 + typescript-eslint (recommended, non-type-aware) + prettier**. No Nx/Turborepo (charter §33).
- **GUI: Electron + PixiJS + vanilla TS** — deliberately NOT installed until Phase 7.
- **Charter ban-list is machine-enforced**: eslint `no-restricted-imports`/`no-restricted-globals` on `packages/core/src/**` blocks `fs/path/process/child_process/electron/pixi.js/node:*` and `window/document/process/Buffer/require`.

## C. Monorepo structure

```
gameasset-forge/
├── packages/core/        # pure logic, zero runtime deps (Phase 1+)
├── packages/cli/         # Phase 4 (fs, PNG codec, commander)
├── packages/gui/         # Phase 7 (Electron + PixiJS)
├── schemas/              # preset.schema.json (documentation contract)
├── docs/                 # phase reports
├── tests/                # cross-package integration tests (Phase 4+)
├── presets/              # shipped example presets
├── samples/              # godot-smoke etc. (Phase 6)
└── fixtures-local/       # real-world fixtures, NEVER committed (gitignored)
```

npm workspaces only. Root scripts: `build` / `typecheck` / `test` / `lint` / `format` / `format:check`.

## D. Dependency list

devDependencies (root, hoisted): `typescript`, `vitest`, `eslint`, `typescript-eslint`, `prettier`, `@types/node`.
Runtime dependencies: **none** (core), `pngjs` + `commander` planned (cli, Phase 4), `electron` + `pixi.js` planned (gui, Phase 7).

## E. Risk list

1. **Godot absent** — smoke test (DoD [16]) currently unachievable locally; will be reported BLOCKED, not faked. User may install Godot 4.x before Phase 6.
2. **pngjs alpha normalization** — alpha-presence checks must use IHDR color type (RGB PNG contract, amendment ①).
3. **PNG byte determinism** — outputs compared as pixel data in golden tests, not bytes (charter §12).
4. **Windows paths** — core receives '/'-normalized paths only; sanitization of output filenames handled in Phase 3/4.
5. **Real fixtures licensing** — downloads deferred to Phase 5; if unavailable → `REAL_FIXTURES_BLOCKED`.
6. **tsconfig path pitfall** — `outDir`/`rootDir` in the shared base resolve relative to the base file; they live in per-package tsconfigs now (fixed during Phase 1).
7. **Scope discipline** — mitigated by charter §38 and the two acceptance bars (4 product criteria / 25 DoD items).

**Result: PASS**
