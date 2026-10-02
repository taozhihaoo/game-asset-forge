# Phase 1 Report — Core Skeleton

Date: 2026-10-02

## Changed

- `packages/core/src/types.ts` — all 13 charter types: `RasterImage`, `ImageSize`, `Rect`, `Point`, `Pivot`, `Sprite`, `SpriteSet`, `Atlas`, `AtlasPage`, `AtlasPlacement`, `Pipeline`, `Preset`, `ExportManifest`; enum const arrays as single source for types + validation (`DETECT_MODES`, `RESIZE_FILTERS`, `PIVOT_MODES`, `ATLAS_ALGORITHMS`, `OUTPUT_FORMATS`).
  - **Four-space model documented** (source / content / cell / page) as the authoritative rect-semantics reference.
  - **Spacing formula pinned** (Phase 0 review amendment ②): padding + bleed baked into each cell raster; `atlas.spacing` = gap between cells; effective content gap = bleed(A)+padding(A)+spacing+padding(B)+bleed(B). No bleed-vs-spacing constraint needed.
  - **Pivot reference frame pinned** (amendment ④): normalized [0,1] against the content (trimmed) rect.
- `packages/core/src/errors.ts` — `ForgeError` base (stage/code/source) + 8 typed errors incl. `NoAlphaChannelError` (amendment ①) and `InvalidPresetError` carrying a structured `problems[]` list.
- `packages/core/src/rect.ts` — pure `rectProblems()` (integer/bounds/zero-area checks) + `assertValidRect()`.
- `packages/core/src/preset.ts` — the cross-layer contract:
  - `validatePreset()` — strict (unknown keys rejected at every level), canonical document order, collects all problems;
  - `migratePreset()` — version registry, v1 identity, future versions rejected;
  - `normalizePreset()` — defaults filled; `trim.alphaThreshold` defaults to the **resolved** detect threshold;
  - `parsePreset()` / `serializePreset()` — `schemaVersion` guaranteed first key, no timestamps;
  - `DEFAULT_PIPELINE` — deeply frozen.
- `schemas/preset.schema.json` — draft-07 documentation contract incl. spacing/pivot semantics and the RGB-PNG note.
- Root: `package.json` (workspaces, scripts), `tsconfig.base.json` (strict), `eslint.config.js` (incl. core import-ban rules), `vitest.config.ts`, `.prettierrc.json`, `.prettierignore`, `.gitignore` (incl. `fixtures-local/`).

## Tests

28 unit tests, all passing:
- validation matrix: minimal/full presets, malformed & unsupported `schemaVersion`, unknown keys (typo protection), grid form exclusivity, manual rect validation, numeric ranges with precise paths, duplicate output formats, multi-problem collection in canonical order;
- migration: identity v1, future-version rejection;
- normalization: defaults = `DEFAULT_PIPELINE`, cross-field trim default, purity (no input mutation), manual passthrough;
- serialization: schemaVersion-first key order, roundtrip stability, trailing newline;
- `DEFAULT_PIPELINE` deep-frozen and re-validatable; typed errors carry stage/code/source; rect bounds/zero-area/non-integer rejection.

Gates: `npm run typecheck` ✓ · `npm run test` ✓ (28/28) · `npm run lint` ✓ · `npm run build` ✓ (dist emitted) · `npm run format:check` ✓

## Result

**PASS**

## Regression

None — first implementation phase.

## Scope

In scope: types, errors, preset/pipeline contract, rect validation. Out of scope and untouched: any image operation (Phase 2), atlas (Phase 3), fs/CLI (Phase 4), GUI (Phase 7). No git commits made (charter §1.20).

## Notes / deviations

- tsconfig `outDir`/`rootDir` moved from shared base into `packages/core/tsconfig.json` after stray emissions were caught by `format:check` (recorded in Phase 0 risk #6).
- Preset `detect.mode` is optional in the file format (absent section ⇒ default alpha-CC pipeline) but `mode` itself is required *inside* a present `detect` section.

## Next

Phase 2 — Core image operations: `RasterImage` ops → `detectSprites()` (alpha-CC 8-connectivity, grid, manual) → `trimSprite()` → `resizeSprite()` (nearest/linear) → `applyBleed()` → `calculatePivot()`, each with unit tests, pure and fs-free.
