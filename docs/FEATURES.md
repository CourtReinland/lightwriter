# LightWriter — Feature Guide (users & agents)

LightWriter is a React 19 + Vite + TypeScript **Electron** screenwriting app. All
state is local (localStorage + Electron disk for images); there is no backend.
This guide documents the AI generation, version history, export, and **World
State** features added recently, with code pointers so an agent can extend them.

- Build/typecheck: `npm run build` (runs `tsc -b && vite build`)
- Tests: `npm test` (vitest) — currently 255 passing
- Package the Mac app: `npm run build:mac-arm` → `release/mac-arm64/LightWriter.app`
  (ad‑hoc signed; reinstall by copying to `/Applications` and
  `codesign --force --deep --sign - /Applications/LightWriter.app`)

The right‑hand workspace is four mutually‑exclusive panels, left→right:
**Settings → AI → KB → Export** (toggled in `EditorToolbar.tsx`).

---

## 1. Text models: writer vs analyst

LightWriter splits two roles (Settings panel = `AssetPanel` mode `settings`):

- **Writer** — prose/scene generation. Default chosen via
  `getSelectedTextAiProviderSettings()`.
- **Analyst** — structure/scoring/parsing/planning. Optional override
  (`lw-text-ai-analyst`), falls back to the writer.
  `TextAiService.forAnalyst()` resolves it.

Providers (`textAiSettingsService.ts`): `grok`, `openai`, `claude`,
`openrouter`, `kimi`. All are OpenAI‑compatible except Claude (native Messages
API). Calls go through `TextAiService.complete(system, user, {temperature,
maxTokens, timeoutMs})` (`textAiService.ts`).

Recommended setup used in testing: **writer = OpenRouter `sao10k/l3.3-euryale-70b`**
(good prose, but a *compact* storyteller), **analyst = Grok `grok-4.x`** (good
structure). Key insight: SAO writes a complete story in ~5 pages and stops, so
length must come from **new planned beats**, never from re‑padding (see below).

---

## 2. Story Generator (AI tab)

Two modes, both in `SuggestionPanel.tsx` "Story Generator" section, inserting at
the cursor via `App.handleInsertGenerated` (which also seals a version
checkpoint).

### Direct (single call) — `promptGenerationService.generateFromPrompt`
One call to the writer with a brief + page/word target. Best for a single scene
or to see the writer's raw output. Token budget scales with target pages
(`tokenBudgetForPages`), 4‑min timeout.

### Plan‑then‑write (long‑form) — `planThenWriteService.generateLongScreenplay`
The default for long output. Two phases:
1. **Plan** (`planScreenplay`, analyst): returns a strict‑JSON beat outline
   (`{title, logline, characters[], beats[]}`). The prompt enforces continuity:
   chronological/causal beats, **characters meet exactly once**, structure beats
   map to *new* events (no "arrive+meet" then "settle‑in re‑meet").
2. **Write** (`writeFromPlan`, writer): drafts each beat in its own call,
   carrying KB + style + the full outline + a running synopsis + the tail of the
   text. The **first** beat introduces the cast; **later** beats use a
   continuation system prompt that forbids re‑introducing/re‑describing/re‑meeting
   established characters. Per‑beat retry + continue‑on‑failure so one flaky call
   never discards the draft; returns `{script, failedBeats}`.

Why: a single long call from a creative finetune repeats scenes to fill length.
Planning first makes length come from distinct new beats. This fixed a real
"scene 5 re‑introduces everyone" bug.

---

## 3. Deterministic formatting passes

No‑LLM, instant, preview‑before‑apply (review pane). In `SuggestionPanel.tsx`.

- **Fix Shot Lines** (`fountainShotNormalizer.normalizeShotLines`): re‑prefixes
  bare camera lines (WS/MS/CU/…) with `!!` so they don't land in the
  character/dialogue slot.
- **Formatting Correction** (`fountainFormatCorrector.correctFountainFormatting`):
  reclassifies every line by context (scene/shot/transition/character+dialogue/
  action); pulls dialogue up under cues; fixes transitions.
- **Auto‑clean on generation** (`generatedScriptCleanup.cleanupGeneratedScreenplay`):
  two safe parenthetical repairs (`.from inside` → `(from inside)`,
  `/agreeing)` → `(agreeing)`) + the full Formatting Correction pass. Applied
  automatically to all Story Generator output and to each expansion scene.

