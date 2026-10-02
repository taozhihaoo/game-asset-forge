# V2 Phase 0 — Code Audit (Asset Quality Assistant)

Date: 2026-10-02 · Read-only audit per the V2 guidance doc; no code modified.

## A. 当前目录结构

```
packages/core/src/   types.ts errors.ts rect.ts preset.ts version.ts image.ts
                     detect.ts trim.ts resize.ts bleed.ts pivot.ts sprites.ts
                     atlas.ts manifest.ts pipeline.ts index.ts
packages/core/tests/ preset/errors/detect/imageops/atlas/pipeline/golden
                     (+ tests/goldens/*.json, tests/fixtures.ts, helpers.ts)
packages/cli/src/    png.ts glob.ts discover.ts output.ts commands/index.ts
                     exporters/{godot,unity}.ts main.ts
packages/cli/tests/  exporters.test.ts
packages/gui/src/    main.mts preload.ts shared.d.ts renderer/{app,state,
                     canvas,panels,decode,styles.css,index.html}
packages/gui/tests/  state.test.ts
schemas/             preset.schema.json (draft-07 documentation contract)
tests/               cli.integration / gui-core-consistency / real-fixtures
samples/             godot-smoke/ (+ provenance README)
scripts/             generate-godot-smoke.mjs verify-gui.mjs
docs/                phase-0..9 reports, final-audit, architecture (uncommitted)
```

## B. Core / CLI / GUI 分层

- **core**: pure, IO-free, zero runtime deps; lint-enforced ban on
  fs/path/process/network/electron/pixi (charter §1.10-12). Exports types,
  errors, preset contract, image ops, `runPipeline`.
- **cli**: fs + pngjs codec + commander; hosts engine exporters (godot/unity)
  consuming the generic manifest — the established home for output-format
  presentation code. **The V2 analyze command and HTML rendering belong here.**
- **gui**: Electron 38 three-process shell; renderer imports core directly;
  preload bridge is the only fs path. Quality page will consume the same
  core `analyze()`.

## C. Pipeline 数据流

bytes → decode → `RasterImage{format,hasAlpha,w,h,data}` → `parsePreset`
→ `runPipeline` → `{sprites, skipped, atlas, pages, manifest}` → encode.
Determinism contracts: stable ids, fixed sort tie-breaks, no timestamps;
GUI/CLI produce identical manifests (`tests/gui-core-consistency.test.ts`).

## D. Preset Schema 当前版本

`CURRENT_PRESET_SCHEMA_VERSION = 1`; validate→migrate→normalize chain;
migration registry currently `{1: identity}`; unknown keys rejected; the
V2 `quality` section therefore requires bumping to **schemaVersion 2** with
the first real migration — the exact exercise Phase 1 anticipated.

## E. 已存在测试

129 passing: core unit (preset 28, detect, imageops, atlas, pipeline,
errors), golden (7 committed fixtures + dir guard), CLI integration (spawns
real processes, exit codes), exporters, real-world (5 CC0 sheets, skip when
absent), GUI state unit, GUI/CLI/Core consistency.

## F. V2 最佳插入位置

- **core**: new `src/quality/` (models + rules + analyzer), pure functions
  over an explicit `AssetFile{name, raster, byteSize?, pivot?}` input;
  deterministic output ordering (fixed rule order, name sort).
- **preset**: optional `quality` section → schemaVersion 2 + migration.
- **cli**: `analyze` command (reuses discovery/glob), `quality_report.json`,
  HTML renderer (presentation stays out of core), byte-size enrichment.
- **gui**: third surface — Quality tab (list + severity + export), consuming
  the same `analyze()`; no canvas changes.

## G. 风险点

1. Duplicate near-detection is O(n²) pairwise on dHash — acceptable to
   ~1k assets; document the boundary.
2. Preset schema bump touches the most tested contract — migration must
   keep every existing v1 test passing unchanged.
3. Naming heuristics are opinionated by nature — patterns must be
   configurable with sane defaults (B6/amendment discipline).
4. KB "potential saving" claims need real file sizes — only the CLI has
   them; core uses optional `byteSize` when provided.
5. GUI tab restructure touches app.ts wiring — keep Pipeline view untouched
   to protect the verified GUI e2e path (scripts/verify-gui.mjs).
6. Report determinism: rule order frozen, no Map iteration in outputs.

**Result: audit complete — proceed to Phase 2.1.**
