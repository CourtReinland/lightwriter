# LightWriter AI Writing Guide

A complete walkthrough of LightWriter's AI-assisted writing features. The AI is built around four pillars: a **Story Knowledge Base**, a **Style Profile**, **Beat-Aware context**, and a **Full Script Analyzer**. Together they turn the simple "rewrite this" suggestion box into a fiction-optimized creative partner that knows your characters, your voice, and your story structure.

---

## Quick Start

1. **Set your Grok API key** — Click the **AI** button in the top toolbar, then "Set Key". Enter your xAI API key (starts with `xai-`). It's stored only in your browser.
2. **Open the Knowledge Base** — Click the **KB** button (green when active).
3. **Click "Scan Script"** — Let the AI auto-extract characters, world rules, and plot threads from your existing screenplay.
4. **Toggle a framework overlay** (Hero's Journey, Save the Cat, etc.) so the AI knows what beats you're targeting.
5. **Select text in the editor** and click any AI mode — your suggestions are now context-aware.

That's it. The rest of this guide explains each feature in depth.

---

## 1. The Story Knowledge Base (KB)

The Knowledge Base is the AI's persistent memory of your story. Everything here gets injected into every AI prompt, so the AI never forgets that your protagonist is left-handed or that the magic system requires moonlight.

### Opening the KB

Click the **KB** button in the top toolbar. The KB sidebar slides out on the right with five collapsible sections:

- **Characters** — names, descriptions, traits, voice notes, relationships
- **World Rules** — setting, magic, technology, time period, etc.
- **Plot Threads** — open/foreshadowed/resolved storylines
- **Tone & Style** — genre, mood, pacing notes
- **Notes** — free-form reminders

### Adding Entries Manually

Click the **+** button next to any section. A modal opens with form fields:

**For Characters:**
- **Name**: Will be matched against the script (case-insensitive)
- **Description**: 1-3 sentences about who they are
- **Traits**: Comma-separated (e.g. `brave, sarcastic, loyal`)
- **Voice Notes**: How they speak — "short clipped sentences," "uses formal Victorian English," "can't help making puns"

**For World Rules:**
- **Category**: setting / magic / technology / time period / other
- **Title** and **Description**

**For Plot Threads:**
- **Title** and **Description**
- **Status**: Unresolved / Foreshadowed / Resolved

### Auto-Extraction with "Scan Script"

This is the fastest way to populate your KB.

1. Make sure your script is loaded in the editor
2. Click **Scan Script** at the top of the KB panel
3. The AI reads your entire screenplay and returns a structured JSON of characters, world rules, plot threads, and tone
4. New entries are merged into your existing KB (duplicates are skipped by name)

**Tip:** Run Scan Script once early to bootstrap your KB, then refine the entries manually for accuracy.

### Why this matters

Every time you ask the AI to write or improve text, it sees the relevant KB entries. Mention "ALEX" in your selection, and Alex's full character profile is included in the prompt. The AI will write dialogue that matches Alex's voice notes, respect their traits, and avoid contradicting their relationships.

---

## 2. The Style Profile

The Style Profile captures *your* voice. Paste a writing sample (or import a `.txt` file) and the AI analyzes:

- Average sentence length and variance
- Vocabulary complexity (simple / moderate / literary)
- Predominant tone
- POV (first person / third limited / omniscient / etc.)
- Tense (past / present / mixed)
- Dialogue-to-action ratio
- A 2-3 sentence "voice description"

### Setting it up

1. Open the KB panel (click **KB**)
2. Expand the **Style Profile** section at the bottom
3. Paste a writing sample into the textarea (a few thousand words is ideal — a chapter from your novel, a previous screenplay, anything that represents your voice)
4. Optionally click **Import .txt** to load from a file
5. Click **Analyze Style**

The AI returns the metrics and stores them per-project. From now on, every AI suggestion includes a "match this voice" instruction with the analyzed characteristics.

**Tip:** If you write in multiple voices (e.g., literary novel vs. action screenplay), create a separate project for each — style profiles are per-project.

---

## 3. Beat-Aware AI

LightWriter's overlay system already shows you where story beats land in your script (Hero's Journey, Save the Cat, Propp, Aristotle). The AI now uses these.

### How it works

1. Toggle a framework overlay in the right sidebar (Overlays panel)
2. Place your cursor anywhere in the script
3. Open the AI panel (click **AI** in the toolbar)
4. **At the top of the AI panel, you'll see colored "beat badges"** showing which beats your cursor is currently inside

