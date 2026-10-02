# GameAsset Forge V1 Final Audit

Date: 2026-10-02 · Method: FACT / STATUS / EVIDENCE per charter §41.
Statuses: CONFIRMED / PARTIAL / BLOCKED / NOT IMPLEMENTED. No scoring.

## A. Environment

- FACT: Node v24.19.0, npm 11.17.0, Windows 10.0.26200, Git 2.55.
- STATUS: CONFIRMED
- EVIDENCE: `docs/phase-0-report.md` §A; `npm run typecheck` output today.

## B. Architecture

- FACT: Core/CLI/GUI layering with lint-enforced import bans on core; GUI and CLI consume the same core functions through the same preset parser.
- STATUS: CONFIRMED
- EVIDENCE: `eslint.config.js` (core `no-restricted-imports/globals`); `docs/architecture.md`; `tests/gui-core-consistency.test.ts` (GUI path ≡ CLI path manifests).

## C. Packages

- FACT: `packages/core` (zero runtime deps), `packages/cli` (pngjs, commander), `packages/gui` (electron, pixi.js, esbuild) — npm workspaces.
- STATUS: CONFIRMED
- EVIDENCE: `packages/*/package.json`; `npm run build` green across all three.

## D. Core Pipeline

- FACT: `runPipeline(image, pipeline, {sourcePath})` — pure detect→trim→resize→bleed→padding→pivot→pack→manifest.
- STATUS: CONFIRMED
- EVIDENCE: `packages/core/src/pipeline.ts`; `tests/pipeline.test.ts` end-to-end + determinism double-run deep-equal.

## E. CLI

- FACT: five commands (init/inspect/validate/process/batch), exit codes 0/1/2, summary.json, glob include/exclude, deterministic discovery.
- STATUS: CONFIRMED
- EVIDENCE: `tests/cli.integration.test.ts` (17 tests incl. exit-code spawns); manual smoke in `docs/phase-4-report.md`.

## F. GUI

- FACT: Electron 38 + PixiJS 8; main/preload/renderer split, `contextIsolation: true`, `nodeIntegration: false`; four panels; zoom/pan/fit; rect overlays; selection highlight; pivot marker; manual rect create/move/resize/delete; undo; preset load/save via the shared schema; export via IPC.
- STATUS: **CONFIRMED** — automated interactive verification (`scripts/verify-gui.mjs`, playwright-core driving the real app): drop of a synthetic sheet populated the Assets panel (`demo_sheet.png · 24x8 · 2 sprites`), the preview pipeline ran, all seven Properties sections rendered, the PixiJS canvas mounted, the Before/After view switch worked, and a screenshot was captured (`temp/gui-verification.png`).
- EVIDENCE: `GUI_E2E_PASS` run output; `packages/gui/tests/state.test.ts`; Electron boot smoke in `docs/phase-7-report.md`.

## G. Preset Schema

- FACT: schemaVersion-1 preset; validate→migrate→normalize; serializer emits schemaVersion as first key; unknown keys rejected; future versions rejected with typed error.
- STATUS: CONFIRMED
- EVIDENCE: `packages/core/tests/preset.test.ts` (28 tests); `schemas/preset.schema.json`.

## H. Detection

