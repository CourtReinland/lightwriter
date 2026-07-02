import { TextAiService, type TextCompleteOptions } from "./textAiService";
import { type TextAiProvider, textAiProviderLabel } from "./textAiSettingsService";
import { ALL_FRAMEWORKS, computeBeatRanges, estimatePages } from "../frameworks";
import { KnowledgeBaseService, type KnowledgeBase } from "./knowledgeBase";
import { StyleProfileService, type StyleProfile } from "./styleProfile";
import { extractScriptScenes } from "./scriptStructure";
import { cleanupGeneratedScreenplay } from "./generatedScriptCleanup";
import { castLockBlock, findInventedCharacters } from "./castLockService";
import { fixBriefFor } from "./storyDoctorService";
import {
  FOUNTAIN_FORMAT_RULES,
  parseRewriteResponse,
  runScriptReportCard,
  metricScoreFromCard,
  type ScriptReportCard,
} from "./scriptReportCardService";

// ── The Writers' Room ────────────────────────────────────────────────────────
// A staged, multi-model rewrite that mimics how a real room develops a script,
// instead of asking one model to fix everything in one completion:
//
//   0. Showrunner memo  — what's broken, what's sacred, where we're going.
//   1. Break the story  — every engine pitches a beat sheet; a judge merges the
//                         strongest board; the BOARD (not the script) is scored
//                         and iterated — cheap, low-noise structural work.
//   2. Draft            — ONE writer voice scripts the board card by card,
//                         carrying story-so-far; "keep" cards copy the original.
//   3. Punch-up         — scoped passes on a second engine: dialogue, then
//                         continuity + cut to length.
//   4. Table read       — coverage from a model that didn't write; targeted
//                         fixes on flagged scenes only; final score.

export interface RoomProgress {
  completed: number;
  total: number;
  label: string;
}

export interface SceneCard {
  /** Framework beat this card lands (e.g. "You", "Catalyst"). */
  beat: string;
  slugline: string;
  /** keep = copy the existing scene; rework = rewrite it; new = write fresh. */
  source: "keep" | "rework" | "new";
  intent: string;
  conflict: string;
  turn: string;
  characters: string[];
  pages: number;
}

export interface RoomMemo {
  theme: string;
  problems: string[];
  sacredScenes: string[];
  direction: string;
}

export interface WritersRoomResult {
  finalScript: string;
  memo: RoomMemo;
  board: SceneCard[];
  /** Outline score after each board iteration (structure converges here, cheaply). */
  outlineScores: number[];
  finalScore: number | null;
  finalReport: ScriptReportCard | null;
  changeSummary: string[];
  warnings: string[];
  seats: { drafter: string; judge: string; punchUp: string; coverage: string };
}

export interface WritersRoomInput {
  script: string;
  frameworkId: string;
  frameworkName: string;
  targetPages: number;
  reportCard: ScriptReportCard;
  knowledgeBase: KnowledgeBase | null;
  styleProfile: StyleProfile | null;
  seriesContext?: string;
  allowedCast?: string[];
  /** Keyed engines to seat around the table (writer first is conventional). */
  engines: TextAiProvider[];
}

type SeatCompletion = (provider: TextAiProvider, system: string, user: string, options?: TextCompleteOptions) => Promise<string>;

export interface WritersRoomDeps {
  /** Test seam: run all completions without network. */
  complete?: SeatCompletion;
  /** Test seam: final full-script scoring. */
  scoreScript?: (script: string) => Promise<ScriptReportCard>;
  /** Test seam: outline scoring. */
  scoreOutline?: (board: SceneCard[], blueprintText: string) => Promise<{ score: number; notes: string[] }>;
}

const OUTLINE_TARGET = 85;
const OUTLINE_MAX_ITERATIONS = 3;
const STAGE_TIMEOUT_MS = 240_000;

function extractJsonBlock(text: string): string {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced) return fenced[1].trim();
  const first = text.indexOf("{");
  const last = text.lastIndexOf("}");
  if (first >= 0 && last > first) return text.slice(first, last + 1).trim();
  return text.trim();
}