When you run any AI command, the prompt includes:
- The beat name and framework
- The beat's description (what should happen here dramatically)
- 2 example beats from famous films
- Your target page count

So if you ask for "Smart Continue" while your cursor is in the Save the Cat **Midpoint**, the AI knows to write a false victory or false defeat — not just "more story."

---

## 4. Writing Modes

Open the AI panel by clicking **AI** in the top toolbar. You'll see two groups of buttons.

### Standard Writing Modes (always visible)

Select text in the editor first, then click:

| Mode | What it does |
|------|--------------|
| **Improve** | Makes dialogue more natural and character-specific |
| **Expand** | Adds detail, action, atmosphere |
| **Compress** | Tightens for impact, preserves key beats |
| **Alt Lines** | 3 numbered alternative versions with different tones |
| **Action** | Adds vivid description/action lines |
| **Fix Fmt** | Corrects Fountain formatting |

Each mode uses your KB, style profile, and beat context automatically.

### Custom Prompt Box

Above the mode buttons is a textarea labeled "Ask anything about the selected text". Type any custom instruction:

- *"Make this more old-fashioned, like Victorian English"*
- *"Rewrite this as if Tarantino wrote it"*
- *"Add subtext — what is the character really feeling?"*

Press Enter (or click **Ask**) to submit. The AI applies your custom instruction with full context awareness.

### Advanced AI Tools

Click **> AI Tools** to expand the advanced section. These are the most powerful modes:

#### Smart Continue (no selection needed)
Place your cursor at the end of a scene or paragraph and click. The AI generates the next 200-400 words from where you stopped, in your style, aware of the current beat. Perfect for breaking through writer's block.

#### Scene Builder (no selection needed)
Generates a complete scene skeleton — heading, action blocks, dialogue exchanges, emotional arc. If a character is selected from the dropdown above, that character will be the focus.

#### Character Voice (requires selection + character)
1. Select a chunk of text with dialogue
2. Choose a character from the dropdown
3. Click **Char Voice**

The AI rewrites the dialogue in that specific character's voice using their full KB profile (description, traits, voice notes). Great for ensuring each character sounds distinct.

#### Critique (requires selection)
Returns a structured analysis with scores 1-10 for:
- **Pacing** — rhythm, breathing room, pace
- **Tension** — dramatic build
- **Dialogue** — naturalness, subtext, character distinctiveness
- **Consistency** — fits the established story

Plus 3 actionable improvement suggestions.

#### Plot Holes (requires selection)
Checks the selected section against your KB. Looks for:
- Character contradictions (behavior or knowledge inconsistent with profile)
- World rule violations
- Timeline issues
- Unresolved threads that should be addressed
- Logic gaps

Returns specific findings or "No inconsistencies detected."

#### Beat Check (requires selection)
Evaluates how well the selected section serves its current story beat:
- Score 1-10
- What it accomplishes
- What's missing
- 2-3 specific suggestions to better align with the beat

### Apply / Insert Below

For writing modes, suggestions appear in a card with two buttons:
- **Replace** — overwrites the selected text with the suggestion
- **Insert Below** — adds the suggestion as a new block below the current line

Analysis modes (Critique, Plot Holes, Beat Check) display in a different card with structured sections, score badges, and a **Copy Analysis** button — they don't modify your script.

### Context Indicators

At the top of the AI panel, you'll see small badges showing what context the AI has:

- **KB: 5ch** — 5 characters in your Knowledge Base will be referenced
- **Style** — your style profile is active and being injected

If these badges are missing, your AI calls won't have that context — go set them up in the KB panel.

---

## 5. Full Script Analysis (the Analysis tab)

Click the **Analysis** tab in the toolbar (next to Write/Preview/Cards).

This runs a comprehensive multi-call analysis of your entire screenplay. It's the most expensive AI feature in terms of API calls (15+ for a typical screenplay), so you control when it runs.

### Running an analysis

1. Make sure you have:
   - A Grok API key set
   - Some content in your script
   - (Recommended) Characters in your KB
   - (Recommended) An active framework overlay
2. Click **Run Full Analysis**
3. A progress bar shows the current section being analyzed
4. Results populate **progressively** — each tab fills in as its analysis completes

### The Four Analysis Tabs

#### Pacing
Every scene gets a score 1-10 with:
- A horizontal bar chart (green ≥7, yellow 4-6, red <4)
- 1-2 sentence notes about why
- An overall pacing score at the top

Use this to find scenes that drag or rush.

