# Qalb (قلب) — Claude Code Context

## What this project is

A Figma plugin that converts LTR (English) designs to RTL (Arabic) for GCC bilingual design teams (~30 designers). Internal use first, potential public launch later. Free, no API keys required.

**Full spec:** See [Qalb-Plugin-Blueprint.md](Qalb-Plugin-Blueprint.md)

---

## Current status (as of 2026-04-07)

All 5 features shipped. On main branch. Currently in Day 6 — real file testing.

| Feature | Status |
|---|---|
| Mirror & Convert | Done |
| RTL Variant Generator | Done |
| Translation (MyMemory API) | Done |
| Bulk Font Switcher | Done |
| No-Flip Layer Locking | Done |

---

## File layout

```
src/
  main.ts     — Plugin backend (Figma sandbox, no internet access)
  ui.html     — Plugin UI + all JS inline (iframe, has internet access)
dist/         — Compiled output from tsc (do not edit)
manifest.json — Figma plugin config
```

No modules folder yet — all logic is in `main.ts` and `ui.html` directly.

---

## Architecture

Two separate JS environments that communicate via `postMessage`:

- **`main.ts`** — has access to the Figma document. No `fetch`. Compiled by `tsc`.
- **`ui.html`** — has internet access (calls MyMemory API). No Figma document access.

Key message flow for Mirror & Translate:
1. UI sends `MIRROR_AND_TRANSLATE` → main.ts mirrors nodes, collects text layers
2. main.ts sends `TEXT_LAYERS` back → ui.html calls MyMemory API per layer
3. ui.html sends `APPLY_TRANSLATIONS` → main.ts writes translated text back to nodes
4. main.ts sends `DONE` → ui.html shows success

---

## Key decisions & constraints

- **Font loading:** All fonts in a frame must be loaded with `figma.loadFontAsync()` before calling `insertChild()` — otherwise Figma throws. We preload all fonts upfront via `preloadFonts()`. Missing fonts are skipped and warned.
- **Async node API:** Always use `figma.getNodeByIdAsync()` (not deprecated sync version).
- **Instance detaching:** Component instances are detached before mirroring. User is warned.
- **Image fills / vectors:** Rectangles with image fills, vectors, ellipses, stars, polygons are skipped entirely — unsafe to flip.
- **`[no-flip]` / `[logo]` tags:** Layer names containing these strings are skipped at every recursion level.
- **Absolute position mirroring:** Only applied to non-Auto-Layout children. Auto Layout children skip the `x` flip — their position is managed by the parent frame.
- **Padding swap:** Only swapped for horizontal AL frames if child reordering succeeded. For vertical AL and non-AL frames, always swapped.
- **Translation API:** MyMemory free tier, called from `ui.html`. No key, ~1000 req/day. Batched sequentially (no batch endpoint). Skips all-caps strings ≤10 chars (labels/codes).

---

## Dev workflow

```bash
# Build (watch mode)
npx tsc --watch

# Load in Figma desktop
# Plugins → Development → Import plugin from manifest → select manifest.json
# Reload plugin after each build
```

TypeScript target: ES6. Strict mode on. Output: `dist/`.

---

## What's left

- **Day 6:** Test with real project files from the team. Fix any bugs found.
- **Day 7:** Write team README, share via Figma developer mode, gather feedback.

---

## Figma Plugin API — documentation references

Always consult the official Figma Plugin docs when working on this plugin. These are the authoritative sources for APIs, node types, and manifest config.

| Resource | URL |
|---|---|
| Main Docs | https://figma.com/plugin-docs/ |
| API Reference | https://www.figma.com/plugin-docs/api/api-reference |
| Plugin Manifest | https://www.figma.com/plugin-docs/manifest |
| Quickstart Guide | https://www.figma.com/plugin-docs/plugin-quickstart-guide |
| Node Types | https://www.figma.com/plugin-docs/api/nodes |
| TypeScript Support | https://www.figma.com/plugin-docs/typescript/ |

When writing or suggesting code that uses the Figma Plugin API:
- Verify method signatures and properties against the API reference
- Use the correct node types as documented under Node Types
- Ensure `manifest.json` fields comply with the Plugin Manifest spec
- Leverage TypeScript typings as described in the TypeScript support page

---

## Things to avoid

- Do not call `figma.getNodeById()` (sync, deprecated) — use `getNodeByIdAsync()`.
- Do not call `insertChild()` without loading fonts first — it will throw.
- Do not add batch translation — MyMemory has no batch endpoint.
- Do not flip images, vectors, ellipses, stars, or polygons.
- Do not reuse nodeIds across plugin sessions — they are session-specific.
