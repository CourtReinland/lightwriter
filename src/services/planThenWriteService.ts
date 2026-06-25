import { TextAiService } from "./textAiService";
import { getSelectedTextAiProviderSettings } from "./textAiSettingsService";
import { KnowledgeBaseService, type KnowledgeBase } from "./knowledgeBase";
import { StyleProfileService, type StyleProfile } from "./styleProfile";
import { SCREENPLAY_SYSTEM } from "./promptGenerationService";
import { normalizeShotLines } from "./fountainShotNormalizer";

// Plan-then-write long-form generation.
//
// The problem this solves: a single generation call from a creative finetune
// (e.g. SAO) writes a complete, COMPACT story and stops — so forcing length via
// the expand-to-target rewrite makes it pad and repeat scenes. Here we instead
// (1) PLAN a beat outline once with the analyst model, then (2) WRITE each beat
// in its own call with the writer model, feeding every call the KB, style, full
// outline, a running synopsis, and the tail of the text so far. Length then
// comes from NEW beats — the model never has to re-pad finished material.

export interface ScreenplayBeat {
  id: number;
  stage: string;
  heading: string;
  synopsis: string;
  characters: string[];
  pages: number;
}

export interface ScreenplayPlan {
  title: string;
  logline: string;
  characters: { name: string; description: string }[];
  beats: ScreenplayBeat[];
}

export interface LongGenProgress {
  completed: number;
  total: number;
  label: string;
}

export interface LongGenRequest {
  prompt: string;
  pages: number;
  knowledgeBase?: KnowledgeBase | null;
  styleProfile?: StyleProfile | null;
}

const MAX_BEATS = 30;

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Complete with a couple of retries — beats are long calls and OpenRouter can
 *  drop a connection or rate-limit transiently; one blip shouldn't lose the run. */
async function completeWithRetry(
  service: TextAiService,
  system: string,
  user: string,
  opts: { temperature: number; maxTokens: number; timeoutMs: number },
  attempts = 3,
): Promise<string> {
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await service.complete(system, user, opts);
    } catch (e) {
      lastErr = e;
      if (i < attempts - 1) await delay(1500 * (i + 1));
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error("Generation request failed");
}

function parseJsonLoose<T>(text: string): T {
  const cleaned = text
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/```\s*$/i, "")
    .trim();
  try {
    return JSON.parse(cleaned) as T;
  } catch {
    // Fall back to the first balanced object in the response.
    const start = cleaned.indexOf("{");
    const end = cleaned.lastIndexOf("}");
    if (start >= 0 && end > start) {
      return JSON.parse(cleaned.slice(start, end + 1)) as T;
    }
    throw new Error("The planner did not return valid JSON. Try again or shorten the brief.");
  }
}

function contextBlocks(req: LongGenRequest): string {
  const blocks: string[] = [];
  if (req.knowledgeBase) {
    const kb = KnowledgeBaseService.serializeForPrompt(req.knowledgeBase, 6000, []);
    if (kb) blocks.push(kb);
  }
  if (req.styleProfile) {
    blocks.push(StyleProfileService.serializeForPrompt(req.styleProfile, req.knowledgeBase?.toneStyle?.targetStyle));
  }
  return blocks.join("\n\n");
}

/** PHASE 1 — plan the beat outline with the analyst model (good at structure). */
export async function planScreenplay(req: LongGenRequest): Promise<ScreenplayPlan> {
  const system = `You are a professional story architect planning a screenplay as a beat outline.
Return STRICT JSON ONLY — no markdown, no code fences, no commentary — matching exactly:
{
  "title": string,
  "logline": string,
  "characters": [{ "name": string, "description": string }],
  "beats": [{ "id": number, "stage": string, "heading": string, "synopsis": string, "characters": [string], "pages": number }]
}`;

  const ctx = contextBlocks(req);
  const targetBeats = Math.min(MAX_BEATS, Math.max(6, Math.round(req.pages / 1.8)));
  const user = [
    `BRIEF:\n${req.prompt.trim()}`,
    `TARGET: ${req.pages} script pages total. Set each beat's "pages" so the beats sum to about ${req.pages}.`,
    `STRUCTURE: Use a sound dramatic structure appropriate to the brief — honor any structure the brief names (e.g. Dan Harmon's Story Circle: You, Need, Go, Search, Find, Take, Return, Change). Break it into roughly ${targetBeats} DISTINCT scene-beats that each advance the story. No two beats may cover the same events — every beat must move forward.`,
    ctx ? `Use this existing project canon (characters, world, tone, style) — stay consistent with it:\n${ctx}` : "",
    `Return the JSON plan now.`,
  ]
    .filter(Boolean)
    .join("\n\n");

  const analyst = TextAiService.forAnalyst();
  const raw = await analyst.complete(system, user, { temperature: 0.7, maxTokens: 4000, timeoutMs: 120_000 });
  const plan = parseJsonLoose<ScreenplayPlan>(raw);
  if (!plan.beats || plan.beats.length === 0) {
    throw new Error("The planner returned no beats. Try again or rephrase the brief.");
  }
  plan.beats = plan.beats.slice(0, MAX_BEATS);
  return plan;
}

