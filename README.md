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

**First launch — important:** Because the app isn't signed with an Apple Developer certificate, macOS will block it. After dragging LightWriter to Applications, open Terminal and run:

```bash
xattr -cr /Applications/LightWriter.app
```

Then launch LightWriter normally from Applications or Spotlight. You only need to run the command once.

If you see "LightWriter is damaged and can't be opened" — the `xattr -cr` command above fixes this. It removes the macOS quarantine flag that's applied to unsigned apps downloaded from the internet.

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

### AI Writing Assistant (multi-provider)
LightWriter drives five text-AI providers — **xAI Grok, OpenAI, Anthropic Claude, OpenRouter, Kimi (Moonshot)** — in three roles: a **writer** (generation, re-rolls), an **analyst** (scoring, planning), and up to four parallel **rewrite engines**. Selection modes:
- **Improve / Expand / Compress / Alt Lines / Action / Shots / Fix Fmt / Custom Prompt** — targeted passes on the selected text
- **Smart Continue, Scene Builder, Character Voice, Critique, Plot Holes, Beat Check** — advanced tools
- **Re-roll** — regenerate the highlighted passage (or the whole script) as multiple takes, Midjourney-style

Whole-script tools: **Story Generator** (direct or plan-then-write long-form), **Expand Shots**, **Expand Descriptions**, **Clean Up**, **Fix Shot Lines**, and a deterministic **Formatting Correction** pass.

### The Writers' Room (flagship rewrite)
One click on the Script Report Card runs a staged, multi-model development pass modeled on a real writers' room:
1. **Showrunner memo** — theme, problems, sacred scenes, direction
2. **Break the story** — every engine pitches a beat-sheet board; a judge merges the strongest; the *outline* is scored and iterated (cheap, low-noise) before any pages are written
3. **Draft** — one writer voice scripts the board card-by-card; kept scenes are copied byte-exact
4. **Punch-up** — dialogue pass + continuity/cut pass on a second engine
5. **Table read** — coverage from a model that didn't write, with targeted fixes on flagged scenes only

### Inline diff review, cast lock, and re-roll
Every rewrite lands as an **inline diff overlay** directly in the editor — deletions struck through, additions highlighted, the document untouched and locked read-only until you click **Accept** (or **Reject**, **Compare next** to cycle takes, **↻ Re-roll** for a fresh take on the next installed engine — re-rolling just your selection, or the whole draft). A **cast lock** forbids every rewrite from inventing characters outside your script/KB/series cast, deterministically flags violators (⚠), and demotes them below clean takes. All AI output runs through a deterministic Fountain normalization pass so characters and dialogue always land in the correct screenplay slots.

The **Script Report Card** scores the draft against your active framework(s) plus style/character/pacing (median-of-N sampling, cached per content hash), with **Plan Fix** (strategy only) and **Rewrite w/ AI** (per-metric multi-engine rewrite) on every row. See `docs/AI-WRITING-GUIDE.md` for the full pipeline contract.

### Views
- **Write** — The main editor with syntax highlighting, overlays, and element bar
- **Preview** — Formatted screenplay rendering matching industry print standards
- **Cards** — Index cards showing scenes in a grid with drag-and-drop reordering

### Import / Export
**Import:** `.fountain`, `.fdx` (Final Draft), `.celtx` — via the project menu (LW button)

**Export:** `.fountain`, `.fdx` (Final Draft XML), `.pdf` (print-to-PDF via browser) — via the Export dropdown. AI Assets can also export a LightWriter-native package and a narrower ScriptToScreen manifest; see `docs/SCRIPT2SCREEN-HANDOFF.md` for the handoff contract.

### Project Management
- Multiple projects stored in browser localStorage
- Auto-save (500ms debounce)
- Create, rename, delete, and switch between projects
- Import files directly into new projects

### Series Bible (live two-way sync with ScriptToScreen)
When a script belongs to a series, LightWriter keeps the series' shared characters and
locations in sync with a **Series Bible** on disk (Mac app only — the browser build has
no file access):

```
~/Library/Application Support/SeriesBible/
├── index.json                 # {"version":1,"series":[{id,name,created_at,updated_at}]}
└── <series_id>/
    ├── bible.json             # characters{} / locations{} keyed by stable key
    └── assets/                # bible-owned copies of reference images (<stable_key><ext>)
```

- **Two-way & near-live** — assets tagged in ScriptToScreen appear in LightWriter's
  Knowledge Base within moments (an `fs.watch` on the series dir triggers a re-import),
  and world records edited here export back within ~2s of the change.
- **Merging** — per-record last-writer-wins by `updated_at` (ISO, second precision; ties
  keep the incumbent). `"deleted": true` tombstones win over older live data and are never
  resurrected by older records. Files are written atomically (tmp + rename) with an
  optimistic mtime check; on conflict the writer re-reads, re-merges, and retries once.
- **Stable keys** — LightWriter's `stsCharacterKey`/`stsLocationKey` ARE the bible keys
  for LW-originated records; ScriptToScreen keys look like `char_<slug>_<8hex>` /
  `loc_<slug>_<8hex>`. The bible series id is authoritative: LW-created series keep their
  id, and series created elsewhere are adopted into LightWriter's series list on import.
- **Toggle** — Settings → *Series Bible* → "Sync series bible (shared with ScriptToScreen)"
  (default ON).

See `docs/SCRIPT2SCREEN-HANDOFF.md` for the full contract.

## Tech Stack

| Technology | Purpose |
|-----------|---------|
| React 19 | UI framework |
| TypeScript | Type safety |
| Vite 6 | Build tool and dev server |
| CodeMirror 6 | Text editor engine |
| fountain-js | Fountain format parser |
| xAI Grok · OpenAI · Anthropic Claude · OpenRouter · Kimi | AI writing, rewriting, and scoring |

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
│   ├── inline-diff.ts                # Rewrite preview overlay (strikethrough + highlight)
│   ├── location-gutter.ts            # World-location gutter markers
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
├── services/                         # (key modules — see docs/FEATURES.md for the full map)
│   ├── textAiService.ts              # Multi-provider client (writer / analyst / engine seats)
│   ├── writersRoomService.ts         # Writers' Room pipeline (memo→board→draft→punch-up→table read)
│   ├── storyDoctorService.ts         # Closed-loop framework rewrite (restructure→re-score)
│   ├── multiProviderRewriteService.ts# Parallel engine fan-out + ranking
│   ├── scriptReportCardService.ts    # Scoring, rewrite prompts, parsing/validation
│   ├── castLockService.ts            # "No invented characters" prompt rule + detection
│   ├── inlineDiffService.ts          # Diff spans for the in-editor rewrite overlay
│   ├── fountainFormatCorrector.ts    # Deterministic Fountain reclassification
│   ├── worldStateService.ts          # Series, arcs, world characters/locations
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

To use AI features, add a key for at least one provider:
1. Click **Settings** in the toolbar (or **Set Text AI** in the AI panel)
2. Pick a provider — xAI Grok, OpenAI, Anthropic Claude, OpenRouter, or Kimi — and enter its API key; the model dropdown lists that provider's live models
3. Optionally set a separate **analyst** provider/model for scoring, and check up to four **rewrite engines** in the AI panel for parallel rewrites and the Writers' Room
4. Keys are stored locally — never sent anywhere except the provider's own API

More keyed providers = more seats in the Writers' Room (drafter, judge/punch-up, coverage) and more takes to compare on every rewrite.

## License

MIT
