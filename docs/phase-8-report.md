# Phase 8 Report — GUI / Core Consistency

Date: 2026-10-02

## Changed

- `tests/gui-core-consistency.test.ts` — the charter §26 integration test:
  - **CLI path**: spawn the built CLI (`process sheet.png -p preset.json -o out-cli`) on a synthetic sheet + preset file.
  - **GUI path**: the renderer's exact code sequence — `parsePreset(JSON.parse(presetBytes))` → `runPipeline(decode(bytes))` → manifest; plus the GUI save/load roundtrip (`serializePreset` → `parsePreset` → rerun).
  - Asserts the GUI manifest **equals** the CLI `atlas.json`, and that save/load preserves semantics (`schemaVersion` first key, manifest stable through reload).
  - Manual-fallback path: a GUI-style manual-mode pipeline serializes to a preset the CLI accepts and executes; both paths produce identical manifests (DoD [13][14] evidence at the logic level; interactive GUI session remains a manual step from Phase 7's PARTIAL note).
  - Input PNG built with an independent zlib encoder so input creation does not depend on the module under test; decode uses the CLI decoder.

## Tests

2 new tests (129 total, all passing).

Gates: `typecheck` ✓ · `test` ✓ 129/129 · `lint` ✓ · `build` ✓ · `format:check` ✓

## Result

**PASS**

## Regression

All prior suites unchanged and passing.

## Scope

Only the consistency test; no production code changed. No git commits (charter §1.20).

## Next

Phase 9 — CI workflow + README + architecture docs.