function parseJson<T>(raw: string, what: string): T {
  try {
    return JSON.parse(extractJsonBlock(raw)) as T;
  } catch {
    throw new Error(`The ${what} response was not valid JSON.`);
  }
}

function coerceCards(raw: unknown): SceneCard[] {
  const arr = Array.isArray(raw) ? raw : [];
  return arr
    .map((c) => {
      const card = c as Partial<SceneCard>;
      if (!card || typeof card.slugline !== "string" || !card.slugline.trim()) return null;
      return {
        beat: String(card.beat ?? "").trim() || "—",
        slugline: card.slugline.trim(),
        source: card.source === "keep" || card.source === "rework" ? card.source : "new",
        intent: String(card.intent ?? "").trim(),
        conflict: String(card.conflict ?? "").trim(),
        turn: String(card.turn ?? "").trim(),
        characters: Array.isArray(card.characters) ? card.characters.map((n) => String(n).trim()).filter(Boolean) : [],
        pages: Math.max(0.5, Math.min(6, Number(card.pages) || 1)),
      } satisfies SceneCard;
    })
    .filter((c): c is SceneCard => c !== null);
}

function boardText(board: SceneCard[]): string {
  return board
    .map((c, i) => `${i + 1}. [${c.beat}] ${c.slugline} (${c.source}, ~${c.pages}pp) — intent: ${c.intent}; conflict: ${c.conflict}; turn: ${c.turn}; cast: ${c.characters.join(", ") || "—"}`)
    .join("\n");
}

function sceneListText(script: string): string {
  return extractScriptScenes(script)
    .map((s, i) => `${i + 1}. ${s.heading}${s.description ? ` — ${s.description.slice(0, 90)}` : ""}`)
    .join("\n") || "(no scene headings found)";
}

/** Punctuation/whitespace-insensitive slugline key ("INT KITCHEN - DAY" == "INT. KITCHEN - DAY"). */
function slugKey(s: string): string {
  return s.trim().toUpperCase().replace(/[.–—-]/g, " ").replace(/\s+/g, " ").trim();
}

interface SceneLookup {
  text: string;
  /** Set when the match was fuzzy or ambiguous — surfaced as a warning. */
  note?: string;
}

/**
 * Resolve a card's slugline to a scene's text. `occurrence` disambiguates
 * repeated sluglines (standing sets): the k-th card referencing a slug gets the
 * k-th occurrence in the script. The scene's text ends BEFORE the next scene's
 * heading (extractScriptScenes' endLine points AT the next heading's line).
 */
function sceneTextBySlugline(script: string, slugline: string, occurrence = 0): SceneLookup {
  const scenes = extractScriptScenes(script);
  const lines = script.split("\n");
  const want = slugKey(slugline);
  const sliceOf = (idx: number): string => {
    const hit = scenes[idx];
    const next = scenes[idx + 1];
    const end = next ? next.startLine - 1 : lines.length; // exclusive, 0-based
    return lines.slice(hit.startLine - 1, end).join("\n").trim();
  };

  const exact = scenes.map((s, i) => ({ s, i })).filter(({ s }) => slugKey(s.heading) === want);
  if (exact.length) {
    const pick = exact[Math.min(occurrence, exact.length - 1)];
    return {
      text: sliceOf(pick.i),
      note: exact.length > 1 && occurrence >= exact.length ? `"${slugline}" repeats ${exact.length}× in the draft; used the last occurrence.` : undefined,
    };
  }
  const fuzzyIdx = scenes.findIndex((s) => slugKey(s.heading).includes(want) || want.includes(slugKey(s.heading)));
  if (fuzzyIdx >= 0) {
    return { text: sliceOf(fuzzyIdx), note: `"${slugline}" matched "${scenes[fuzzyIdx].heading}" approximately.` };
  }
  return { text: "" };
}

/** Seat the room: one drafter voice, a judge/punch-up seat, a rival for coverage. */
export function assignSeats(engines: TextAiProvider[]): { drafter: TextAiProvider; judge: TextAiProvider; punchUp: TextAiProvider; coverage: TextAiProvider } {
  const drafter = engines[0];
  const judge = engines.includes("claude") && drafter !== "claude" ? "claude" : engines.find((p) => p !== drafter) ?? drafter;
  const coverage = engines.find((p) => p !== drafter && p !== judge) ?? judge;
  return { drafter, judge, punchUp: judge, coverage };
}

