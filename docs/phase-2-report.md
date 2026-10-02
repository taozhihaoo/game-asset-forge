# Phase 2 Report — Core Image Operations

Date: 2026-10-02

## Changed

All new modules are pure functions over typed data — no fs, no UI, no Node APIs (enforced by the eslint core rules).

- `src/image.ts` — `createRasterImage` (dimension guards 1..65535), `cloneRaster`, `cropRaster` (bounds-checked, row-wise copy), `getPixel`/`setPixel`.
- `src/types.ts` — `RasterImage.hasAlpha` added: reflects the SOURCE format (PNG IHDR color type), not the buffer; drives the no-alpha contract (amendment ①). Decoders always emit RGBA buffers.
- `src/detect.ts` — `detectSprites(image, detect, {source})`:
  - **alpha-connected-components**: threshold pass → iterative flood fill (explicit `Int32Array` stack, no recursion; neighbor pushes with explicit x-bounds so ±1 never wraps rows) → `minPixels` filter → deterministic sort (top-left y, x, then width/height/area/scan-discovery). Zero components → `NoSpritesFoundError`; RGB source → `NoAlphaChannelError` pointing at grid/manual.
  - **grid**: rows+columns form (`cell = floor(size/n)`) or cellWidth+cellHeight form (`n = floor(size/cell)`); remainder strips ignored per documented formula; empty cells dropped **except** on no-alpha sources (everything is content); degenerate grids (cell < 1px) → `ForgeError(GRID_INVALID)`.
  - **manual**: order preserved, `assertValidRect` per rect against image bounds, ids unique within the source (auto `sprite-NNNN` when omitted).
- `src/trim.ts` — `computeContentBounds` (single scan, alpha >= threshold) + `trimRaster` → `{ raster, contentRect }` or `null` when fully transparent.
- `src/resize.ts` — `resizeRaster(scale, filter)`: scale 1 returns input unchanged; nearest = center sampling (`floor((d+0.5)/scale)`, clamped); linear = bilinear on centers (`(d+0.5)/scale-0.5`) with clamped indices; output size `max(1, round(size*scale))`; straight (non-premultiplied) alpha, documented.
- `src/bleed.ts` — `applyBleed` (clamped-sampling extrusion: replicates edge pixels outward incl. diagonal corners) + `applyPadding` (transparent margin); both bake into the cell per amendment ②; 0 returns input unchanged. Margin validation reports under stage `bleed` (`padding` is not a charter stage).
- `src/pivot.ts` — `calculatePivot`: center `{0.5,0.5}`, bottom-center `{0.5,1}`, manual passthrough; normalized against content space (amendment ④).
- `src/sprites.ts` — `buildSprites(image, pipeline, {sourcePath})` assembly: detect → crop → trim (shifts `trimmedRect` into source space) → resize → bleed → padding; stable ids `<sourcePath>#sprite-NNNN` (or manual id) numbered by DETECTION index so skips never renumber; fully transparent sprites are skipped with `{id, sourceRect, reason: 'fully-transparent'}` — never a 0x0 texture (charter §9). `composeCellRaster` exported for GUI preview reuse.

Charter §17 name mapping: `trimSprite` → `trimRaster`, `resizeSprite` → `resizeRaster`; assembly = `buildSprites`. `packAtlas`/`buildManifest`/`runPipeline` arrive with Phase 3.

## Tests

38 new tests (66 total, all passing):
- detection: y-then-x ordering, 8- vs 4-connectivity diagonal behavior, minPixels filtering, alphaThreshold boundary (7 vs 8), hole-spanning bounding boxes, empty sheet, RGB source error, run-to-run determinism; grid both forms with exact rect math incl. remainders, empty-cell dropping, no-alpha keeps-all, degenerate grid rejection; manual order/ids/out-of-bounds/duplicate-id.
- trim: tight bounds, null cases, threshold respect, source-space reporting.
- resize: scale-1 identity, nearest 2x block replication + 0.5x sampling indices, linear gradient interpolation values, non-integer rounding, invalid scale rejection.
- bleed/padding: identity at 0, edge/corner replication, margin transparency, cell = content + 2*(bleed+padding) composition.
- pivot: three modes.
- buildSprites (end-to-end): full pipeline dims/ids/pivots, trim rect shifting, resize-before-margins with source-space trimmedRect, manual-id propagation, transparent-sprite skip with stable ids, determinism.

Gates: `typecheck` ✓ · `test` ✓ 66/66 · `lint` ✓ · `build` ✓ · `format:check` ✓

## Result

**PASS**

## Regression

Phase 1 suite (28 tests) unchanged and passing.

## Scope

In scope: pre-atlas image operations + assembly. Not touched: atlas/manifest/runPipeline (Phase 3), fs/CLI (Phase 4), exporters, GUI. No git commits (charter §1.20).

## Notes

- Test-writing caught two spec misunderstandings before they became code bugs: alpha-CC never emits rects for empty regions (transparent-sprite skipping is reachable via manual rects / trim-threshold mismatch), and grid cells need real content to survive detection.
- Flood fill is iterative, not recursive — large sheets cannot blow the call stack.

## Next

Phase 3 — Atlas: MaxRects (single deterministic variant), multi-page split, stable ordering by input order + sprite index, `buildManifest`, `runPipeline(image, pipeline)` assembly, and golden tests with synthetic deterministic fixtures.
