# Phase 6 Report — Exporters

Date: 2026-10-02

## Changed

- `packages/cli/src/exporters/godot.ts` — `buildSpriteFramesTres(manifest)`: pure manifest → Godot 4 `SpriteFrames` `.tres` text (format=3). One "default" looped animation at 5 fps containing every sprite in manifest order; one `AtlasTexture` sub-resource per sprite with the packed cell `Rect2`; one `ext_resource` per page (relative paths — files sit side by side in the output dir); no `uid=`, no timestamps → byte-deterministic. Core never learns Godot exists (charter §20 layering).
- `packages/cli/src/exporters/unity.ts` — `buildUnityImporterScript()`: generated `AssetPostprocessor` that reads the sibling `atlas.json` at Unity import time and slices the atlas via `TextureImporter.spritesheet` with per-sprite custom pivots. Uses only built-in `JsonUtility` (parses a subset of the manifest; unknown fields ignored — no Newtonsoft dependency). Handles the **top-left → bottom-left Y flip** against the page height, multi-page via `atlas-N` filename parsing, and sprite id `'#'` → `'/'` naming. Header states it has passed static validation only (charter §21 anti-fabrication). No `.meta` files are generated, ever.
- `runProcess` — honors `output.godot.enabled` / `output.unity.enabled` from the preset; writes `<basename>_spriteframes.tres` and `GameAssetForgeImporter.cs` into the output dir; exporter files join `ProcessOutcome.outputFiles` (and therefore batch `summary.json`).
- `samples/godot-smoke/` — DoD [16] sample project: `project.godot` (4.2), `main.tscn` (`AnimatedSprite2D`, `autoplay = "default"`, references `res://assets/player_spriteframes.tres`), `spin.gd`, README with verify steps; `assets/` gitignored and regenerated via the new `npm run sample:godot` script (`scripts/generate-godot-smoke.mjs` drives the real built CLI).
- `samples/README.md` unchanged from Phase 5.

## Tests

6 new tests (119 total, all passing):
- Godot: resource header/load_steps math, ext/sub-resource counts, exact `Rect2` values for both sprites (margin-aware), determinism, no uid/no version string leakage.
- Unity: postprocessor shape, `atlas.json` consumption, Y-flip expression present, brace balance, `@VERSION@` stamped with `CORE_VERSION`.
- Integration (via `runProcess`): enabling both exporters in the preset produces `player_spriteframes.tres` + `GameAssetForgeImporter.cs` in the output dir.
- `npm run sample:godot` executed for real: CLI generated `atlas-0.png` + `atlas.json` + `player_spriteframes.tres`; `.tres` content spot-checked.

Gates: `typecheck` ✓ · `test` ✓ 119/119 · `lint` ✓ · `build` ✓ · `format:check` ✓

## Result

**PASS** — with one charter-mandated caveat:

## Godot Verification

**BLOCKED BY MISSING GODOT RUNTIME** — Godot is not installed in this
environment (Phase 0 audit). Everything statically checkable is checked:
`.tres` structure, coordinates, references, and the sample project files are
in place and the assets were generated through the real CLI. Opening
`samples/godot-smoke/` in Godot 4.x and pressing Play is the remaining step.
Per charter §20, runtime success is NOT claimed.

## Unity Verification

`export generated, runtime validation unavailable` (charter §21) — script is
statically validated (DoD [17]); no Unity runtime present, none claimed.

## Regression

Core + CLI + real-fixture suites (113 tests) unchanged and passing.

## Scope

In scope: both exporters, preset wiring, smoke sample + generator script. Not touched: GUI (Phase 7), CI/docs (Phase 9). No git commits (charter §1.20).

## Next

Phase 7 — GUI shell: Electron + PixiJS + vanilla TS, main/preload/renderer split with `contextIsolation: true`, `nodeIntegration: false`, fs via preload IPC; Assets / Canvas / Properties / Log panels; detected-rect overlays, pivot markers, manual rect editing, preset load/save through the same schema.