function titlePage(plan: ScreenplayPlan, dateStr: string): string {
  return `Title: ${plan.title || "Untitled"}\nAuthor: LightWriter\nDraft date: ${dateStr}\n\n====\n`;
}

function tail(text: string, lines = 30): string {
  return text.split("\n").slice(-lines).join("\n");
}

export interface LongGenResult {
  script: string;
  failedBeats: number[];
}

/** PHASE 2 — write each beat with the writer model, carrying full context forward. */
export async function writeFromPlan(
  plan: ScreenplayPlan,
  req: LongGenRequest,
  dateStr: string,
  onProgress?: (p: LongGenProgress) => void,
): Promise<LongGenResult> {
  const writer = new TextAiService(getSelectedTextAiProviderSettings());
  const ctx = contextBlocks(req);
  const charLines = plan.characters.map((c) => `- ${c.name}: ${c.description}`).join("\n");
  const outline = plan.beats.map((b) => `${b.id}. [${b.stage}] ${b.heading} — ${b.synopsis}`).join("\n");

  const total = plan.beats.length;
  let script = titlePage(plan, dateStr);
  const synopsisSoFar: string[] = [];
  const failedBeats: number[] = [];

  const system = `${SCREENPLAY_SYSTEM}

You are writing ONE section of a longer screenplay that is already in progress.
- Write ONLY the scene(s) for the CURRENT BEAT below.
- Continue seamlessly from the text so far; match its voice, tense, and formatting.
- Do NOT write a title page (it already exists).
- Do NOT recap, rewrite, or repeat any earlier scene or dialogue — advance with NEW material only.
- Do NOT resolve or end the whole story unless the current beat is the FINAL beat.
- Return ONLY the new Fountain scene text for this beat.`;

  for (let i = 0; i < plan.beats.length; i++) {
    const beat = plan.beats[i];
    const isFinal = i === plan.beats.length - 1;
    onProgress?.({ completed: i + 1, total, label: `Writing beat ${i + 1}/${total}: ${beat.heading}` });

    const user = [
      `STORY: ${plan.title} — ${plan.logline}`,
      charLines ? `CHARACTERS:\n${charLines}` : "",
      ctx ? `PROJECT CANON (stay consistent):\n${ctx}` : "",
      `FULL OUTLINE (context only — write just the current beat):\n${outline}`,
      `>>> CURRENT BEAT ${beat.id}/${total}: [${beat.stage}] ${beat.heading}\n${beat.synopsis}\nTarget length for THIS beat: ~${beat.pages || 2} page(s).${isFinal ? " This is the FINAL beat — bring the story to its resolution and end with FADE OUT." : ""}`,
      synopsisSoFar.length ? `STORY SO FAR (already written — do NOT repeat any of it):\n${synopsisSoFar.map((s, n) => `${n + 1}. ${s}`).join("\n")}` : "This is the opening — there is no prior text.",
      i > 0 ? `THE LAST LINES WRITTEN (continue directly from here):\n---\n${tail(script)}\n---` : "",
      `Write the screenplay for the CURRENT BEAT now in Fountain format.`,
    ]
      .filter(Boolean)
      .join("\n\n");

    const maxTokens = Math.min(4000, Math.max(1024, Math.round((beat.pages || 2) * 600)));
    try {
      const chunk = (await completeWithRetry(writer, system, user, { temperature: 0.9, maxTokens, timeoutMs: 180_000 })).trim();
      if (chunk) {
        script += `\n\n${chunk}`;
        // Record the PLANNED synopsis so later beats know this happened even
        // if the prose itself is later trimmed from the tail context window.
        synopsisSoFar.push(`[${beat.stage}] ${beat.synopsis}`);
      }
    } catch {
      // A persistently failing beat is skipped, not fatal — keep the rest.
      failedBeats.push(beat.id);
      synopsisSoFar.push(`[${beat.stage}] ${beat.synopsis} (this scene was not written — leave a gap)`);
    }
    // Small gap between calls to avoid provider rate-limiting on rapid bursts.
    if (i < plan.beats.length - 1) await delay(600);
  }

  return { script: normalizeShotLines(script.trim() + "\n"), failedBeats };
}

/** Orchestrate plan -> write. */
export async function generateLongScreenplay(
  req: LongGenRequest,
  dateStr: string,
  onProgress?: (p: LongGenProgress) => void,
): Promise<LongGenResult> {
  onProgress?.({ completed: 0, total: 1, label: "Planning the story (analyst)..." });
  const plan = await planScreenplay(req);
  onProgress?.({ completed: 0, total: plan.beats.length, label: `Planned ${plan.beats.length} beats — writing...` });
  return writeFromPlan(plan, req, dateStr, onProgress);
}
