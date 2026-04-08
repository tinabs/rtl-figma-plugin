# Qalb (قلب) — Figma Plugin Blueprint
### Version 1.0 | Internal Build | GCC Bilingual Design Teams

---

## 1. Project Overview

**Qalb** is a free internal Figma plugin that automates the conversion of LTR (English) designs to RTL (Arabic) for bilingual GCC product teams. It handles mirroring, translation, font-switching, and numeral conversion — eliminating the most painful manual work for non-Arabic and Arabic-speaking designers alike.

| | |
|---|---|
| **Target users** | ~30 designers, Arabic and non-Arabic speakers |
| **Use context** | Internal agency use first, potential public launch later |
| **Figma plans** | Pro (personal) + Organization |
| **Timeline** | V1 in 1 week |
| **Stack** | TypeScript + Figma Plugin API + MyMemory API (free, no key needed) |

---

## 2. Folder Structure

```
qalb-plugin/
├── manifest.json              # Figma plugin config
├── package.json
├── tsconfig.json
├── src/
│   ├── main.ts                # Plugin backend (runs in Figma sandbox)
│   ├── ui.html                # Plugin UI (single file: HTML + CSS + JS)
│   └── modules/
│       ├── mirror.ts          # Mirroring logic
│       ├── variants.ts        # RTL variant generator
│       ├── translate.ts       # Translation (MyMemory API, free, no key)
│       ├── fonts.ts           # Bulk font switcher
│       ├── numerals.ts        # Numeral conversion
│       └── utils.ts           # Shared helpers
├── dist/                      # Compiled output (auto-generated)
└── README.md
```

---

## 3. manifest.json

```json
{
  "name": "Qalb — RTL for Figma",
  "id": "qalb-rtl-plugin",
  "api": "1.0.0",
  "main": "dist/main.js",
  "ui": "src/ui.html",
  "editorType": ["figma"],
  "permissions": ["currentuser"]
}
```

---

## 4. Feature Specifications

---

### Feature 1: Mirror & Convert

**What it does:** Takes a selected frame, component, group, or component set and flips its layout to RTL — structurally, not just visually.

**What gets mirrored:**

| Element | What changes |
|---|---|
| Auto Layout frames | Direction flips: LEFT→RIGHT becomes RIGHT→LEFT |
| Padding | Left and right padding values swap |
| Absolute positioning | X position mirrors within parent bounds |
| Text layers | Alignment flips (left→right), direction set to RTL |
| Border radius | Corner values swap (top-left↔top-right, bottom-left↔bottom-right) |
| Stroke positions | Left/right strokes swap |
| Groups | Children repositioned within group bounds |
| Nested components | Recursively applied to all children |
| Component instances | Detached before mirroring (with warning shown to user) |

**What does NOT get mirrored:**
- Layers tagged/named with `[no-flip]` or `[logo]`
- Images (flipping photos/faces looks wrong)
- Ellipses and vector shapes (too risky without manual review)

**User flow:**
1. Designer selects one or more frames/components
2. Opens Qalb plugin
3. (Optional) Toggles **Convert Numerals** ON if Eastern Arabic numerals are needed
4. Clicks **"Mirror & Translate to AR"**
5. Plugin mirrors layout AND translates all text layers to Arabic (MSA) automatically
6. If numerals toggle is ON, converts all numbers to Eastern Arabic (١٢٣)
7. Plugin renames result with `_AR` suffix
8. Success message shows count of mirrored + translated layers

**Edge cases to handle:**
- Mixed selections (some RTL already)
- Components with no Auto Layout (use absolute position flip)
- Deeply nested components (warn user, offer to detach)

---

### Feature 2: RTL Variant Generator

**What it does:** From an existing LTR component, creates a new RTL variant within the same component set. Mirrors the layout AND translates all text to Arabic (MSA) automatically — same behaviour as Mirror & Translate.

