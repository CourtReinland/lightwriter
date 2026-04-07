# LightWriter

A lightweight, client-side screenplay editor with story structure framework overlays, AI writing assistance, and industry-standard Fountain format support.

## Install — Mac App (Recommended)

The easiest way to use LightWriter on macOS is the native `.dmg` installer:

1. Download the latest `LightWriter-{version}.dmg` from the [Releases page](https://github.com/CourtReinland/lightwriter/releases)
   - **Apple Silicon (M1/M2/M3)**: `LightWriter-{version}-arm64.dmg`
   - **Intel Macs**: `LightWriter-{version}.dmg`
2. Open the `.dmg` file
3. Drag **LightWriter** to your **Applications** folder
4. Launch LightWriter from Applications or Spotlight

**First launch warning:** Because the app isn't signed with an Apple Developer certificate, macOS may say "LightWriter cannot be opened because the developer cannot be verified." To bypass this:

- Right-click (or Control-click) the LightWriter app in Applications
- Choose **Open** from the menu
- Click **Open** in the dialog that appears

You only need to do this once. After that, LightWriter launches normally.

Everything is bundled into the app — no Node.js, npm, or other dependencies needed. All your projects, knowledge bases, and settings are stored locally on your Mac.

## Run from Source (Developers)

```bash
git clone https://github.com/CourtReinland/lightwriter.git
cd lightwriter
npm install
npm run dev
```

Open `http://localhost:5173` in your browser.

## Build the Mac Installer Yourself

```bash
npm install
npm run build:mac
```

This produces `release/LightWriter-{version}-arm64.dmg` (Apple Silicon) and `release/LightWriter-{version}.dmg` (Intel) in the `release/` directory.

For a single-arch build:
```bash
npm run build:mac-arm   # Apple Silicon only
npm run build:mac-x64   # Intel only
```

## Build for the Web

```bash
npm run build
```

The `dist/` folder contains a static site deployable to any host (Vercel, Netlify, Cloudflare Pages, GitHub Pages, or just open `dist/index.html`).

## Features

### Fountain Editor
- Full Fountain screenplay format support with real-time syntax highlighting
- CodeMirror 6 editor with undo/redo (Cmd+Z / Ctrl+Z), search (Cmd+F), and line numbers
- Industry-standard screenplay layout: character names centered, dialogue in narrow column, transitions right-aligned, parentheticals indented
- Element bar for quick type switching: Scene, Action, Character, Dialogue, Parenthetical, Transition, Shot
- Follows Beat's forced-element conventions: `@` (Character), `!!` (Shot), `!` (Action), `.` (Scene), `>` (Transition)

### Framework Overlay HUD
The core differentiator. Set a target page count and toggle color-coded story structure overlays that show where beats should fall in your screenplay:

| Framework | Beats | Color |
|-----------|-------|-------|
| Joseph Campbell's Hero's Journey | 12 stages | Light Blue |
| Blake Snyder's Save the Cat | 15 beats | Dark Blue |
| Vladimir Propp's Morphology of the Folktale | 31 functions | Green |
| Aristotle's Poetics / 3-Act Structure | 11 beats | Red |

- Beat pills appear inline in the editor at calculated positions
- Hover any pill for a rich tooltip: description, page range, and real-world examples
- Multiple frameworks can be active simultaneously (colors stack)
- Beat Map legend in the sidebar shows all active beats sorted by page

### AI Writing Assistant (Grok)
Powered by xAI's Grok API with these modes:
- **Improve** — Sharpen dialogue for naturalness and character voice
- **Expand** — Add detail, atmosphere, and action lines
- **Compress** — Tighten content while preserving beats
- **Alt Lines** — Generate 3 alternative versions with different tones
- **Action** — Add vivid visual description around content
- **Fix Fmt** — Correct Fountain formatting errors
- **Custom Prompt** — Free-text: ask anything about the selected text

Suggestions can be applied as a replacement or inserted below the selection. LLM explanatory text is automatically stripped — only screenplay content is inserted.

### Views
- **Write** — The main editor with syntax highlighting, overlays, and element bar
- **Preview** — Formatted screenplay rendering matching industry print standards
- **Cards** — Index cards showing scenes in a grid with drag-and-drop reordering

### Import / Export
**Import:** `.fountain`, `.fdx` (Final Draft), `.celtx` — via the project menu (LW button)

**Export:** `.fountain`, `.fdx` (Final Draft XML), `.pdf` (print-to-PDF via browser) — via the Export dropdown

### Project Management
- Multiple projects stored in browser localStorage
- Auto-save (500ms debounce)
- Create, rename, delete, and switch between projects
- Import files directly into new projects

## Tech Stack

| Technology | Purpose |
|-----------|---------|
| React 19 | UI framework |
| TypeScript | Type safety |
| Vite 6 | Build tool and dev server |
| CodeMirror 6 | Text editor engine |
| fountain-js | Fountain format parser |
| xAI Grok API | AI writing suggestions |

No backend required. Everything runs client-side. API keys are stored locally in your browser.

## Project Structure

```
src/
├── main.tsx                          # React entry point
├── App.tsx                           # Root component, state orchestration
├── App.css                           # Global styles
│
├── codemirror/
│   ├── fountain-language.ts          # Fountain syntax tokenizer (StreamLanguage)
│   ├── fountain-theme.ts             # Editor theme and highlight colors
│   ├── overlay-decorations.ts        # Beat pill widgets and line decorations
│   └── screenplay-formatting.ts      # Auto-indentation by element type
│
├── components/
│   ├── Editor/
│   │   ├── FountainEditor.tsx        # CodeMirror instance wrapper
│   │   ├── EditorToolbar.tsx         # Top nav: tabs, export, page count
│   │   ├── ElementBar.tsx            # Element type switcher bar
│   │   └── ProjectMenu.tsx           # Project management modal
│   ├── Preview/
│   │   └── ScreenplayPreview.tsx     # Formatted screenplay HTML view
│   ├── IndexCards/
│   │   ├── IndexCardView.tsx         # Drag-and-drop scene card grid
│   │   └── IndexCard.tsx             # Individual scene card
│   ├── Overlays/
│   │   ├── FrameworkPanel.tsx        # Framework toggle buttons
│   │   └── OverlayLegend.tsx         # Active beats sorted by page
│   ├── Suggestions/
│   │   ├── SuggestionPanel.tsx       # AI sidebar with modes and custom prompt
│   │   ├── SuggestionCard.tsx        # Suggestion result with apply/insert
│   │   └── ApiKeyDialog.tsx          # Grok API key input modal
│   └── Layout/
│       └── ArtisticBorder.tsx        # Decorative mixed-media frame
│
├── frameworks/
│   ├── herosJourney.ts               # 12 stages with examples
│   ├── saveTheCat.ts                 # 15 beats with examples
│   ├── proppsFunctions.ts            # 31 functions with examples
│   ├── threeActStructure.ts          # 11 beats with examples
│   ├── types.ts                      # BeatDefinition, FrameworkDefinition
│   ├── utils.ts                      # computeBeatRanges(), estimatePages()
│   └── index.ts                      # Barrel exports, ALL_FRAMEWORKS array
│
├── services/
│   ├── grokService.ts                # Grok API client with response cleaning
│   ├── fountainExporter.ts           # Export to .fountain, .fdx, PDF
│   ├── fileImporter.ts               # Import from .fountain, .fdx, .celtx
│   └── storageService.ts             # localStorage project persistence
│
├── hooks/
│   ├── useFountainParser.ts          # Debounced Fountain parsing hook
│   └── useLocalStorage.ts            # Generic localStorage state hook
│
└── types/
    ├── editor.ts                     # EditorState, Project interfaces
    ├── fountain.ts                   # FountainToken, SceneInfo interfaces
    ├── frameworks.ts                 # Beat/framework type interfaces
    ├── fountain-js.d.ts              # fountain-js module declaration
    └── css.d.ts                      # CSS module type declaration
```

## How the Overlay System Works

1. Each framework defines beats as **percentage ranges** (e.g., Save the Cat's "Catalyst" = 10-13%)
2. You set a **target page count** (e.g., 120 pages for a feature film)
3. `computeBeatRanges()` converts percentages to **page numbers** and **editor line numbers**
4. Page estimation: **56 lines of Courier 12pt = 1 screenplay page**
5. CodeMirror decorations render overlays as:
   - Colored beat pills inline at beat start positions
   - Subtle line background tints for beat ranges
6. Multiple frameworks stack — each framework gets its own color

## Fountain Forced Elements

Following [Beat](https://github.com/lmparppei/Beat)'s conventions:

| Prefix | Element | Example |
|--------|---------|---------|
| `@` | Character | `@ALIYAH` |
| `!!` | Shot | `!!CU CLOSE UP ALIYAH` |
| `!` | Action | `!AIDEN is earnest...` |
| `.` | Scene Heading | `.INT. COFFEE SHOP` |
| `>` | Transition | `> CUT TO:` |

Prefixes are visible in the editor but automatically stripped in Preview and PDF output.

## API Key Setup

To use AI suggestions, you need an xAI API key:
1. Click the **AI** button in the toolbar
2. Click **Set Key** in the sidebar
3. Enter your xAI API key (starts with `xai-`)
4. Your key is stored locally in your browser — never sent anywhere except xAI's API

## License

MIT
