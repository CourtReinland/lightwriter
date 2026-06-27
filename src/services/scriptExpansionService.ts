import { TextAiService, type TextCompleteOptions } from "./textAiService";
import { estimatePages } from "../frameworks/utils";
import { extractShotScenes } from "./shotDirectionService";
import { KnowledgeBaseService, type KnowledgeBase } from "./knowledgeBase";
import { StyleProfileService, type StyleProfile } from "./styleProfile";
import { SCREENPLAY_SYSTEM } from "./promptGenerationService";
import { cleanupGeneratedScreenplay } from "./generatedScriptCleanup";

// Plan-then-write page expansion.
//
// The old approach made up to 8 blind passes, each re-prompting "write N more
// pages" with only a truncated (head+tail) view of the draft and the same beat
// guidance — so it regenerated near-duplicate scenes ("the same scene with small
// iterations"). Instead we now: (1) PLAN the new scenes once with the analyst,
// which sees the FULL list of existing scenes and places distinct, causally
// connected new beats with anchors; then (2) WRITE each planned scene with the
// writer, carrying continuity (established cast — never re-introduce — and the
// neighbouring scene) so length comes from NEW material, not repetition.

const LINES_PER_PAGE = 56;
const EXPAND_TIMEOUT_MS = 240_000;
const MAX_NEW_SCENES = 18;

type Completion = (system: string, user: string, options?: TextCompleteOptions) => Promise<string>;

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e));

export interface ExpandProgress {
  completed: number;
  total: number;
  label: string;
}

export interface ExpandContext {
  targetPages: number;
  frameworkName?: string;
  /** Pre-formatted "develop these beats" guidance (built by the caller from the report card). */
  beatGuidance?: string;
  knowledgeBase: KnowledgeBase | null;
  styleProfile: StyleProfile | null;
  /** Pre-serialized series/arc/cliffhanger context for this episode (see seriesContextService). */
  seriesContext?: string;
}

export interface ExpandResult {
  script: string;
  changeSummary: string[];
  warnings: string[];
  passes: number;
  startPages: number;
  endPages: number;
}

interface SceneInsertion {
  insert_after: string;
  beat?: string;
  fountain: string;
}

interface PlannedScene {
  insert_after: string;
  beat: string;
  synopsis: string;
  pages: number;
}

function lineCount(text: string): number {
  return text.split("\n").length;
}

function stripToJson(text: string): string {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  let t = fenced ? fenced[1] : text;
  const first = t.indexOf("{");
  const last = t.lastIndexOf("}");
  if (first >= 0 && last > first) t = t.slice(first, last + 1);
  return t.trim();
}

/** Legacy insertion parser (kept for any caller that returns {scenes:[...]}). */
export function parseInsertions(text: string): SceneInsertion[] {
  try {
    const obj = JSON.parse(stripToJson(text));
    const arr = Array.isArray(obj) ? obj : Array.isArray(obj.scenes) ? obj.scenes : [];
    return arr
      .map((s: Record<string, unknown>) => ({
        insert_after: String(s.insert_after ?? s.after ?? "END"),
        beat: s.beat ? String(s.beat) : undefined,
        fountain: String(s.fountain ?? s.scene ?? "").trim(),
      }))
      .filter((s: SceneInsertion) => s.fountain.length > 0);
  } catch {
    return [];
  }
}

function parseExpansionPlan(text: string): PlannedScene[] {
  try {
    const obj = JSON.parse(stripToJson(text));
    const arr = Array.isArray(obj)
      ? obj
      : Array.isArray(obj.newScenes)
        ? obj.newScenes
        : Array.isArray(obj.scenes)
          ? obj.scenes
          : [];
    return arr
      .map((s: Record<string, unknown>) => ({
        insert_after: String(s.insert_after ?? s.after ?? "END"),
        beat: String(s.beat ?? s.stage ?? "New scene"),
        synopsis: String(s.synopsis ?? s.description ?? "").trim(),
        pages: Number(s.pages) > 0 ? Number(s.pages) : 2,
      }))
      .filter((s: PlannedScene) => s.synopsis.length > 0)
      .slice(0, MAX_NEW_SCENES);
  } catch {
    return [];
  }
}

async function completeWithRetry(
  complete: Completion,
  system: string,
  user: string,
  opts: TextCompleteOptions,
  attempts = 3,
): Promise<string> {
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await complete(system, user, opts);
    } catch (e) {
      lastErr = e;
      if (i < attempts - 1) await delay(1200 * (i + 1));
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error("Expansion request failed");
}

interface ExistingScene {
  heading: string;
  brief: string;
}