**User flow:**
1. Designer selects a component or component set
2. Clicks **"Create RTL Variant"**
3. Plugin duplicates the component
4. Mirrors the duplicate (using Feature 1 logic)
5. Adds a new property `Direction=RTL` to the variant
6. Places variant alongside the LTR version in the component set

**Naming convention:**
- Original: `Button/Primary/Default`
- Generated: `Button/Primary/Default — Direction=RTL`

**Notes:**
- If the selected component is already inside a component set, the variant is added to that set
- If it's a standalone component, a new component set is created wrapping both

---

### Feature 3: Translation (MyMemory API — No Key Required)

**What it does:** Automatically translates all text layers as part of the Mirror and Create RTL Variant actions. Uses the free MyMemory API — no API key, no setup, no cost for the designer.

**Translation behaviour:**
- Triggered automatically when Mirror or Create RTL Variant is run
- Default language: **Modern Standard Arabic (MSA)** — safe for all GCC markets
- 1,000 free requests/day (more than enough for a 30-person team)
- Preserves placeholders like `{name}`, `{{count}}`, `%s`
- Does not translate proper nouns or all-caps strings (treated as labels/codes)

**Numeral conversion (separate toggle, OFF by default):**
- OFF → keeps Western numerals: 123
- ON → converts to Eastern Arabic numerals: ١٢٣
- Applied after translation, in the plugin (not via API)

```typescript
const toEasternArabic = (str: string): string =>
  str.replace(/[0-9]/g, d => String.fromCharCode(d.charCodeAt(0) + 0x0630));
```

**API call (no key needed):**
```typescript
const translate = async (text: string): Promise<string> => {
  const url = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(text)}&langpair=en|ar`;
  const res = await fetch(url);
  const data = await res.json();
  return data.responseData.translatedText;
};
```

**Batching strategy:** Collect all text layers in the selection first, then translate one by one (MyMemory doesn't support batch calls). Show a progress indicator for large selections.

**Future upgrade path:** If the team needs more requests or dialect support, the translate module can be swapped to OpenAI with minimal changes — the rest of the plugin stays the same.

---

### Feature 4: Bulk Font Switcher

**What it does:** Replaces all fonts in a selection with a chosen Arabic font.

**User flow:**
1. Designer selects a frame
2. Opens Font tab in Qalb
3. Sees a list of all fonts currently used in the selection
4. For each font, a dropdown appears to map it to a replacement Arabic font
5. Default suggestion: **Cairo** (for any unmapped font)
6. Click **"Apply Fonts"**
7. All matching text layers updated

**Common Arabic fonts to offer as defaults:**
- Cairo
- Almarai
- Tajawal
- Noto Sans Arabic
- IBM Plex Arabic
- Rubik (has Arabic support)

**Note:** Plugin can only apply fonts that are already installed in the user's Figma. If a font isn't available, show a warning: *"Cairo is not installed. Please add it via Google Fonts."*

---

### Feature 5: No-Flip Layer Locking

**What it does:** Lets designers mark specific layers to be excluded from mirroring (logos, faces, photos, badges).

**User flow:**
1. Designer selects a layer
2. Clicks **"Lock from Flip"** in Qalb
3. Plugin renames layer by appending `[no-flip]` to its name
4. Layer is skipped during all mirror operations
5. Designer can unlock via **"Unlock Flip"** button

**Implementation:**
```typescript
// Tag a layer
node.name = node.name + " [no-flip]";