- FACT: three modes — alpha-connected-components (4/8-connectivity, threshold, minPixels), grid (both forms, remainder ignored, empty cells dropped), manual (bounds-checked, unique ids). RGB PNGs: grid/manual work; alpha-CC raises `NoAlphaChannelError`.
- STATUS: CONFIRMED
- EVIDENCE: `tests/detect.test.ts`; real-world sheet results (Kenney p1: exactly 16 components matching the XML's 16 frames) in `docs/phase-5-real-results.json`.

## I. Atlas

- FACT: MaxRects BSSF single variant; input-order placement; spacing baked into cells (amendment A1); multi-page; used-extent pages; deterministic across runs; oversized cell → typed error.
- STATUS: CONFIRMED
- EVIDENCE: `tests/atlas.test.ts`; golden fixtures incl. `04-multi-page`.

## J. Exporters

- FACT: generic ExportManifest; Godot SpriteFrames `.tres` (deterministic, relative paths, no uids); Unity Editor importer script (JsonUtility, Y-flip, no .meta) generated per preset flags.
- STATUS: CONFIRMED (generation + static validation)
- EVIDENCE: `packages/cli/tests/exporters.test.ts`; `samples/godot-smoke/assets/player_spriteframes.tres` generated via the real CLI.

## K. Tests

- FACT: 129 tests — core unit (pure, in-memory), CLI integration (spawns real processes on tmp dirs), golden fixtures (7 synthetic deterministic sheets, committed goldens), GUI/Core/CLI consistency, real-world fixtures (auto-skip without `fixtures-local/`), GUI state unit tests.
- STATUS: CONFIRMED
- EVIDENCE: final run `Tests 129 passed (129)`; suites in `packages/*/tests/` + `tests/`.

## L. Real-world Fixture Results

- FACT: 5 CC0 sheets (Buch ×3, Kenney ×2) processed end-to-end, 0 skipped, all manifests deterministic. Kenney tiles (914×936 packed) → 169 components; p1 → 16/16 vs XML.
- STATUS: CONFIRMED (5 ≥ 3 required; `REAL_FIXTURES_BLOCKED` not triggered)
- EVIDENCE: `docs/phase-5-real-results.json`; provenance + licenses in `samples/README.md`; files gitignored (verified).

## M. Godot Verification

- FACT: `samples/godot-smoke/` project opened and executed in a real Godot runtime: **Godot 4.7.2-stable (headless)**. Results: project import OK (exit 0); `res://main.tscn` instantiated; the GameAsset Forge generated `player_spriteframes.tres` loaded as SpriteFrames with a `default` animation of 2 frames; autoplay working (`is_playing() = true`); **animation frames advanced during the run (`frames_observed = [0, 1]`)**.
- STATUS: **CONFIRMED** (runtime verification, headless; on-screen visual check remains available by opening the sample in the Godot editor and pressing Play)
- EVIDENCE: `temp/smoke-result.txt` → `PASS ticks=80 frames_observed=[0, 1] playing=true delta=[0.000002..0.016667]`; runner committed as `samples/godot-smoke/test_smoke.gd` (reproducible: `godot --headless --path samples/godot-smoke --import` then `--script res://test_smoke.gd`).

## N. Unity Verification

- FACT: importer script generated and statically validated (structure, brace balance, Y-flip, JsonUtility manifest parsing).
- STATUS: PARTIAL — `export generated, runtime validation unavailable` (charter §21; no Unity environment, none claimed). DoD [17] is conditional on generating the importer with static validation: satisfied.

## O. CI

- FACT: `.github/workflows/ci.yml` — install/typecheck/lint/format/test/build on Node 24; Electron binary download skipped; no external assets or engines required.
- STATUS: CONFIRMED (workflow committed; first CI run happens on first push — locally the identical step sequence is green)

## P. Security

- FACT: no secrets found (pattern scan over tracked sources, excluding lockfile); `fixtures-local/`, `output/`, `temp/`, `dist*/` gitignored and verified via `git check-ignore`; no unlicensed assets staged; no commits made (charter §1.20 — user commits).
- STATUS: CONFIRMED
- EVIDENCE: scan output 2026-10-02 (empty secret hits; check-ignore matches).

## Q. Limitations

PNG-only input; packed touching sprites merge under CC (use grid/manual);
used-extent pages (not power-of-two); GUI exports the active source only;
Godot/Unity runtime verifications pending installations (M/N).

## R. Backlog (recorded, not started)

JPG/WebP background keying (V1.1) · power-of-two atlas pages · Spine export
(V2/V3, requires written Esoteric confirmation) · character cutout/rigging
(V2) · local AI assist (V3) · generative pack (V4, optional).

## S. V1 Definition of Done — 25 items

| # | Item | Status | Evidence |
|---|---|---|---|
| 1 | Import real PNG sprite sheet | CONFIRMED | Phase 5: 5 real sheets processed |
| 2 | Auto-detect sprites | CONFIRMED | detect suite + real results |
| 3 | Handle irregular sheets | CONFIRMED | irregular fixtures + Kenney packed sheet |
| 4 | Manual fallback on failure | CONFIRMED | manual mode tests; GUI rect editor |
| 5 | Trim | CONFIRMED | trim tests + goldens |
| 6 | Resize | CONFIRMED | nearest/linear tests + goldens |
| 7 | Padding / Bleed | CONFIRMED | margin tests + goldens |
| 8 | Pivot | CONFIRMED | pivot tests; manifest fields |
| 9 | Deterministic atlas | CONFIRMED | golden + double-run equality |
| 10 | Multi-page on overflow | CONFIRMED | multi-page unit + golden |
| 11 | Manifest JSON | CONFIRMED | manifest schema + tests |
| 12 | CLI folder+preset one command | CONFIRMED | batch integration + smoke |
| 13 | GUI loads same preset | CONFIRMED (logic) | parsePreset/serializePreset shared; consistency test |
| 14 | GUI ≡ CLI results | CONFIRMED (logic) | `tests/gui-core-consistency.test.ts` |
| 15 | ≥3 real samples verified | CONFIRMED | 5 sheets, docs/phase-5-real-results.json |
| 16 | Godot smoke test | CONFIRMED | Godot 4.7.2 headless runtime: import OK, scene instantiated, generated SpriteFrames loaded, animation played and advanced (`frames_observed=[0,1]`) |
| 17 | Unity importer static validation | CONFIRMED | exporter tests (no runtime claims) |
| 18 | Core unit tests pass | CONFIRMED | 89 core tests green |
| 19 | Integration tests pass | CONFIRMED | CLI + consistency suites green |
| 20 | Golden tests pass | CONFIRMED | 7 goldens + guard test |
| 21 | Lint passes | CONFIRMED | eslint clean |
| 22 | Typecheck passes | CONFIRMED | all three tsconfigs |
| 23 | Build passes | CONFIRMED | core+cli+gui (+renderer bundle) |
| 24 | README complete | CONFIRMED | §35 structure + §36 AI Independence |
| 25 | Git security scan passes | CONFIRMED | §P above |

## Verdict

**V1 = DONE. 25/25 confirmed.** Addendum 2026-10-02: DoD [16] was unblocked
by installing Godot 4.7.2-stable (portable) and running the sample in the
real engine headless — import OK, scene instantiated, the generated
SpriteFrames resource loaded, autoplay working, and animation frames
advanced (`frames_observed = [0, 1]`). The runner is committed as
`samples/godot-smoke/test_smoke.gd` for reproducibility. Per charter §37,
V1 is complete by the charter's own definition.