function existingSceneList(script: string): ExistingScene[] {
  const { scenes } = extractShotScenes(script);
  const lines = script.split("\n");
  return scenes.map((s) => {
    const body = lines
      .slice(s.startLine + 1, s.endLine + 1)
      .map((l) => l.trim())
      .filter(Boolean);
    // first line that isn't an all-caps cue/shot -> a readable one-line gist
    const brief = body.find((l) => !/^[A-Z][A-Z0-9 .'\-]+$/.test(l) && !l.startsWith("!!")) || body[0] || "";
    return { heading: s.heading.trim(), brief: brief.slice(0, 100) };
  });
}

function sceneTextAt(script: string, heading: string): string {
  const { scenes } = extractShotScenes(script);
  const lines = script.split("\n");
  const a = heading.trim().toUpperCase();
  const match =
    scenes.find((s) => s.heading.trim().toUpperCase() === a) ||
    scenes.find((s) => s.heading.trim().toUpperCase().includes(a) || a.includes(s.heading.trim().toUpperCase()));
  if (!match) return "";
  return lines.slice(match.startLine, match.endLine + 1).join("\n").trim();
}

function buildExpansionPlanPrompt(script: string, ctx: ExpandContext): { system: string; user: string } {
  const cur = estimatePages(lineCount(script));
  const deficit = Math.max(1, ctx.targetPages - cur);
  const approxScenes = Math.min(MAX_NEW_SCENES, Math.max(1, Math.round(deficit / 2)));
  const sceneList = existingSceneList(script)
    .map((s, i) => `${i + 1}. ${s.heading}${s.brief ? ` — ${s.brief}` : ""}`)
    .join("\n");
  const kbText = ctx.knowledgeBase ? KnowledgeBaseService.serializeForPrompt(ctx.knowledgeBase, 3000) : "";
  const beatGuidance =
    ctx.beatGuidance && ctx.beatGuidance.trim()
      ? ctx.beatGuidance
      : "Deepen thin sequences and bridge gaps between existing scenes with new dramatized beats.";
  const fwLine = ctx.frameworkName ? `Target structure: ${ctx.frameworkName}.` : "";

  const system = `You are LightWriter's screenplay expansion planner. The draft is too short. Plan the NEW scenes to ADD (you never rewrite or shorten existing scenes) so the script reaches the target length and improves structure. Return ONLY valid JSON, no markdown.`;

  const user = `The draft is about ${cur} page(s); the target is ${ctx.targetPages} page(s). Plan about ${deficit} page(s) of NEW material as roughly ${approxScenes} new scene(s). ${fwLine}

EXISTING SCENES (in order — do NOT recreate, rewrite, or duplicate any of these; place new scenes between or after them):
${sceneList}

DEVELOP THESE BEATS (prioritise the missing/weak ones):
${beatGuidance}

RULES:
- Every new scene is a DISTINCT event that does NOT repeat any existing scene above. Do not re-stage a meeting, arrival, or reveal that already happened.
- New scenes connect causally to the scenes around them (this happened, therefore that).
- Characters already in the draft are established — new scenes must NOT re-introduce or re-describe them.
- "insert_after" MUST be the EXACT slugline of an existing scene above (copied verbatim), or "START" for the very beginning.
${kbText ? `\nSTORY KNOWLEDGE BASE:\n${kbText}\n` : ""}${ctx.seriesContext ? `\n${ctx.seriesContext}\nNew scenes must advance the active arcs and respect this episode's cliffhanger duties.\n` : ""}
Return ONLY: {"newScenes":[{"insert_after":"<existing slugline verbatim or START>","beat":"<purpose/beat>","synopsis":"<the NEW thing that happens>","pages":<number>}]}`;

  return { system, user };
}

function buildExpansionScenePrompt(
  planned: PlannedScene,
  ctx: ExpandContext,
  neighborText: string,
  castNames: string[],
): { system: string; user: string } {
  const styleText = ctx.styleProfile ? StyleProfileService.serializeForPrompt(ctx.styleProfile) : "";
  const system = `${SCREENPLAY_SYSTEM}

You are writing ONE NEW scene to insert into a screenplay that ALREADY EXISTS.
- The characters are ALREADY introduced and acquainted. Refer to them by name. Do NOT re-introduce or re-describe them, and do NOT stage any first meeting between them. Introduce a brand-new character only if this beat genuinely brings one in.
- Match the existing draft's voice, tense, and Fountain formatting.
- Do NOT repeat, recap, or rewrite the neighbouring scene shown below or any other existing material — write NEW story that advances causally.
- No title page. Return ONLY the new Fountain scene text.`;

  const user = [
    castNames.length ? `ESTABLISHED CAST (already introduced — never re-introduce): ${castNames.join(", ")}.` : "",
    neighborText
      ? `THIS NEW SCENE FOLLOWS THIS EXISTING SCENE (continue smoothly after it; do NOT repeat it):\n---\n${neighborText.slice(-1600)}\n---`
      : "This new scene opens the screenplay.",
    `NEW SCENE TO WRITE — ${planned.beat}; about ${planned.pages} page(s):\n${planned.synopsis}`,
    styleText ? `STYLE CONTRACT:\n${styleText}` : "",
    ctx.seriesContext ? ctx.seriesContext : "",
    `Write the new scene now in Fountain format.`,
  ]
    .filter(Boolean)
    .join("\n\n");

  return { system, user };
}

function insertScenes(script: string, insertions: SceneInsertion[]): string {
  if (!insertions.length) return script;
  const { scenes } = extractShotScenes(script);
  const lines = script.split("\n");

  const resolveAt = (anchor: string): number => {
    const a = anchor.trim().toUpperCase();
    if (a === "START" || a === "BEGINNING") return scenes.length ? scenes[0].startLine : 0;
    if (!scenes.length) return lines.length;
    let match = scenes.find((s) => s.heading.trim().toUpperCase() === a);
    if (!match) match = scenes.find((s) => s.heading.trim().toUpperCase().startsWith(a) || a.startsWith(s.heading.trim().toUpperCase()));
    if (!match) match = scenes.find((s) => s.heading.trim().toUpperCase().includes(a) || a.includes(s.heading.trim().toUpperCase()));
    return match ? match.endLine + 1 : lines.length; // after the matched scene, else append
  };

  // Resolve all anchors against the ORIGINAL script, then splice bottom-up so
  // earlier (lower) insertions don't shift later (higher) indices.
  const points = insertions.map((ins) => ({ at: resolveAt(ins.insert_after), text: `\n${ins.fountain.trim()}\n` }));
  points.sort((p, q) => q.at - p.at);
  for (const p of points) {
    lines.splice(p.at, 0, ...p.text.split("\n"));
  }
  return lines.join("\n");
}

export async function expandScriptToTargetPages(
  script: string,
  ctx: ExpandContext,
  onProgress?: (p: ExpandProgress) => void,
  completeOverride?: Completion,
): Promise<ExpandResult> {
  const startPages = estimatePages(lineCount(script));
  if (!ctx.targetPages || startPages >= Math.floor(ctx.targetPages * 0.92)) {
    return { script, changeSummary: [], warnings: [], passes: 0, startPages, endPages: startPages };
  }

  const writerSvc = new TextAiService();
  const analystSvc = TextAiService.forAnalyst();
  const writeComplete: Completion = completeOverride ?? writerSvc.complete.bind(writerSvc);
  const planComplete: Completion = completeOverride ?? analystSvc.complete.bind(analystSvc);

  const changeSummary: string[] = [];
  const warnings: string[] = [];

  // PHASE 1 — plan the new scenes (analyst sees the full existing scene list).
  onProgress?.({ completed: 0, total: 1, label: `Planning new scenes for ${ctx.targetPages} pages...` });
  let planned: PlannedScene[] = [];
  try {
    const planPrompt = buildExpansionPlanPrompt(script, ctx);
    const raw = await completeWithRetry(planComplete, planPrompt.system, planPrompt.user, {
      temperature: 0.7,
      maxTokens: 3000,
      timeoutMs: EXPAND_TIMEOUT_MS,
    });
    planned = parseExpansionPlan(raw);
  } catch (e) {
    warnings.push(`Expansion planning failed: ${errMsg(e)}`);
  }
  if (!planned.length) {
    warnings.push(`Could not plan new scenes to reach the ${ctx.targetPages}-page target. Run the rewrite again.`);
    return { script, changeSummary, warnings, passes: 0, startPages, endPages: startPages };
  }

  // PHASE 2 — write each planned scene with continuity, collect insertions.
  const castNames = ctx.knowledgeBase?.characters.map((c) => c.name) ?? [];
  const insertions: SceneInsertion[] = [];
  for (let i = 0; i < planned.length; i++) {
    const p = planned[i];
    onProgress?.({ completed: i + 1, total: planned.length, label: `Writing new scene ${i + 1}/${planned.length}: ${p.beat}` });
    const neighbor = p.insert_after.trim().toUpperCase() === "START" ? "" : sceneTextAt(script, p.insert_after);
    const prompt = buildExpansionScenePrompt(p, ctx, neighbor, castNames);
    const maxTokens = Math.min(4000, Math.max(1024, Math.round(p.pages * 600)));
    try {
      const chunk = (
        await completeWithRetry(writeComplete, prompt.system, prompt.user, {
          temperature: 0.85,
          maxTokens,
          timeoutMs: EXPAND_TIMEOUT_MS,
        })
      ).trim();
      if (chunk) {
        insertions.push({ insert_after: p.insert_after, beat: p.beat, fountain: cleanupGeneratedScreenplay(chunk, castNames).trim() });
        const firstLine = chunk.split("\n").find((l) => l.trim()) || "new scene";
        changeSummary.push(`Added scene (${p.beat}): ${firstLine.trim().slice(0, 80)}`);
      }
    } catch (e) {
      warnings.push(`New scene "${p.beat}" failed: ${errMsg(e)}`);
    }
    if (i < planned.length - 1) await delay(400);
  }

  const working = insertScenes(script, insertions);
  const endPages = estimatePages(lineCount(working));
  if (endPages < Math.floor(ctx.targetPages * 0.9)) {
    warnings.push(`Expanded to ~${endPages} of ${ctx.targetPages} target pages. Run the rewrite again to add more.`);
  }
  return { script: working, changeSummary, warnings, passes: insertions.length, startPages, endPages };
}