---

## 4. Rewrite stack (AI tab → Run Script Report Card)

Three tiers, all landing in the **inline diff overlay** (see §4c):

### 4a. The Writers' Room (primary button) — `writersRoomService.runWritersRoom`
Staged multi-model development pass; the report card's primary button runs it
on the weakest framework. Stages: **showrunner memo** (judge seat, JSON) →
**break the story** (every keyed engine pitches a beat-sheet board of scene
cards `{beat, slugline, keep|rework|new, intent, conflict, turn, characters,
pages}` in parallel; judge merges; the *outline* is scored by the analyst and
revised up to 3 rounds, target 85) → **draft** (one writer voice, card by card,
story-so-far carried; `keep` cards copy the original scene byte-exact,
occurrence-aware slugline resolution for repeated sluglines) → **punch-up**
(dialogue pass + continuity/cut pass on a second engine, truncation-guarded) →
**table read** (coverage from a seat that didn't write; drafter revises ≤4
flagged scenes only) → final report-card score. Seats: drafter = session
writer; judge/punch-up = Claude when keyed, else next engine; coverage = third
distinct engine. All completions injectable (`WritersRoomDeps`) for tests.

### 4b. Story Doctor / multi-engine rewrite — per-row "Rewrite w/ AI"
Framework metrics run `storyDoctorService.runStoryDoctor` **per engine in
parallel** (restructure → re-score → keep best, ≤4 passes, then
`expandToTargetIfNeeded` → plan-then-write expansion), ranked by final score.
Craft metrics (style/character/pacing) run `multiProviderRewriteService`
single-pass fan-out, scored (2 samples) and ranked.

