# Phase 3 Report — Atlas

Date: 2026-10-02

## Changed

- `src/atlas.ts` — `packAtlas` (MaxRects, **Best-Short-Side-Fit, single stable variant** per charter §12):
  - deterministic by construction: sprites placed strictly in INPUT order; free rects iterated in list order; score ties → earliest free rect; no hash-map order in the algorithm;
  - spacing model per amendment A1: each sprite occupies `(raster + spacing)` block, stored placement rect is the true raster size → gap ≥ spacing guaranteed; documented conservative constraint `raster + spacing ≤ page max` (violation → `AtlasPackingError` with actionable message);
  - multi-page: overflow opens a new page automatically; page size trimmed to used extent (power-of-two pages = backlog);
  - free-list maintenance: MaxRects difference split (up to 4 parts) + containment pruning (equal rects survive — harmless duplicates).
- `src/atlas.ts` — `composeAtlasPages`: blits cell rasters at placements into page pixels; rejects unknown sprite refs and rect mismatches (internal invariants).
- `src/manifest.ts` — `buildManifest`: deterministic ExportManifest (fixed key order, no timestamps), page files `atlas-N.png`, per-sprite `rect/sourceRect/trimmedRect/pivot` per amendment A3, generator version `CORE_VERSION`.
- `src/version.ts` — `CORE_VERSION` moved to its own module (removes manifest→index circular import).
- `src/pipeline.ts` — `runPipeline(image, pipeline, {sourcePath})`: the one-entry-point pure pipeline (detect → … → manifest), returns `{sprites, skipped, atlas, pages, manifest}`; fs stays outside (callers decode/encode).
- `src/index.ts` — exports updated.

## Tests

23 new tests (89 total, all passing):
- **atlas unit**: input-order placement, L-shaped free-space reuse (MaxRects behavior pinned: 8x8 + 2x2 → small lands at (8,0)), spacing-gap math (`b.x = a.x + a.w + spacing`), multi-page split (2+1 across pages), oversized-cell rejection (both raw-oversize and spacing-induced), zero-sprite → zero pages, double-run determinism;
- **composeAtlasPages**: page extents, pixel-level blit verification (channel checks at exact coordinates), unknown-sprite rejection;
- **runPipeline end-to-end**: manifest shape (schemaVersion/generator/pages filenames/pivot/rects), empty-but-valid result when all sprites skipped, no-alpha error propagation with source, double-run deep-equal determinism;
- **golden tests (charter §23C)** — 7 synthetic deterministic fixtures (seeded mulberry32 PRNG, no external assets): `01-simple-grid`, `02-irregular`, `03-noisy` (specks + faint alpha ring), `04-multi-page`, `05-resize` (2x nearest), `06-bleed`, `07-manual` (incl. empty-region skip). Golden JSON pins manifest + skipped exactly; a guard test asserts the golden dir matches the fixture list with no stale/missing files. Regenerate deliberately via `UPDATE_GOLDENS=1 npm test`.

Gates: `typecheck` ✓ · `test` ✓ 89/89 · `lint` ✓ · `build` ✓ · `format:check` ✓

## Result

**PASS**

## Regression

Phase 1+2 suites (66 tests) unchanged and passing.

## Scope

In scope: packing, page compositing, manifest, runPipeline, golden framework. Not touched: fs/CLI (Phase 4), exporters, GUI. No git commits (charter §1.20).

## Notes

- Golden files pin `generator.version = 0.1.0`; a version bump must regenerate goldens deliberately (that's the point — output changes must be intentional and reviewed).
- Page extents are used-extent (not power-of-two); documented in atlas.ts and noted as backlog for engine-specific requirements.
- Test math self-checks caught one wrong page-width expectation before it was committed as a golden.

## Next

Phase 4 — CLI: new `packages/cli` package (pngjs decode/encode incl. IHDR color-type alpha detection per amendment A2, commander), commands `init/inspect/validate/process/batch`, glob include/exclude matching, batch traversal + `summary.json` report, exit codes 0/1/2, synthetic-fixture integration tests via child_process.
