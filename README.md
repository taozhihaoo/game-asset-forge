# GameAsset Forge

A local-first, deterministic 2D game asset preparation pipeline.
Turn raw PNG sprite sheets into game-ready atlases + metadata + Godot
resources — repeatably, offline, with zero AI.

```text
sheet.png → detect → trim → resize → bleed/padding → pivot → atlas → export
                 → atlas-N.png + atlas.json (+ Godot .tres / Unity importer)
```

## Why

Hand-processing sprite sheets (slicing, trimming, padding, packing, writing
engine metadata) is repetitive, error-prone, and different every time a new
asset pack arrives. GameAsset Forge turns that work into a **repeatable,
preset-driven pipeline**: same input + same preset = byte-identical output.

## Features

- Sprite sheet auto-splitting: alpha connected-components, uniform grid, or
  manual rectangles (manual fallback is a designed path, not an error)
- Trim, alpha thresholds, resize (nearest/linear), padding, edge bleed
- Pivot calculation (center / bottom-center / manual), normalized to content
- Deterministic MaxRects atlas packing with multi-page output
- Presets: a saved instance of the pipeline, shared by CLI and GUI
- Godot 4 `SpriteFrames .tres` export and a generated Unity Editor importer
- CLI (`init / inspect / validate / process / batch`) + desktop GUI preview

## V1 Scope

Implemented (see `docs/phase-*-report.md` for the full evidence trail):

sprite detection (3 modes) · trim · resize · padding/bleed · pivot ·
deterministic atlas (MaxRects) · batch + presets + CLI · GUI preview with
manual rect editor · Godot export · Unity importer script · generic JSON
manifest · 129 tests incl. golden fixtures and 5 real-world CC0 sheets.

Not in V1: character layering, rigging, skeletal animation, Spine export,
AI features (all backlog; see Roadmap).

## Architecture

npm-workspaces monorepo (TypeScript strict, ESM):

```
packages/core  pure, IO-free pipeline (detect/trim/resize/bleed/pivot/pack/manifest)
packages/cli   filesystem + PNG codec + commands (the first core consumer)
packages/gui   Electron shell (main/preload/renderer) over the same core
schemas/       preset JSON schema (documentation contract, draft-07)
```

Rule (enforced by lint): core knows nothing about Electron, PixiJS, Node,
or the filesystem — same preset + same input = same core output, from CLI
or GUI. Details in `docs/architecture.md`.

## Installation

```bash
npm install
npm run build
```

## CLI

```bash
npm run cli -- init                          # writes a default preset.json
npm run cli -- inspect assets/player.png     # analyze without exporting
npm run cli -- validate preset.json          # validate a preset only
npm run cli -- process assets/player.png -p preset.json -o out/
npm run cli -- batch assets/ -p preset.json -o out/          # recursive
npm run cli -- batch assets/ -p preset.json -o out/ --no-recursive -e "**/output/**"
```

Exit codes: 0 success · 1 processing failure · 2 invalid input/preset/usage.
Batch writes `summary.json` (total / succeeded / failed / duration / errors).

## GUI

```bash
npm run dev -w @gameasset-forge/gui
```

Drop PNG files, inspect detected rects, tweak the pipeline, draw manual
rects, preview the atlas (Before/After, page switching), then Export.
GUI and CLI consume the same preset and produce identical manifests
(`tests/gui-core-consistency.test.ts`).

## Presets

A preset is a saved instance of the pipeline (schemaVersion 1; see
`schemas/preset.schema.json`):

```json
{
  "schemaVersion": 1,
  "detect": { "mode": "alpha-connected-components", "alphaThreshold": 8 },
  "trim": { "enabled": true },
  "resize": { "enabled": false, "scale": 2, "filter": "nearest" },
  "padding": { "pixels": 2 },
  "bleed": { "pixels": 2 },
  "pivot": { "mode": "bottom-center" },
  "atlas": { "maxWidth": 2048, "maxHeight": 2048, "algorithm": "maxrects", "spacing": 2 },
  "output": { "format": ["png", "json"], "godot": { "enabled": true } }
}
```

## Image Detection

- **alpha-connected-components** (default): foreground = alpha ≥ threshold;
  8-connectivity labeling; min-pixels filter; deterministic ordering.
- **grid**: rows+columns or cellWidth+cellHeight; remainder strips ignored;
  empty cells dropped.
- **manual**: user rectangles, bounds-checked; the designed fallback when
  automatic detection fails.

RGB PNGs (no alpha) work with grid/manual; alpha-CC reports a clear error.

## Atlas Packing

MaxRects (Best-Short-Side-Fit), one stable deterministic variant: sprites
place in input order, ties resolve to the earliest free rect, no hash-order
influence. Padding/bleed are baked into each packed cell; `spacing` is the
gap between cells. Pages are trimmed to their used extent; overflow opens a
new page automatically. Same input + preset ⇒ identical placement, manifest,
page count.

## Pivot

Normalized [0,1] against the trimmed (content) rect, top-left origin.
`center` = 0.5/0.5, `bottom-center` = 0.5/1.0, or manual override.
Engine exporters convert to engine conventions; core stays engine-blind.

## Godot Export

With `output.godot.enabled`: exports `atlas-N.png` + `atlas.json` +
`<name>_spriteframes.tres` (SpriteFrames resource, one "default" animation,
5 fps). See `samples/godot-smoke/` — `npm run sample:godot`, then verify
either headless (`godot --headless --path samples/godot-smoke --import` +
`--script res://test_smoke.gd`; verified against Godot 4.7.2, animation
frames advance) or visually (open the folder in the Godot editor, Play).

## Unity Export

With `output.unity.enabled`: exports the atlas + JSON + a generated
`GameAssetForgeImporter.cs` Editor script that slices the atlas via
`TextureImporter` (built-in JsonUtility, no extra packages). Static
validation only — runtime verification requires Unity.

## Testing

129 tests: core unit (pure, in-memory), CLI integration (tmp dirs, real
process spawns), golden fixtures (7 synthetic deterministic sheets),
GUI/Core/CLI consistency, real-world fixtures (5 CC0 sheets from
OpenGameArt — auto-skip when `fixtures-local/` is absent).

```bash
npm test                 # builds first, then runs everything
UPDATE_GOLDENS=1 npm test            # regenerate golden files deliberately
GAF_WRITE_REAL_RESULTS=1 npm test    # write docs/phase-5-real-results.json
```

## Real-world Fixtures

Lives in gitignored `fixtures-local/`; provenance + licenses in
`samples/README.md` (all CC0). Never commit unlicensed assets.

## Limitations

- PNG input only (no JPG/WebP background keying yet)
- Packed sheets with touching sprites merge under connected-components —
  use grid/manual modes for those
- Atlas pages are used-extent, not power-of-two
- Unity importer is statically validated; Godot smoke test needs Godot 4.2+
  installed locally
- GUI exports the active source; multi-source batch stays in the CLI for now

## Roadmap

V2: character cutout/rigging (limited deformation) · V3: local AI assist
(segmentation suggestions, human confirms) · V4: optional generative pack.
Spine export pending a written licensing check with Esoteric Software
before any public release.

## AI Independence

Core asset processing is deterministic and offline. AI is not required for
sprite detection, trimming, atlas packing, pivot calculation, resize, or
export. **V1 does not use AI.** Future AI-assisted features may be added
later, but they are not part of V1.

## License

MIT (code). Fixture provenance and licenses: see `samples/README.md`.
