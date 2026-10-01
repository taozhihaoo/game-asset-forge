# Real-world Fixtures — Provenance

The actual image files live in `fixtures-local/` (gitignored, never
committed — charter §24). This file records where they came from, who made
them, and under which license they may be used. Re-download them there if
missing.

| Local file (fixtures-local/) | Source | Author | License |
| --- | --- | --- | --- |
| `characters_7.png` (736×128) | https://opengameart.org/content/a-platformer-in-the-forest | Buch | CC0 |
| `sheet_9.png` (272×128) | https://opengameart.org/content/a-platformer-in-the-forest | Buch | CC0 |
| `swoosh_0.png` (128×32) | https://opengameart.org/content/a-platformer-in-the-forest | Buch | CC0 |
| `kenney_tiles_spritesheet.png` (914×936, packed sheet, ships with XML metadata) | https://opengameart.org/content/platformer-art-deluxe | Kenney (kenney.nl) | CC0 |
| `kenney_p1_spritesheet.png` (508×288, ships with XML metadata) | https://opengameart.org/content/platformer-art-deluxe | Kenney (kenney.nl) | CC0 |

All five are CC0 (public domain); attribution appreciated but not required.
License suitability was verified on the source pages on 2026-10-02.

## Running the real-world validation

```bash
npm test            # automatically picks up fixtures-local/ when present
```

`tests/real-fixtures.test.ts` skips when `fixtures-local/` is absent, so CI
(without the files) stays green — charter §24.