export async function runWritersRoom(
  input: WritersRoomInput,
  onProgress?: (p: RoomProgress) => void,
  deps: WritersRoomDeps = {},
): Promise<WritersRoomResult> {
  if (!input.engines.length) throw new Error("The Writers' Room needs at least one engine with an API key.");
  const seats = assignSeats(input.engines);
  const complete: SeatCompletion = deps.complete
    ?? ((provider, system, user, options) => TextAiService.forProvider(provider).complete(system, user, options));

  const framework = ALL_FRAMEWORKS.find((f) => f.id === input.frameworkId);
  const totalLines = input.script.split("\n").length;
  const blueprintText = framework
    ? computeBeatRanges(framework, input.targetPages, totalLines)
        .map((b) => `- ${b.name} (pages ${b.startPage}-${b.endPage}): ${b.description}`)
        .join("\n")
    : "";
  const styleText = input.styleProfile ? StyleProfileService.serializeForPrompt(input.styleProfile) : "";
  const kbText = input.knowledgeBase ? KnowledgeBaseService.serializeForPrompt(input.knowledgeBase, 3000) : "";
  const castBlock = castLockBlock(input.allowedCast);
  const seriesBlock = input.seriesContext?.trim() ? `\n${input.seriesContext.trim()}\n` : "";
  const warnings: string[] = [];
  const changeSummary: string[] = [];

  // Progress: total is provisional until the board is known (then recomputed from
  // the real card count), and the final tick lands exactly on total.
  let step = 0;
  let total = 1 + input.engines.length + 1 + OUTLINE_MAX_ITERATIONS + Math.max(6, Math.round(input.targetPages / 2)) + 2 + 2 + 1;
  const tick = (label: string) => onProgress?.({ completed: step++, total: Math.max(total, step + 1), label: `Room: ${label}` });

  // ── Stage 0: Showrunner memo ──────────────────────────────────────────────
  tick(`showrunner memo (${textAiProviderLabel(seats.judge)})`);
  let memo: RoomMemo = { theme: "", problems: [], sacredScenes: [], direction: "" };
  try {
    const raw = await complete(seats.judge, `You are the showrunner of a working writers' room. You read the current draft and its coverage, then write the development memo that will guide the room. Be specific and decisive. Return ONLY valid JSON.`,
      `CURRENT DRAFT SCENES:\n${sceneListText(input.script)}\n\nTARGET: ${input.targetPages} pages, structured as ${input.frameworkName}.\nBEAT BLUEPRINT:\n${blueprintText}\n\nWHAT THE ANALYSIS FOUND:\n${fixBriefFor(input.reportCard, input.frameworkId)}\n${kbText ? `\nSTORY KNOWLEDGE BASE:\n${kbText}\n` : ""}${seriesBlock}
Return ONLY: {"theme":"the episode's dramatic question in one sentence","problems":["the 3-5 biggest problems"],"sacredScenes":["EXACT sluglines of scenes strong enough to keep"],"direction":"2-3 sentences on the fix"}`,
      { temperature: 0.5, maxTokens: 900, timeoutMs: STAGE_TIMEOUT_MS });
    const parsed = parseJson<Partial<RoomMemo>>(raw, "showrunner memo");
    memo = {
      theme: String(parsed.theme ?? "").trim(),
      problems: Array.isArray(parsed.problems) ? parsed.problems.map(String) : [],
      sacredScenes: Array.isArray(parsed.sacredScenes) ? parsed.sacredScenes.map(String) : [],
      direction: String(parsed.direction ?? "").trim(),
    };
  } catch (e) {
    warnings.push(`Showrunner memo failed (${e instanceof Error ? e.message : "error"}); the room proceeds from the analysis alone.`);
  }
  const memoBlock = memo.theme
    ? `SHOWRUNNER MEMO\nTheme: ${memo.theme}\nProblems: ${memo.problems.join("; ")}\nSacred scenes (keep): ${memo.sacredScenes.join("; ") || "none"}\nDirection: ${memo.direction}`
    : `WHAT THE ANALYSIS FOUND:\n${fixBriefFor(input.reportCard, input.frameworkId)}`;

  // ── Stage 1: Break the story ──────────────────────────────────────────────
  const pitchSystem = `You are a staff writer pitching a complete beat sheet in a writers' room. You restructure boldly — keep what works, cut what doesn't, add what's missing. Return ONLY valid JSON.`;
  const pitchUser = `${memoBlock}\n\nCURRENT DRAFT SCENES (sluglines you may keep or rework):\n${sceneListText(input.script)}\n\nBEAT BLUEPRINT — every beat, in order:\n${blueprintText}\n\nTARGET: ${input.targetPages} pages total.${castBlock}
Pitch the board: one scene card per scene, covering EVERY beat in order, page budgets summing to ~${input.targetPages}.
"source" rules: "keep" = an existing scene used as-is (EXACT slugline from the list); "rework" = an existing scene rewritten (EXACT slugline); "new" = a brand-new scene.
Return ONLY: {"cards":[{"beat":"<beat name>","slugline":"INT./EXT. ...","source":"keep|rework|new","intent":"what it accomplishes","conflict":"who wants what against what","turn":"how it ends changed","characters":["FROM THE CAST ONLY"],"pages":1.5}]}`;

  tick(`${input.engines.length} engine${input.engines.length === 1 ? "" : "s"} pitch beat sheets in parallel`);
  const pitchResults = await Promise.allSettled(
    input.engines.map(async (engine) => {
      const raw = await complete(engine, pitchSystem, pitchUser, { temperature: 0.8, maxTokens: 2400, timeoutMs: STAGE_TIMEOUT_MS });
      const cards = coerceCards(parseJson<{ cards?: unknown }>(raw, "pitch").cards);
      if (!cards.length) throw new Error("empty pitch");
      tick(`${textAiProviderLabel(engine)}'s pitch is in`);
      return { engine, cards };
    }),
  );
  const pitches = pitchResults
    .filter((r): r is PromiseFulfilledResult<{ engine: TextAiProvider; cards: SceneCard[] }> => r.status === "fulfilled")
    .map((r) => r.value);
  if (!pitches.length) throw new Error("No engine produced a usable beat sheet. Try again or check your engine keys.");

  tick(`${textAiProviderLabel(seats.judge)} merges the board`);
  let board: SceneCard[] = pitches[0].cards;
  if (pitches.length > 1) {
    try {
      const pitchesText = pitches.map((p, i) => `PITCH ${i + 1} (${textAiProviderLabel(p.engine)}):\n${boardText(p.cards)}`).join("\n\n");
      const raw = await complete(seats.judge, `You are the showrunner assembling the story board from the room's pitches. Take the strongest version of each beat wherever it came from; keep the memo's sacred scenes; keep causality tight (this happened, THEREFORE that). Return ONLY valid JSON.`,
        `${memoBlock}\n\nBEAT BLUEPRINT:\n${blueprintText}\n\n${pitchesText}\n\nTARGET: ${input.targetPages} pages.${castBlock}\nReturn the merged board, same schema: {"cards":[...]}`,
        { temperature: 0.4, maxTokens: 2400, timeoutMs: STAGE_TIMEOUT_MS });
      const merged = coerceCards(parseJson<{ cards?: unknown }>(raw, "board merge").cards);
      if (merged.length) board = merged;
      else warnings.push("Board merge returned no cards; using the strongest single pitch.");
    } catch (e) {
      warnings.push(`Board merge failed (${e instanceof Error ? e.message : "error"}); using the strongest single pitch.`);
    }
  }

  // Iterate the OUTLINE (cheap, low-noise) instead of iterating 20 pages of prose.
  const scoreOutline = deps.scoreOutline ?? (async (cards: SceneCard[], blueprint: string) => {
    const raw = await TextAiService.forAnalyst().complete(
      `You are a development executive scoring a screenplay OUTLINE against a story framework. Judge structure only: beat coverage, order, page placement, causality, escalation, and whether each beat turns on a character choice. Return ONLY valid JSON.`,
      `FRAMEWORK BLUEPRINT:\n${blueprint}\n\nTHE BOARD:\n${boardText(cards)}\n\nReturn ONLY: {"score": 0-100, "notes": ["specific structural gaps to fix, empty if none"]}`,
      { temperature: 0.2, maxTokens: 700, timeoutMs: STAGE_TIMEOUT_MS },
    );
    const parsed = parseJson<{ score?: number; notes?: string[] }>(raw, "outline score");
    return { score: Math.max(0, Math.min(100, Number(parsed.score) || 0)), notes: Array.isArray(parsed.notes) ? parsed.notes.map(String) : [] };
  });

  const outlineScores: number[] = [];
  for (let i = 0; i < OUTLINE_MAX_ITERATIONS; i++) {
    tick(`scoring the board (round ${i + 1})`);
    let verdict: { score: number; notes: string[] };
    try {
      verdict = await scoreOutline(board, blueprintText);
    } catch {
      warnings.push("Outline scoring failed; drafting from the current board.");
      break;
    }
    outlineScores.push(verdict.score);
    if (verdict.score >= OUTLINE_TARGET || !verdict.notes.length || i === OUTLINE_MAX_ITERATIONS - 1) break;
    try {
      const raw = await complete(seats.judge, `You are the showrunner revising the story board from the executive's structural notes. Fix exactly what the notes flag; keep everything that already works. Return ONLY valid JSON.`,
        `${memoBlock}\n\nBEAT BLUEPRINT:\n${blueprintText}\n\nCURRENT BOARD:\n${boardText(board)}\n\nNOTES TO FIX:\n${verdict.notes.map((n, j) => `${j + 1}. ${n}`).join("\n")}\n\nTARGET: ${input.targetPages} pages.${castBlock}\nReturn the revised board: {"cards":[...]}`,
        { temperature: 0.4, maxTokens: 2400, timeoutMs: STAGE_TIMEOUT_MS });
      const revised = coerceCards(parseJson<{ cards?: unknown }>(raw, "board revision").cards);
      if (revised.length) board = revised;
      else break;
    } catch {
      warnings.push("Board revision failed; drafting from the last good board.");
      break;
    }
  }
  changeSummary.push(`Board: ${board.length} scenes (${board.filter((c) => c.source === "keep").length} kept, ${board.filter((c) => c.source === "rework").length} reworked, ${board.filter((c) => c.source === "new").length} new); outline score ${outlineScores.join(" → ") || "unscored"}.`);

  // Board is known — replace the provisional total with the real remaining work
  // (non-keep drafts + 2 punch-ups + 2 table-read steps + final score).
  const nonKeepCount = board.filter((c) => c.source !== "keep").length;
  total = step + nonKeepCount + 2 + 2 + 1;

  // ── Stage 2: Draft scene by scene, one voice ──────────────────────────────
  const castNames = input.allowedCast ?? [];
  const drafted: string[] = [];
  const slugUse = new Map<string, number>(); // k-th card for a slug -> k-th occurrence
  for (let i = 0; i < board.length; i++) {
    const card = board[i];
    const key = slugKey(card.slugline);
    const occurrence = slugUse.get(key) ?? 0;
    slugUse.set(key, occurrence + 1);
    const lookup = card.source !== "new" ? sceneTextBySlugline(input.script, card.slugline, occurrence) : { text: "" };
    if (lookup.note) warnings.push(`Board card ${i + 1}: ${lookup.note}`);
    const original = lookup.text;
    if (card.source === "keep") {
      if (original) {
        drafted.push(original); // verbatim — sacred scenes are not touched here
        continue;
      }
      warnings.push(`Keep card "${card.slugline}" did not match any scene in the draft; writing it fresh instead.`);
    }
    tick(`drafting scene ${i + 1}/${board.length} — ${card.slugline.slice(0, 40)}`);
    const soFar = drafted.join("\n\n").slice(-1400);
    try {
      const raw = await complete(seats.drafter, `You are the episode's writer, drafting ONE scene from the approved board. Write in proper Fountain. Dramatize — real choices, real conflict, subtext over statement. Never re-introduce established characters, never recap.\n\n${FOUNTAIN_FORMAT_RULES}${castBlock}`,
        `${memoBlock}\n${styleText ? `\nSTYLE CONTRACT:\n${styleText}\n` : ""}${seriesBlock}
THE CARD (scene ${i + 1} of ${board.length}, beat: ${card.beat}, ~${card.pages} page${card.pages === 1 ? "" : "s"}):
Slugline: ${card.slugline}
Intent: ${card.intent}
Conflict: ${card.conflict}
Turn: ${card.turn}
In the scene: ${card.characters.join(", ") || "per the story"}
${original ? `\nTHE EXISTING SCENE TO REWORK (keep what lands, rewrite what doesn't):\n---\n${original.slice(0, 2200)}\n---\n` : card.source !== "new" ? "\n(The board marked this as an existing scene, but it could not be found — write it fresh, consistent with continuity.)\n" : ""}${soFar ? `\nSTORY SO FAR (continue smoothly from this):\n---\n${soFar}\n---\n` : ""}
Write ONLY this scene's Fountain text, starting with the slugline.`,
        { temperature: 0.75, maxTokens: Math.max(700, Math.min(3000, Math.round(card.pages * 800))), timeoutMs: STAGE_TIMEOUT_MS });
      const scene = cleanupGeneratedScreenplay(raw, castNames).trim();
      drafted.push(scene || (original || `${card.slugline}\n`));
      if (!scene) warnings.push(`Scene ${i + 1} (${card.slugline}) came back empty; kept the original.`);
    } catch (e) {
      warnings.push(`Scene ${i + 1} (${card.slugline}) failed to draft (${e instanceof Error ? e.message : "error"}); ${original ? "kept the original" : "skipped"}.`);
      if (original) drafted.push(original);
    }
  }
  // Join with blank lines only — drafted scenes were cleaned individually, and
  // KEPT scenes must stay byte-exact (a full reclassification here could mutate
  // the user's own hand-written material).
  let script = drafted.join("\n\n").replace(/\n{3,}/g, "\n\n").trim() + "\n";
  changeSummary.push(`Drafted by ${textAiProviderLabel(seats.drafter)} (single voice), ~${estimatePages(script.split("\n").length)} pages.`);

  // ── Stage 3: Punch-up passes on a second engine ───────────────────────────
  const punchPasses: { label: string; instruction: string }[] = [
    {
      label: "dialogue punch-up",
      instruction: `Sharpen ONLY the dialogue: distinct voices, subtext over statement, cut on-the-nose and expository lines, tighten exchanges. Do NOT restructure — keep every slugline, scene order, and action line except minimal trims. Keep total length within ±10%.`,
    },
    {
      label: "continuity + cut pass",
      instruction: `Fix continuity against the knowledge base and series arcs; remove repeated beats, restated information, and duplicate imagery; keep the total at roughly ${input.targetPages} pages. Do NOT add new scenes or characters.`,
    },
  ];
  for (const pass of punchPasses) {
    tick(`${pass.label} (${textAiProviderLabel(seats.punchUp)})`);
    try {
      const raw = await complete(seats.punchUp, `You are the room's punch-up specialist doing one scoped pass. ${pass.instruction} Return ONLY valid JSON. Preserve Fountain formatting.\n\n${FOUNTAIN_FORMAT_RULES}${castBlock}`,
        `${memoBlock}\n${styleText ? `\nSTYLE CONTRACT:\n${styleText}\n` : ""}${kbText ? `\nSTORY KNOWLEDGE BASE:\n${kbText}\n` : ""}${seriesBlock}
THE DRAFT:\n---\n${script}\n---\n
Return ONLY: {"rewrittenScript":"<the complete revised screenplay>","changeSummary":["what you changed"],"warnings":[]}`,
        { temperature: 0.5, maxTokens: 16000, timeoutMs: STAGE_TIMEOUT_MS });
      const parsed = parseRewriteResponse(raw, castNames);
      if (parsed.rewrittenScript.trim().length >= script.length * 0.5) {
        script = parsed.rewrittenScript;
        changeSummary.push(`${pass.label}: ${parsed.changeSummary.slice(0, 3).join("; ") || "done"}.`);
      } else {
        warnings.push(`${pass.label} came back truncated; kept the previous draft.`);
      }
    } catch (e) {
      warnings.push(`${pass.label} failed (${e instanceof Error ? e.message : "error"}); kept the previous draft.`);
    }
  }

  // ── Stage 4: Table read — coverage from a rival, targeted fixes only ──────
  tick(`table read (${textAiProviderLabel(seats.coverage)})`);
  try {
    const raw = await complete(seats.coverage, `You are giving hard-nosed studio coverage on a draft you did not write. Find the weakest MOMENTS (not general notes): scenes that don't turn, dead dialogue, unearned beats. Return ONLY valid JSON.`,
      `TARGET: ${input.targetPages} pages as ${input.frameworkName}.\n${memoBlock}\n\nTHE DRAFT:\n---\n${script}\n---\n\nReturn ONLY: {"flagged":[{"slugline":"<exact slugline>","note":"what fails and the fix"}],"summary":"one paragraph"}. Flag at most 4 scenes; empty list if it genuinely holds.`,
      { temperature: 0.4, maxTokens: 900, timeoutMs: STAGE_TIMEOUT_MS });
    const coverageResult = parseJson<{ flagged?: { slugline?: string; note?: string }[]; summary?: string }>(raw, "coverage");
    const flagged = (coverageResult.flagged ?? []).filter((f) => f.slugline && f.note).slice(0, 4);
    if (flagged.length) {
      tick(`revising ${flagged.length} flagged scene${flagged.length === 1 ? "" : "s"}`);
      const rawFix = await complete(seats.drafter, `You are the episode's writer addressing table-read notes. Revise ONLY the flagged scenes — every other scene stays EXACTLY as written. Return ONLY valid JSON.\n\n${FOUNTAIN_FORMAT_RULES}${castBlock}`,
        `${memoBlock}\n\nNOTES FROM THE TABLE READ:\n${flagged.map((f, i) => `${i + 1}. ${f.slugline}: ${f.note}`).join("\n")}\n\nTHE DRAFT:\n---\n${script}\n---\n
Return ONLY: {"rewrittenScript":"<the complete screenplay with ONLY the flagged scenes revised>","changeSummary":["scene: what changed"],"warnings":[]}`,
        { temperature: 0.6, maxTokens: 16000, timeoutMs: STAGE_TIMEOUT_MS });
      const parsed = parseRewriteResponse(rawFix, castNames);
      if (parsed.rewrittenScript.trim().length >= script.length * 0.5) {
        script = parsed.rewrittenScript;
        changeSummary.push(`Table read: revised ${flagged.map((f) => f.slugline).join("; ")}.`);
      } else {
        warnings.push("Table-read revision came back truncated; kept the punch-up draft.");
      }
    } else {
      changeSummary.push("Table read: no scenes flagged.");
    }
  } catch (e) {
    warnings.push(`Table read failed (${e instanceof Error ? e.message : "error"}); shipped the punch-up draft.`);
  }

  // ── Final score ───────────────────────────────────────────────────────────
  tick("final score");
  let finalReport: ScriptReportCard | null = null;
  let finalScore: number | null = null;
  try {
    finalReport = deps.scoreScript
      ? await deps.scoreScript(script)
      : await runScriptReportCard(
          { script, knowledgeBase: input.knowledgeBase, styleProfile: input.styleProfile, targetPages: input.targetPages, seriesContext: input.seriesContext, frameworks: framework ? [framework] : undefined },
          { samples: 2 },
        );
    finalScore = metricScoreFromCard(finalReport, input.frameworkId);
  } catch {
    warnings.push("Final scoring failed; the draft is unscored.");
  }

  const invented = findInventedCharacters(script, input.allowedCast ?? []);
  if (invented.length) warnings.push(`Cast lock: the room still introduced ${invented.join(", ")}.`);

  onProgress?.({ completed: Math.max(step, total), total: Math.max(step, total), label: "Room: wrapped" });

  return {
    finalScript: script,
    memo,
    board,
    outlineScores,
    finalScore,
    finalReport,
    changeSummary,
    warnings,
    seats: {
      drafter: textAiProviderLabel(seats.drafter),
      judge: textAiProviderLabel(seats.judge),
      punchUp: textAiProviderLabel(seats.punchUp),
      coverage: textAiProviderLabel(seats.coverage),
    },
  };
}
