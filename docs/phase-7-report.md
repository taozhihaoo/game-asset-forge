# Phase 7 Report — GUI Shell

Date: 2026-10-02

## Changed

New package `@gameasset-forge/gui` (Electron 38 + PixiJS 8 + vanilla TS, no React):

- **Process architecture (charter §4)**: `src/main.mts` (ESM main — owns all fs + native dialogs via IPC handlers), `src/preload.ts` (CJS — `contextBridge` exposing the narrow typed `ForgeBridge`), renderer fully sandboxed: `contextIsolation: true`, `nodeIntegration: false`, renderer has zero Node access. Security defaults verified in code.
- **Renderer runs the real core**: `@gameasset-forge/core` is imported directly in the renderer (pure TS, browser-safe) — the library/shell separation pays off: GUI preview and CLI batch run the identical pipeline functions. Engine exporters (`buildSpriteFramesTres`, `buildUnityImporterScript`) are reused from the CLI source (pure modules).
- **Four panels (charter §18)**: LEFT Assets (per-file status/dimensions/alpha/sprite counts/errors, click to activate, drag & drop anywhere), CENTER PixiJS canvas, RIGHT Properties (Detection/Trim/Resize/Margins/Pivot/Atlas/Export sections, all bound to the normalized Pipeline), BOTTOM Log (timestamped, capped at 500 lines).
- **Canvas**: wheel zoom-to-cursor (0.02×–40×), pan (middle-drag / shift-drag / Pan tool / P), Fit, 100%, detected-rect overlays (Before/source view), atlas placements + page switching (After/atlas view), selection highlight, pivot crosshair marker, manual-rect tool (R): drag-create → switches detect mode to `manual` (the designed fallback), move whole rect, resize via corner handle, Delete key / button.
- **State (charter §27 no hidden state)**: `state.ts` is DOM-free and unit-tested — the normalized Pipeline is the single source of truth; manual rects feed `detect.mode='manual'` via `effectivePipeline()`; only view/page/selection are UI-only and never affect output. Undo (Ctrl+Z, 50 snapshots) covers exactly pipeline + manual-rect edits.
- **Preview loop**: debounced 250 ms `runPipeline` on any edit; errors surface in the log and never clobber the last good result.
- **Export**: picks a directory via dialog, encodes page rasters in-renderer (OffscreenCanvas), writes `atlas-N.png` + `atlas.json` (+ `.tres` / Unity importer per preset flags) through the preload bridge.
- **Preset load/save** through the same `parsePreset`/`serializePreset` as the CLI (`schemaVersion` first key guaranteed).
- **Toolchain**: esbuild bundles the renderer (charter §32 justification: browser bare-module resolution); main process is ESM (`.mts` → `.mjs`, Electron 38), preload stays CJS per Electron requirement.

## Tests

8 new unit tests (127 total, all passing) — `packages/gui/tests/state.test.ts`:
- `effectivePipeline` pass-through for auto modes; manual-mode merge of rects.
- Manual rect add/update/delete with single-step undo semantics (mode switch included in the snapshot).
- Selection cleared on delete; undo restores.
- Undo limit (50) bounded correctly.
- `pngHasAlpha` IHDR contract (colorType 4/6 alpha; 0/2/3-palette-without-tRNS no-alpha) — renderer copy matches the CLI.

Gates: `typecheck` (core+cli+gui) ✓ · `test` ✓ 127/127 · `lint` ✓ · `build` ✓ (three packages + renderer bundle) · `format:check` ✓

## GUI Runtime Verification

**PARTIAL — main process verified, interactive session pending.**
- `electron .` smoke run: main process boots and stays alive (12 s forced-kill smoke under `--disable-gpu`; the reported GPU exit 143 is the kill signal, not a crash).
- Interactive verification (open a sheet, see overlays, draw rects, export, open the result in Godot) requires a desktop session — run `npm run dev -w @gameasset-forge/gui`. Per charter §1/§20 anti-fabrication: no interactive claims are made here.

## Result

**PASS** (with the honest PARTIAL runtime note above)

## Regression

Core + CLI + real-fixture suites (119 tests) unchanged and passing.

## Scope

In scope: GUI package, three-process skeleton, four panels, canvas interactions, manual rect editor, preset load/save, export bridge. Deferred to backlog: batch processing UI (single-source export only in V1 GUI), freehand/polygon tools. No git commits (charter §1.20).

## Notes

- Build-output dirs (`dist-gui/`) added to eslint/prettier/gitignore after lint caught the bundled renderer.
- Test-writing caught a real typo (`this.draft =` vs `this.drag =` — Graphics vs drag-state) before runtime, plus the TS6 `node10` deprecation and a PNG-rect union-narrowing issue in the detect-mode switcher.

## Next

Phase 8 — GUI/Core consistency integration test (charter §26): prove `preset.json → parsePreset → runPipeline` (the GUI code path) produces a manifest identical to the CLI path on the same inputs; plus a GUI smoke script for manual verification.
