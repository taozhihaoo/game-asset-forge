# Architecture

## Layering

```
            ┌──────────────────┐
            │   GUI (Electron) │  main: dialogs + fs (IPC only)
            │  preload bridge  │  renderer: sandboxed, imports core directly
            └────────┬─────────┘
                     │ Preset JSON (same schema, same parser)
                     ▼
   ┌──────────────────────────────────────┐
   │            CORE (pure)               │
   │  detect → trim → resize → bleed →    │  no fs, no Node, no UI
   │  padding → pivot → MaxRects →        │  (lint-enforced import ban)
   │  manifest                            │
   └────────▲──────────────┘
            │
   ┌────────┴─────────┐
   │   CLI (pngjs +   │  decode → RasterImage → core → encode/write
   │   commander)     │  exporters (Godot .tres / Unity .cs) live HERE:
   └──────────────────┘  they consume the generic ExportManifest,
                         so core stays engine-blind
```

## Data flow

1. Caller decodes PNG bytes → `RasterImage` (RGBA8, `hasAlpha` from the
   IHDR color type — never from the decoded buffer).
2. `parsePreset(raw)` = validate → migrate → normalize (defaults filled).
3. `runPipeline(image, pipeline, {sourcePath})` →
   `{sprites, skipped, atlas, pages, manifest}` — all pure.
4. Caller encodes `pages` to PNG and writes manifest/exporter files.

## Key invariants

- **Determinism**: stable sprite IDs (`<source>#sprite-NNNN`, detection
  order), stable sort with total tie-breaks, MaxRects iterates free rects in
  list order, no timestamps in outputs. Golden tests pin manifests.
- **Four-space rect model** (source / content / cell / page) — see
  `packages/core/src/types.ts` for the authoritative doc comment.
- **Spacing formula**: padding + bleed are baked into each cell raster;
  `atlas.spacing` is the gap between cells (amendment A1 in the V1 doc).
- **Manual fallback** is a designed degradation path: manual rects feed
  `detect.mode = manual` and re-enter the same pipeline.
- **No hidden state** (GUI): every pipeline parameter lives in the preset
  structure; view/page/selection never affect output.
- **Preset evolution**: `schemaVersion` first key in serialized output;
  versioned migration registry; unknown keys rejected loudly.

## Error model

Typed `ForgeError` hierarchy with `stage` (input/decode/preset/detect/trim/
resize/bleed/pack/export) and stable `code`; CLI maps usage-class codes to
exit 2, processing failures to exit 1, success to 0.