#### Characters
For each character in your KB, the AI:
- Extracts all their dialogue from the script
- Compares against their KB profile (description, traits, voice notes)
- Returns a consistency score 1-10
- Lists specific issues found ("Character speaks formally here despite 'casual slang' in voice notes")

If a KB character has no dialogue in the script, they get a `N/A` score with a note.

#### Beats
For each active framework, evaluates the script section corresponding to each beat:
- Beat name and page range
- Score 1-10
- ✓ What's accomplished
- ! What's missing

Grouped by framework with colored headers matching the overlay colors.

#### Dialogue
Per-scene dialogue analysis with three metrics:
- **Subtext** — how much is implied vs. stated
- **Naturalness** — does it sound like real speech
- **Distinctiveness** — do characters sound like themselves

Each metric gets its own bar visualization. Plus AI notes.

### Overall Score

In the top-right, an overall score badge shows the average of all four dimensions. Color-coded:
- 🟢 Green: 7+
- 🟡 Yellow: 4-6
- 🔴 Red: <4

### Caching & Re-running

Analysis results are cached per-project in localStorage. They persist across sessions — open the Analysis tab any time to see the last results.

To refresh: click **Re-analyze**.
To clear: click **Clear**.

---

## 6. Recommended Workflow

Here's how to get the most out of LightWriter's AI for a new project:

### Phase 1: Setup
1. Create a new project (Projects menu)
2. Paste or import your initial draft
3. Click **KB** → **Scan Script** to bootstrap characters and world
4. Manually refine the most important character profiles (especially **voice notes**)
5. Open the Style Profile section and analyze a writing sample (optional but powerful)
6. Set your **Target Pages** in the toolbar
7. Toggle one framework overlay (Save the Cat is great for screenplays)

### Phase 2: Drafting
- Use **Smart Continue** when stuck — it knows where you are in the story
- Use **Scene Builder** to skeleton out new scenes from beat positions
- Use **Char Voice** to ensure each character sounds distinct
- Use the custom prompt box for one-off rewrites

### Phase 3: Revising
- Use **Improve** / **Expand** / **Compress** on individual passages
- Use **Critique** on suspect scenes
- Use **Plot Holes** after big changes to catch consistency drift
- Use **Beat Check** on key story moments to ensure they're hitting

### Phase 4: Final Pass
- Switch to the **Analysis** tab
- Click **Run Full Analysis**
- Review pacing scores — fix dragging or rushing scenes
- Check character consistency — fix anyone with low scores
- Check beat alignment — make sure your structure is working
- Review dialogue quality scene-by-scene

---

## 7. Tips & Gotchas

- **Keep voice notes specific.** "Speaks formally" is weak. "Uses Victorian-era English with elaborate metaphors and avoids contractions" gives the AI something to work with.

- **The AI only knows what's in the KB.** If characters drift in personality, update their profiles — don't blame the AI for forgetting.

- **Character names must match exactly.** "Alex" in the KB won't match "ALEX" in the script unless you use the same name. Scan Script handles this automatically.

- **Beat awareness only works with active frameworks.** If you don't toggle any overlays, the AI has no idea what beat you're in.

- **Custom prompts override mode buttons.** If you want a precise rewrite, use the textarea and ask exactly what you want.

- **Analysis is expensive.** A full analysis on a 30-scene screenplay with 5 characters and 2 active frameworks runs ~20 API calls. Don't run it on every save.

- **localStorage has limits.** Each project's KB, style profile, and analysis cache are stored separately. Across many projects, you may hit the ~5MB browser limit. Delete old projects from the Projects menu if needed.

- **API errors mean rate limits or auth issues.** If you see "Grok API error: 401" your key is invalid. "429" means rate limited — wait a minute.

---

## 8. Privacy

- All data stays in your browser (localStorage)
- API keys are never sent anywhere except to xAI's API
- No telemetry, no tracking, no backend
- Your screenplay text is sent to xAI for processing — review xAI's privacy policy for their handling

---

## 9. What's Where

| Feature | Location |
|---------|----------|
| Set API key | AI panel → "Set Key" button |
| KB panel | Toolbar → **KB** button |
| Scan Script | KB panel header |
| Style profile | KB panel → Style Profile section |
| AI suggestions | Toolbar → **AI** button |
| Custom prompt | Top of AI panel |
| Advanced tools | AI panel → "AI Tools" toggle |
| Beat badges | AI panel header (when in a beat) |
| Full analysis | Toolbar → **Analysis** tab |

Happy writing.