// Check during mirroring
if (node.name.includes("[no-flip]")) return; // skip
```

---

## 5. Plugin UI Design

### Layout
Single panel, ~320px wide. Tab navigation at the top.

```
┌─────────────────────────────────┐
│  🔄 Qalb  قلب           ⚙️     │
├─────────────────────────────────┤
│  [Mirror] [Translate] [Fonts]   │  ← tab bar
├─────────────────────────────────┤
│                                 │
│   [TAB CONTENT AREA]            │
│                                 │
│                                 │
│                                 │
├─────────────────────────────────┤
│  ✅ 3 layers mirrored           │  ← status bar
└─────────────────────────────────┘
```

### Mirror Tab
```
┌─────────────────────────────────┐
│  Selection: 2 frames            │
│                                 │
│  [🔄 Mirror & Translate to AR]  │  ← mirrors + translates in one click
│                                 │
│  [✨ Create RTL Variant]        │  ← also mirrors + translates
│                                 │
│  ─────────────────────────────  │
│  Arabic Numerals   ١٢٣          │
│  Convert numbers  [  OFF  ]     │  ← toggle, OFF by default
│  ─────────────────────────────  │
│                                 │
│  Selected layer: "Logo"         │
│  [🔒 Lock from Flip]            │
└─────────────────────────────────┘
```

### Translate Tab
_Translation is now built into the Mirror tab. This tab is reserved for V2 features: manual translation of a selection, dialect switching, and language selection._

### Settings (⚙️ icon)
```
┌─────────────────────────────────┐
│  Default Numeral Format         │
│  (●) Western  123               │
│  ( ) Eastern  ١٢٣               │
│                                 │
│  About Qalb v1.0                │
│  Built for [Agency Name]        │
│  Translation: MyMemory (free)   │
└─────────────────────────────────┘
```

---

## 6. Technical Architecture

### Communication Pattern
Figma plugins have two separate environments:
- **`main.ts`** — runs in Figma's sandbox (has access to the document)
- **`ui.html`** — runs in an iframe (has access to the internet / APIs)

They communicate via `postMessage`:

```typescript
// From UI → main
parent.postMessage({ pluginMessage: { type: 'MIRROR', nodeIds: [...] } }, '*');

// From main → UI
figma.ui.postMessage({ type: 'MIRROR_DONE', count: 3 });
```

### Message Types

| Message | Direction | Payload |
|---|---|---|
| `MIRROR_AND_TRANSLATE` | UI → Main | `{ nodeIds: string[], convertNumerals: boolean }` |
| `CREATE_VARIANT` | UI → Main | `{ nodeId: string, convertNumerals: boolean }` |
| `GET_FONTS` | UI → Main | `{ nodeIds: string[] }` |
| `APPLY_FONTS` | UI → Main | `{ mappings: {from, to}[] }` |
| `LOCK_FLIP` | UI → Main | `{ nodeId: string }` |
| `UNLOCK_FLIP` | UI → Main | `{ nodeId: string }` |
| `DONE` | Main → UI | `{ message: string, count?: number }` |
| `ERROR` | Main → UI | `{ message: string }` |
| `TEXT_LAYERS` | Main → UI | `{ layers: {id, text, font}[] }` |

### No API Key Needed
Translation uses the free MyMemory API — called directly from `ui.html` (which has internet access). No key, no setup, no cost for designers.

---

## 7. Core Mirroring Algorithm

```typescript
async function mirrorNode(node: SceneNode, parentWidth: number) {
  
  // Skip locked layers
  if (node.name.includes('[no-flip]')) return;

  // 1. Mirror absolute position within parent
  if ('x' in node && parentWidth > 0) {
    node.x = parentWidth - node.x - node.width;
  }

  // 2. Flip Auto Layout direction
  if (node.type === 'FRAME' && node.layoutMode !== 'NONE') {
    if (node.layoutMode === 'HORIZONTAL') {
      node.layoutMode = 'HORIZONTAL'; // stays horizontal
      // Reverse children order
      const children = [...node.children].reverse();
      children.forEach((child, i) => node.insertChild(i, child));
    }
    // Swap padding
    const tmp = node.paddingLeft;
    node.paddingLeft = node.paddingRight;
    node.paddingRight = tmp;
  }

  // 3. Flip text alignment
  if (node.type === 'TEXT') {
    if (node.textAlignHorizontal === 'LEFT') {
      node.textAlignHorizontal = 'RIGHT';
    } else if (node.textAlignHorizontal === 'RIGHT') {
      node.textAlignHorizontal = 'LEFT';
    }
  }

  // 4. Flip border radius
  if ('topLeftRadius' in node) {
    const tl = node.topLeftRadius;
    const tr = node.topRightRadius;
    const bl = node.bottomLeftRadius;
    const br = node.bottomRightRadius;
    node.topLeftRadius = tr;
    node.topRightRadius = tl;
    node.bottomLeftRadius = br;
    node.bottomRightRadius = bl;
  }

  // 5. Recurse into children
  if ('children' in node) {
    for (const child of node.children) {
      await mirrorNode(child, node.width);
    }
  }
}
```

---

## 8. Setup & Development Workflow

### Prerequisites
- Node.js (v18+)
- A Figma account (Pro or Org)
- No API keys needed for V1

### Initial Setup
```bash
# 1. Create project
mkdir qalb-plugin && cd qalb-plugin
npm init -y

