import { TextAiService, type TextCompleteOptions } from "./textAiService";
import { estimatePages } from "../frameworks/utils";
import { extractShotScenes } from "./shotDirectionService";
import { normalizeShotLines } from "./fountainShotNormalizer";
import { KnowledgeBaseService, type KnowledgeBase } from "./knowledgeBase";
import { StyleProfileService, type StyleProfile } from "./styleProfile";

// Reliable page-count expansion. A single LLM call asked to "rewrite this script
// 10 pages longer" almost always under-delivers, because the model rewrites and
// compresses existing content. Instead we keep the draft intact and accumulate
// NEW scenes (small, reliable outputs) until the line count reaches the target.

const LINES_PER_PAGE = 56;
const EXPAND_TIMEOUT_MS = 240_000;
const MAX_PASSES = 8;

type Completion = (system: string, user: string, options?: TextCompleteOptions) => Promise<string>;

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

function buildInsertionPrompt(script: string, ctx: ExpandContext): { system: string; user: string } {
  const curPages = estimatePages(lineCount(script));
  const deficitPages = Math.max(1, ctx.targetPages - curPages);
  const deficitLines = deficitPages * LINES_PER_PAGE;
  const styleText = ctx.styleProfile ? StyleProfileService.serializeForPrompt(ctx.styleProfile) : "";
  const kbText = ctx.knowledgeBase ? KnowledgeBaseService.serializeForPrompt(ctx.knowledgeBase, 4000) : "";
  const fwLine = ctx.frameworkName ? `Target structure: ${ctx.frameworkName}.` : "";
  const beatGuidance = ctx.beatGuidance && ctx.beatGuidance.trim()
    ? ctx.beatGuidance
    : "Deepen thin sequences and bridge gaps between existing scenes with new dramatized beats.";

  // Keep the prompt bounded but give head + tail of the draft for continuity.
  const draftContext = script.length > 12000 ? `${script.slice(0, 6000)}\n...\n${script.slice(-6000)}` : script;

  const system = `You are LightWriter's screenplay expansion engine. You GROW a screenplay toward a target page count by writing NEW scenes that get inserted into the existing draft. You never rewrite, summarize, or shorten existing scenes. Return ONLY valid JSON, no markdown.`;

  const user = `The current screenplay is about ${curPages} page(s); the writer needs it at ${ctx.targetPages} page(s). Write NEW scenes that add roughly ${deficitPages} page(s) (~${deficitLines} lines). ${fwLine}

DEVELOP THESE BEATS (write full dramatized scenes for the missing/weak ones, landing in their page ranges):
${beatGuidance}

FOUNTAIN FORMAT — match the existing draft EXACTLY. Each line type renders in a fixed screenplay position, so getting this wrong puts shots in the character slot and action in the dialogue slot:
- SCENE HEADING: a line starting with INT. or EXT. — e.g. "INT. LIVING ROOM, HOME, DAY".
- ACTION / description: plain sentence-case prose. NEVER write action in ALL CAPS (an ALL-CAPS line above a text line is read as a character name).
- CHARACTER CUE: the speaking character's name in ALL CAPS, alone on its line, with a BLANK LINE before it; the spoken line(s) go on the very next line(s) with NO blank line between cue and dialogue.
- CAMERA SHOT: MUST begin with "!!" then immediately one of WS, MS, CU, ECU, LS, OTS, POV, then an uppercase description — e.g. "!!WS LIVING ROOM", "!!MS ALIYAH OPENS THE TRUNK", "!!CU ALIYAH'S FACE". A camera line WITHOUT the leading "!!" is mis-parsed as a character name and the line under it becomes dialogue, so EVERY shot must start with "!!". Do not use bare "ANGLE ON…", "WIDE", "INSERT" — express those after the required token (e.g. "!!WS AERIAL OVER THE HOUSE").
- Put a BLANK LINE between every element (between stacked shots and the action under them, between action and the next character cue, between a character's dialogue and the next element).

CONTENT RULES:
- Write COMPLETE dramatized scenes (real action and dialogue), not summaries or outlines. Mirror the existing draft's shot-heavy coverage style using the "!!" shot syntax above.
- Match the existing draft's voice, characters, tone, and world. Never contradict established plot facts or introduce unrelated characters/events.
- Do NOT repeat or restate existing scenes. Only ADD new material that advances the story causally (this happened, therefore that).
- Add MULTIPLE scenes this pass, totaling close to ${deficitPages} pages. Write generously — real page growth is the goal.
${styleText ? `\nSTYLE CONTRACT:\n${styleText}\n` : ""}${kbText ? `\nSTORY KNOWLEDGE BASE:\n${kbText}\n` : ""}
CURRENT DRAFT (context only — do NOT return it):
---
${draftContext}
---

Return ONLY this JSON:
{"scenes":[{"insert_after":"<EXACT existing slugline this new scene should follow, copied verbatim from the draft, or \\"START\\" for the very beginning>","beat":"<beat name>","fountain":"<the complete new scene in Fountain>"}]}`;

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
  const service = new TextAiService();
  const complete: Completion = completeOverride ?? service.complete.bind(service);
  const startPages = estimatePages(lineCount(script));
  const targetLines = ctx.targetPages * LINES_PER_PAGE;

  let working = script;
  const changeSummary: string[] = [];
  const warnings: string[] = [];
  let noGrowth = 0;
  let passes = 0;

  for (let pass = 0; pass < MAX_PASSES; pass++) {
    const curLines = lineCount(working);
    if (curLines >= Math.floor(targetLines * 0.92)) break;
    passes = pass + 1;

    onProgress?.({
      completed: pass,
      total: MAX_PASSES,
      label: `Expanding: ~${estimatePages(curLines)} of ${ctx.targetPages} pages (pass ${pass + 1})`,
    });

    const { system, user } = buildInsertionPrompt(working, ctx);
    let response: string;
    try {
      response = await complete(system, user, { temperature: 0.6, maxTokens: 8000, timeoutMs: EXPAND_TIMEOUT_MS });
    } catch (e) {
      warnings.push(`Expansion pass ${pass + 1} failed: ${e instanceof Error ? e.message : String(e)}`);
      break;
    }

    const insertions = parseInsertions(response);
    if (!insertions.length) {
      if (++noGrowth >= 2) break;
      continue;
    }

    const before = lineCount(working);
    const next = insertScenes(working, insertions);
    if (lineCount(next) <= before + 3) {
      if (++noGrowth >= 2) break;
      continue;
    }

    noGrowth = 0;
    working = next;
    for (const ins of insertions) {
      const firstLine = ins.fountain.split("\n").find((l) => l.trim()) || "new scene";
      changeSummary.push(`Added scene${ins.beat ? ` (${ins.beat})` : ""}: ${firstLine.trim().slice(0, 80)}`);
    }
  }

  const endPages = estimatePages(lineCount(working));
  if (endPages < ctx.targetPages) {
    warnings.push(`Expanded to ~${endPages} of ${ctx.targetPages} target pages. Run the rewrite again to add more.`);
  }

  // Backstop: ensure any inserted camera lines use the "!!" shot prefix so they
  // don't render in the character/dialogue slots even if the model forgot.
  return { script: normalizeShotLines(working), changeSummary, warnings, passes, startPages, endPages };
}