### 4c. Inline diff review + cast lock
Every candidate shows as an in-editor overlay (`codemirror/inline-diff.ts`,
`inlineDiffService.ts`): deletions struck through, additions highlighted, the
document UNMUTATED and locked read-only (`EditorState.readOnly` — selection
still works) until **Accept**. The floating bar offers Accept / Reject /
Compare next / **↻ Re-roll** (a fresh take on the next installed engine —
selection-scoped when text is highlighted, whole-doc otherwise). `castLockService`
injects a hard "no invented characters" rule into every rewrite prompt (cast =
script cues ∪ KB ∪ series characters ∪ arcs) and deterministically flags
violating candidates (⚠, demoted). All rewrite output passes through
`cleanupGeneratedScreenplay` (full Fountain reclassification incl. "NAME:
dialogue" colon-cue splitting) with a validation fallback.

---

## 5. Version History (KB tab)

Per‑project snapshot log (`versionHistoryService.ts`, key `lw-history-{projectId}`).
Model: opening/importing = first `open` snapshot; continuous typing collapses
into one mutable `edit` snapshot; each AI‑tool apply seals an immutable `ai`
snapshot; after an AI commit, the next typing starts a fresh edit. Restore is
non‑destructive. Wired in `App.tsx` (autosave records edits; `handleAiCommit`
seals AI snapshots; `handleRestoreVersion`). UI: KB "Version History" section.

---

## 6. Export tab

`components/Export/ExportPanel.tsx`. Sections:
- **Script**: `.fountain`, `.fdx`, `.txt`, `.pdf` (`fountainExporter.ts`).
- **Images**: download all scene backgrounds / character portraits (resolves
  `imageDataUrl` or `loadPersistedImageDataUrl(filePath)`).
- **ScriptToScreen**: **STS manifest JSON** + **LightWriter package JSON**
  (`assetManifestExporter.ts`). See `docs/SCRIPT2SCREEN-HANDOFF.md` for the full
  schema and the World State additions.

---

## 7. World State — portable, series‑scoped locations

The headline feature: locations that persist **across scripts** grouped into a
named **Series**, so the family kitchen in episode 1 is the *same* location —
same reference image and same stable ScriptToScreen key — in episode 2.

Service: `worldStateService.ts`. Component: `KnowledgeBase/WorldSection.tsx`
(in the KB "World / Series" section) + `Editor/LocationBar.tsx`.

### Data model
- **Series** `{id, name, …}` — localStorage `lw-series`.
- **WorldLocation** `{id, seriesId, name, aliases[], category, description,
  referenceImageDataUrl?, referenceFilePath?, stsLocationKey, …}` — localStorage
  `lw-world-locations` (all series; filter by `seriesId`). `stsLocationKey` is the
  **stable cross‑script identity** carried into export.
- A `Project` opts in via `Project.seriesId` (`storageService.ts`).
- **Per‑script bindings** `{ [sceneIndex]: locationId }` — localStorage
  `lw-scene-locations-{projectId}`. An explicit binding overrides alias matching.

### How a scene resolves to a location
`WorldStateService.resolveLocationForScene(projectId, seriesId, sceneIndex,
heading)`: explicit binding first, else best **alias match**
(`matchForHeading` → `matchLocations` over `extractLocationToken(heading)`).
Aliases (e.g. `KITCHEN`, `FAMILY KITCHEN`) are how a heading token maps to a
location; set them when creating the location.

### Editor Location Bar (slice 2)
When the cursor is in a scene heading **and** the script is in a series, a slim
bar appears above the editor (`App.tsx` computes the current scene via
`findSceneAtLine(content, cursorLine)`):
- alias match → "link to [Location]" chips (click binds the scene),
- no match → "+ Add 'TOKEN' to series" inline quick‑create (creates a location
  named after the token with that token as an alias, then binds),
- bound → "→ Location · unlink".
Opt‑in: nothing shows unless `Project.seriesId` is set.

### Reference images
Uploaded in `WorldSection`; stored as `referenceImageDataUrl` and persisted to
disk on save (`persistGeneratedImageFile`, Electron) → `referenceFilePath`, so
the export can hand off a durable path.

### Known limitations / future polish
- Bindings key on `sceneIndex`, which shifts if scenes are inserted earlier.
- No in‑editor gutter marker for bound scenes yet.
- No standalone Series manager (rename/delete/browse outside a script) yet.
- `world_locations` are in the STS manifest but not yet in the LightWriter package.

---

## Codebase map (key files)

| Concern | File |
|---|---|
| App state, panels, version history, location bar wiring | `src/App.tsx` |
| Text AI providers / writer+analyst split | `src/services/textAiSettingsService.ts`, `textAiService.ts` |
| Story Generator UI | `src/components/Suggestions/SuggestionPanel.tsx` |
| Direct generation | `src/services/promptGenerationService.ts` |
| Plan‑then‑write | `src/services/planThenWriteService.ts` |
| Page‑target expansion (plan‑then‑write) | `src/services/scriptExpansionService.ts` |
| Writers' Room pipeline | `src/services/writersRoomService.ts` |
| Story Doctor / rewrite / scoring | `src/services/storyDoctorService.ts`, `scriptReportCardService.ts` |
| Multi-engine fan-out + re-roll | `src/services/multiProviderRewriteService.ts`, `reRollService.ts` |
| Cast lock | `src/services/castLockService.ts` |
| Inline diff overlay | `src/services/inlineDiffService.ts`, `src/codemirror/inline-diff.ts`, `components/Editor/RewriteDiffBar.tsx` |
| Formatting passes | `fountainShotNormalizer.ts`, `fountainFormatCorrector.ts`, `generatedScriptCleanup.ts` |
| Version history | `src/services/versionHistoryService.ts` |
| Export panel | `src/components/Export/ExportPanel.tsx` |
| Export builders | `src/services/assetManifestExporter.ts` |
| World State | `src/services/worldStateService.ts`, `components/KnowledgeBase/WorldSection.tsx`, `components/Editor/LocationBar.tsx` |
| Assets/images | `src/types/assets.ts`, `assetService.ts`, `imageAssetStorageService.ts` |
| Projects | `src/services/storageService.ts` |

## localStorage keys
`lw-projects`, `lw-active-project`, `lw-kb-{projectId}`, `lw-assets-{projectId}`,
`lw-style-{projectId}`, `lw-history-{projectId}`, `lw-analysis-{projectId}`,
`lw-series`, `lw-world-locations`, `lw-world-characters`,
`lw-scene-locations-{projectId}`, `lw-text-ai-*`, `lw-rewrite-providers`,
`lw-reportcard-{projectId}`, `lw-style-reference-{scope}-{projectId}`.
