# Security Policy

This document is written in English and applies to all versions of GameAsset
Forge. The license text in [LICENSE](LICENSE) is likewise maintained in English
only.

## Supported Versions

| Version | Supported |
| ------- | --------- |
| `0.1.x` | Yes       |
| `< 0.1` | No        |

Security fixes are delivered on the current release line. There is no
long-term support branch yet.

## Reporting a Vulnerability

Please **do not open a public issue** for a suspected vulnerability. Use the
repository's private vulnerability reporting (GitHub Security Advisories →
"Report a vulnerability"), or contact the maintainers privately through the
repository's security contact.

Include, where possible:

- the affected version and operating system,
- the component (`packages/core`, `packages/cli`, `packages/ai`, `packages/gui`),
- a minimal reproduction (a PNG fixture plus a preset is ideal),
- the observed impact and any suggested mitigation.

We aim to acknowledge a report within **5 business days** and to ship a fix or
a documented mitigation within **30 days** for confirmed issues. If a report is
out of scope, we will say so and explain why.

## Threat Model and Defaults

GameAsset Forge is a **local-first desktop tool**:

- The deterministic pipeline (detection, trim, resize, bleed, padding, pivot,
  atlas packing, manifest, Godot/Unity export) performs **no network I/O** and
  collects no telemetry.
- The GUI renderer runs with `contextIsolation: true` and
  `nodeIntegration: false`. All filesystem access and native dialogs go
  through the narrow `window.forge` preload bridge; renderer code never
  receives a raw `ipcRenderer`.
- Generated HTML quality reports escape all interpolated values before
  rendering them into the document.
- AI assistance is **off by default**. Without an `ai.config.json`, only the
  built-in `mock` provider runs — deterministic, local and network-free.
- The `openai` provider is the only path that uploads image data to a
  third-party service. It requires an explicit `enabled: true` plus an API key
  **environment variable**; keys are never written into presets, manifests or
  logs. Enable it only after reading the privacy notice in the AI Assistant
  page.

## Out of Scope

- Vulnerabilities in third-party engines or tools (Godot, Unity) that consume
  our exported artifacts.
- Issues that require an attacker to already have local code execution or
  physical access to the machine.
- Denial of service caused by intentionally malformed, extremely large input
  images on a machine the attacker already controls.

## Dependency Handling

Dependencies are pinned through `package-lock.json` and installed with
`npm ci` in CI. Please include the lockfile state when reporting a
dependency-related issue. Do not commit real-world art assets without a
verified license; fixture provenance is documented in `samples/README.md`.
