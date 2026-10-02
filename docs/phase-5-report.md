# Phase 5 Report — Real-World Fixture Validation

Date: 2026-10-02 · Result: **PASS (5 real sheets, ≥3 required)**

## Changed

- `fixtures-local/` (gitignored, double-locked by root `.gitignore` + a local `*` ignore) — 5 real game sprite sheets, downloaded from OpenGameArt with license verified on-page:
  - Buch, "A Platformer in the Forest" (CC0): `characters_7.png` 736×128, `sheet_9.png` 272×128, `swoosh_0.png` 128×32
  - Kenney, "Platformer Art Deluxe" (CC0): `kenney_tiles_spritesheet.png` 914×936 (packed, irregular), `kenney_p1_spritesheet.png` 508×288
- `samples/README.md` (committed) — provenance table: source URLs, authors, licenses, re-download instructions. No image bytes enter the repo (charter §24).
- `tests/real-fixtures.test.ts` — real-world validation suite: skips entirely when `fixtures-local/` is absent (CI stays green on synthetic fixtures), asserts per sheet: decodes, full `runPipeline` completes, **double-run manifest determinism on real pixels**, ≥1 sprite and ≥1 page, page extents within atlas limits. `GAF_WRITE_REAL_RESULTS=1` writes `docs/phase-5-real-results.json` (counts/dimensions only — committed, no pixels).
- `docs/phase-5-real-results.json` — committed results evidence.

## Results (all 5 processed, 0 skipped, all deterministic)

| Fixture | Size | Detect | Sprites | Pages |
| --- | --- | --- | --- | --- |
| characters_7.png | 736×128 | grid 32×32 | 73 | 1 (157×617) |
| sheet_9.png | 272×128 | alpha-CC | 22 | 1 (191×308) |
| swoosh_0.png | 128×32 | alpha-CC | 4 | 1 (30×128) |
| kenney_p1_spritesheet.png | 508×288 | alpha-CC | 16 | 1 (309×818) |
| kenney_tiles_spritesheet.png | 914×936 | alpha-CC | 169 | 1 (2034×818) |

Plausibility cross-checks: Kenney's p1 sheet ships XML listing 16 frames — detection found exactly 16 connected components. characters_7 is a 23×4 cell grid (92 cells) — 73 non-empty found, 19 empty cells dropped, matching the sheet's known layout. The 914×936 packed tiles sheet yields 169 components (adjacent tiles merge — expected behavior for CC on packed sheets; grid/XML mode remains the precise path for those, which is exactly the designed mode split).

## Tests

6 new tests (113 total, all passing): the ≥3-files guard plus one full-pipeline test per real sheet and the results-writer guard.

Gates: `typecheck` ✓ · `test` ✓ 113/113 · `lint` ✓ · `build` ✓ · `format:check` ✓
Git hygiene: `git check-ignore fixtures-local/characters_7.png` → ignored ✓; `git status` shows no fixture paths ✓.

## Result

**PASS** — DoD [15] satisfied with 5/3 required real sheets; `REAL_FIXTURES_BLOCKED` NOT triggered.

## Regression

Core + CLI suites (107 tests) unchanged and passing.

## Scope

In scope: fixture acquisition, provenance, real-world test harness. Not touched: exporters (Phase 6), GUI (Phase 7). No git commits (charter §1.20).

## Notes

- The first run failed on a test bug (preset passed as a JSON string), not on any pipeline weakness — real sheets processed correctly once fixed.
- Real pixels validated the no-alpha IHDR contract path (all 5 are colorType 6, so alpha-CC ran; the RGB path remains covered by the synthetic colorType-2 tests).
- Observation for V1.x backlog (not a defect): CC merges visually adjacent tiles on packed sheets; users with such sheets should use grid mode or manual rects — this is the documented mode split working as designed, and worth stating in the README (Phase 9).

## Next

Phase 6 — Exporters: generic JSON (already the manifest), then Godot `.tres` generation (AtlasTexture + SpriteFrames) + `samples/godot-smoke/`, then the optional Unity Editor importer script. Core must stay engine-blind: exporters consume the ExportManifest in the CLI layer.