# 2. Install dependencies
npm install --save-dev typescript @figma/plugin-typings

# 3. Initialize TypeScript
npx tsc --init

# 4. Build
npx tsc --watch
```

### tsconfig.json
```json
{
  "compilerOptions": {
    "target": "ES6",
    "lib": ["ES6"],
    "strict": true,
    "outDir": "./dist",
    "typeRoots": ["./node_modules/@figma/plugin-typings"]
  },
  "include": ["src/**/*.ts"]
}
```

### Loading in Figma (Development Mode)
1. Open Figma desktop app
2. Go to **Plugins → Development → Import plugin from manifest**
3. Select your `manifest.json`
4. Plugin now appears under **Development** in the plugins menu
5. Every time you rebuild (`npx tsc`), reload the plugin in Figma

---

## 9. Development Phases (1-Week Plan)

### Day 1 — Scaffold & Mirror ✅ DONE
- Set up project structure, TypeScript, manifest
- Built plugin UI shell: header, tab bar (Mirror / Fonts / Settings), status bar
- Implemented Feature 1: Mirror & Convert (core logic)
- Tested with simple frames

### Day 2 — Mirror Polish + Variant Generator ✅ DONE
- Added safe async font loading (`preloadFonts`) — avoids crash on `insertChild` with unloaded fonts
- Added font failure tracking: warns user which fonts are missing, skips those frames for reordering
- Skips image-filled rectangles, vectors, ellipses, stars, polygons from mirroring
- Correctly handles AL vs. non-AL children for absolute position flip
- Added stroke weight swap (left ↔ right) — not in original spec but needed
- Implemented Feature 2: RTL Variant Generator (clone → mirror → name → add to set)
- Refactored to use async Figma node API (`getNodeByIdAsync`)
- Merged via PR #1 from `day2-plugin` into `main`

### Day 3 — Translation + Numerals ✅ DONE (shipped with Day 2)
- Translation via MyMemory API wired into Mirror and Create RTL Variant flows
- Progress bar in UI during translation
- Skips all-caps short strings (labels/codes)
- Numeral conversion toggle (OFF by default) applied after translation

### Day 4 — Fonts + Numerals ✅ DONE (shipped with Day 2)
- Bulk Font Switcher: scan selection → dropdown per font → apply
- Font style fallback: tries same style first, then Regular, then Bold
- Numeral conversion fully wired end-to-end

### Day 5 — No-Flip Locking + UI Polish ✅ DONE (shipped with Day 2)
- Lock from Flip / Unlock buttons in Mirror tab
- Full UI polish: progress bar, color-coded status bar, disabled states, settings panel

### Day 6 — Real File Testing ⬅ CURRENT
- Load actual project files from your team
- Test all features together
- Fix bugs, edge cases

### Day 7 — Team Handoff
- Write a simple README for your team
- Share plugin via Figma's developer mode (no publishing needed for internal)
- Gather first feedback

---

## 10. How to Use Claude Code

Since you're building this entirely with Claude Code, here's how to work effectively:

**Starting a session:**
> "I'm building a Figma plugin called Qalb. Here is my blueprint: [paste relevant section]. Let's start with Day 1: setting up the project and implementing the mirror feature."

**When stuck:**
> "Here's my current main.ts: [paste code]. The padding flip isn't working for nested Auto Layout frames. Here's what I expect vs. what's happening: [describe]."

**For each new feature:**
> "The mirror feature works. Now let's implement Feature 3: AI Translation. Here's the spec: [paste Feature 3 section from this doc]."

**Golden rule:** Give Claude Code one feature at a time. Don't try to build everything in one prompt.

---

## 11. Risks & Mitigations

| Risk | Likelihood | Mitigation |
|---|---|---|
| Figma API doesn't allow detaching components automatically | Medium | Warn user, offer manual detach option |
| MyMemory daily limit (1000 req) hit by team | Low | Requests are per-IP; spread across 30 designers it's very unlikely |
| MyMemory translation quality for UI strings | Medium | Test early; upgrade path to OpenAI ready if needed |
| Arabic font not installed on designer's machine | High | Show clear warning with Google Fonts install link |
| Mirroring breaks complex nested components | Medium | Add undo support, show layer count before applying |
| Plugin works on Pro but not Org plan | Low | Test on both early |
| Week timeline too tight for all features | Medium | Mirror + Translate = MVP; Fonts + Variants = stretch |

---

## 12. Future Roadmap (Post V1)

- **Halal content filter** on translations
- **Smart icon detection** (auto-skip logos/photos from flipping)
- **Shared team API key** (hosted, no per-designer setup)
- **RTL preview mode** (toggle LTR/RTL without permanent changes)
- **Figma Community public launch**
- **Support for Hebrew and Persian** (already handled by same logic)
- **Design token awareness** (respect semantic spacing tokens)
- **Batch processing** (process entire page at once)

---

## 13. Claude Code Starter Prompt

Copy and paste this exactly when you open Claude Code for the first time:

---

> I'm building a Figma plugin called **Qalb** (قلب) — a free RTL design tool for a GCC-focused agency. I have no coding experience and will rely on you entirely. Here is the full context:
>
> **What the plugin does:**
> - Mirrors LTR frames/components to RTL (flips Auto Layout, padding, text alignment, border radius, absolute positions)
> - Automatically translates all text layers to Arabic (MSA) using the free MyMemory API (no key needed) as part of the mirror action
> - Has a toggle (OFF by default) to convert Western numerals (123) to Eastern Arabic (١٢٣)
> - Creates RTL variants from existing LTR components (same mirror + translate behaviour)
> - Lets designers lock specific layers from flipping using a "Lock from Flip" button (appends `[no-flip]` to layer name)
> - Has a Bulk Font Switcher tab to replace fonts across a selection (default: Cairo)
>
> **Tech stack:** TypeScript + Figma Plugin API + MyMemory API (free, no key)
>
> **Today's goal — Day 1:**
> 1. Set up the full project scaffold: `manifest.json`, `package.json`, `tsconfig.json`, `src/main.ts`, `src/ui.html`
> 2. Build the plugin UI shell: header with Qalb branding, tab bar (Mirror / Fonts), status bar
> 3. Implement the Mirror tab UI: "Mirror & Translate to AR" button, "Create RTL Variant" button, numeral toggle (OFF by default), "Lock from Flip" button
> 4. Implement the core mirroring logic in `main.ts`: flip Auto Layout direction, swap padding, flip text alignment, flip border radius, mirror absolute positions, recurse into children, skip layers named `[no-flip]`
>
> Please generate all files completely, ready to run. After each file, explain in one sentence what it does. Start with the scaffold.

---

**For each following day**, start your Claude Code session with:
> "Qalb plugin — Day [X]. Yesterday we finished [what worked]. Today's goal: [paste the relevant day from Section 9]. Here's my current `main.ts`: [paste code]."

**Golden rule:** One day, one feature. Never paste the whole blueprint at once.

---

*Blueprint version 1.2 — Updated 2026-04-07: Days 1–5 complete, all 5 features shipped. Currently on Day 6 (real file testing). Branch: main (merged from day2-plugin via PR #1).*
*Plugin name shortlist: Qalb · Maqlub · Wijha*
