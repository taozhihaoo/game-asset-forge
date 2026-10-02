# Phase 4 Report — CLI

Date: 2026-10-02

## Changed

New package `@gameasset-forge/cli` (workspace-linked to core; deps: `pngjs`, `commander`; bin: `gameassetforge`):

- `src/png.ts` — PNG decode/encode. **IHDR alpha contract (amendment A2)**: alpha presence decided from the IHDR color type (4/6) plus a `tRNS` chunk walk for palette PNGs — never from the decoded buffer (pngjs always emits RGBA). Non-.png inputs rejected with the exact charter §7 message before any decode; corrupt content → `InvalidImageError` with cause.
- `src/glob.ts` — hand-rolled glob (`**`, `*`, `?`) → anchored regex over '/'-separated relative paths; zero dependencies.
- `src/discover.ts` — recursive/non-recursive folder walk, include/exclude filtering, deterministic sort by relative path; non-PNG extensions never become candidates (globs are the contract).
- `src/commands/index.ts` — five commands as testable functions with injectable `log`:
  - `runInit` — writes `serializePreset(DEFAULT_PIPELINE)`; refuses overwrite without `--force`; `schemaVersion` first key guaranteed by the serializer.
  - `runValidate` — schema validation only; typed problems, no image work.
  - `runInspect` — format/colorType/bitDepth, dimensions, alpha, detect config, per-sprite rects (capped at 50 + "N more"), atlas estimate via a real pack. RGB + alpha-CC → warning line (amendment ① inspect behavior), exit stays 0.
  - `runProcess` — full pipeline → `atlas-N.png` + `atlas.json` into the output dir; extension check enforced HERE so process and batch share it.
  - `runBatch` — discovery → per-file processing (failures recorded, never crash the run) → `summary.json` {total, succeeded, failed, durationMs, outputs, errors[{source, stage, error}]}; outputs mirror the input relative tree so same-named sheets never collide.
- `src/main.ts` — commander wiring, `--verbose` stack traces, exit codes per charter §16: **0** success / **1** processing failure (incl. batch with any failure) / **2** invalid input, preset, or usage (unsupported format, bad/unknown preset, missing input, CommanderError).
- Root scripts: `build`/`typecheck`/`test` chain core→cli (`test` builds first so integration tests hit fresh dist); new `npm run cli -- …` alias.

## Tests

17 new integration tests (106 total, all passing) in `tests/cli.integration.test.ts`:
- init: preset round-trips through the core validator; overwrite guard.
- validate: valid / future schemaVersion / malformed JSON with file path.
- inspect: colorType/alpha/count/estimate report; RGB + alpha-CC warning path.
- process: outputs exist, manifest shape, page dims match decoded atlas PNG, **byte-level determinism across runs** (PNG + manifest); .jpg rejection with charter message; corrupt PNG → decode failure; true-RGB input → `NoAlphaChannelError`.
- batch: recursive + path mirroring + default `**/output/**` exclusion; per-file failure isolation (1 corrupt + 1 good → summary error entry with stage `decode`, good one still processed); no-recursive and explicit exclude overrides.
- e2e (spawned `dist/main.js`, skip-if-not-built): help lists five commands; process exits 0 / unsupported input exits **2**; batch with failures exits **1**; bad preset validate exits **2**.
- A hand-built colorType-2 PNG encoder (zlib + crc32) had to be written for the RGB fixtures — pngjs cannot write non-RGBA.

Gates: `typecheck` ✓ · `test` ✓ 106/106 · `lint` ✓ · `build` ✓ · `format:check` ✓
Manual smoke (doc §42 Scenario B): `init` → `inspect` → `batch` on a real sheet → exit 0, mirrored outputs + summary.json verified.

## Result

**PASS**

## Regression

Core suites (89 tests) unchanged and passing.

## Scope

In scope: CLI package, five commands, PNG codec, globs, batch report, exit codes, integration tests. Not touched: exporters (Phase 6), GUI (Phase 7), CI/docs (Phase 9). No git commits (charter §1.20).

## Notes

- CLI-only is now a usable product milestone (the charter's fallback release point): `npm run cli -- batch assets/ --preset preset.json -o out/` works end to end.
- Test-writing caught real bugs: the RGB fixture wasn't RGB (pngjs writes only RGBA — hence the hand-built colorType-2 encoder), and a batch test polluted its own discovery via in-root outputs (fixed by separating the input subtree).

## Next

Phase 5 — real-world fixture validation: ≥3 messy sheets, license check per charter §24 (OpenGameArt/itch.io or user-provided), local-only storage under `fixtures-local/` (gitignored), real snapshot runs, `REAL_FIXTURES_BLOCKED` if unavailable.
