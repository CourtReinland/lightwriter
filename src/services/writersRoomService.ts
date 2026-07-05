import { TextAiService, type TextCompleteOptions } from "./textAiService";
import { type TextAiProvider, textAiProviderLabel, getAnalystProviderSettings } from "./textAiSettingsService";
import { ALL_FRAMEWORKS, computeBeatRanges, estimatePages } from "../frameworks";
import { KnowledgeBaseService, type KnowledgeBase } from "./knowledgeBase";
import { StyleProfileService, type StyleProfile } from "./styleProfile";
import { extractScriptScenes } from "./scriptStructure";
import { cleanupGeneratedScreenplay } from "./generatedScriptCleanup";
import { castLockBlock, findInventedCharacters } from "./castLockService";
import { fixBriefFor } from "./storyDoctorService";
import { compareToVoicePrint, deviationsToNotes, type VoicePrint } from "./voiceMetricsService";
import {
  FOUNTAIN_FORMAT_RULES,
  parseRewriteResponse,
  runScriptReportCard,
  metricScoreFromCard,
  expandToTargetIfNeeded,
  buildMetricRewritePrompt,
  persistReportCard,
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
  /** The original draft's framework score, for before/after comparison. */
  startScore: number;
  finalScore: number | null;
  finalReport: ScriptReportCard | null;
  /** Estimated page count of the delivered draft (vs input.targetPages). */
  finalPages: number;
  /** Final draft's voice-match score against the author's print (when a print was provided). */
  voiceScore: number | null;
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
  /** Keyed engines to seat around the table (drafter first). */
  engines: TextAiProvider[];
  /** When set, the room's final report card is persisted for this project so an
   *  accepted draft's next "Run Script Report Card" cache-hits instead of paying
   *  for a redundant scoring. */
  projectId?: string;
  /** Compiled AUTHOR VOICE PACK block (policy + rules + rhythm targets + contrast). */
  voicePack?: string;
  /** Measured voice print — enables the per-scene voice gate. */
  voicePrint?: VoicePrint | null;
  /** Compiled CHARACTER THOUGHT JOURNALS block for this episode. */
  journalsBlock?: string;
  /** Compiled CHARACTER DOSSIERS block (want/secret/self-lie — played as subtext). */
  dossiersBlock?: string;
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
// Voice gate: calibration on the author's real corpus put held-out author
// scripts at 86-99 and a competent-generic scene at 30. Scenes measure noisier
// than full scripts, so the gate only fires on clear misses.
const VOICE_GATE_MIN = 62;
const VOICE_GATE_MAX_REVISIONS = 6;

// ── Room run log ─────────────────────────────────────────────────────────────
// Every run (including failures and rejected results) leaves a reviewable trace
// in localStorage — "what did the room actually do" must never be unanswerable.

export interface RoomLogEntry {
  at: string;
  frameworkId: string;
  engines: string[];
  seats?: { drafter: string; judge: string; punchUp: string; coverage: string };
  startScore?: number;
  finalScore?: number | null;
  outlineScores?: number[];
  finalPages?: number;
  targetPages?: number;
  memoTheme?: string;
  board?: { beat: string; slugline: string; source: string; pages: number }[];
  voiceScore?: number | null;
  changeSummary?: string[];
  warnings?: string[];
  error?: string;
}

const ROOM_LOG_KEY = (projectId: string) => `lw-room-log-${projectId}`;
const ROOM_LOG_MAX = 5;

export function saveRoomLog(projectId: string, entry: RoomLogEntry): void {
  if (typeof localStorage === "undefined" || !projectId) return;
  try {
    const prior = loadRoomLog(projectId);
    localStorage.setItem(ROOM_LOG_KEY(projectId), JSON.stringify([...prior, entry].slice(-ROOM_LOG_MAX)));
  } catch { /* quota/serialization — logging must never break the run */ }
}

export function loadRoomLog(projectId: string): RoomLogEntry[] {
  if (typeof localStorage === "undefined" || !projectId) return [];
  try {
    const raw = localStorage.getItem(ROOM_LOG_KEY(projectId));
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

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
      // Models drift on field names (observed live: the judge returned
      // location/cast/"pages":"1-2" instead of slugline/characters/number) —
      // accept the common aliases rather than discarding a good board.
      const card = c as Record<string, unknown>;
      if (!card || typeof card !== "object") return null;
      // Strip boardText() annotations that models copy back verbatim in revisions
      // ("INT. KITCHEN (keep, ~2pp)" — observed live compounding every round).
      const slugline = String(card.slugline ?? card.location ?? card.scene ?? card.heading ?? "")
        .replace(/\s*\((?:keep|rework|new)[^)]*\)/gi, "")
        .trim();
      if (!slugline) return null;
      const rawChars = card.characters ?? card.cast ?? [];
      const characters = Array.isArray(rawChars)
        ? rawChars.map((n) => String(n).trim()).filter(Boolean)
        : String(rawChars).split(/[,;]/).map((n) => n.trim()).filter(Boolean);
      let pages = Number(card.pages);
      if (!Number.isFinite(pages)) {
        // "pages": "1-2" (a page RANGE) → span length; "pages": "2" → 2.
        const m = String(card.pages ?? "").match(/^(\d+(?:\.\d+)?)\s*[-–]\s*(\d+(?:\.\d+)?)$/);
        pages = m ? Math.max(0.5, Number(m[2]) - Number(m[1]) + 1) : Number(String(card.pages ?? "").replace(/[^\d.]/g, ""));
      }
      const source = card.source === "keep" || card.source === "rework" ? card.source : "new";
      return {
        beat: String(card.beat ?? "").trim() || "—",
        slugline,
        source,
        intent: String(card.intent ?? "").trim(),
        conflict: String(card.conflict ?? "").trim(),
        turn: String(card.turn ?? "").trim(),
        characters,
        pages: Math.max(0.5, Math.min(6, Number.isFinite(pages) && pages > 0 ? pages : 1)),
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

/** Seat the room: one drafter voice, a judge/punch-up seat, a rival for coverage.
 *  Judge preference: Claude, else the ANALYST provider (the structural model),
 *  else the next distinct engine — never the drafter grading its own pages. */
export function assignSeats(engines: TextAiProvider[]): { drafter: TextAiProvider; judge: TextAiProvider; punchUp: TextAiProvider; coverage: TextAiProvider } {
  const drafter = engines[0];
  const analyst = getAnalystProviderSettings().provider as TextAiProvider;
  const judge =
    engines.includes("claude") && drafter !== "claude" ? "claude"
    : engines.includes(analyst) && analyst !== drafter ? analyst
    : engines.find((p) => p !== drafter) ?? drafter;
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
  const voiceBlock = input.voicePack?.trim() ? `\n${input.voicePack.trim()}\n` : "";
  const journalsText = input.journalsBlock?.trim() ? `\n${input.journalsBlock.trim()}\n` : "";
  const dossiersText = input.dossiersBlock?.trim() ? `\n${input.dossiersBlock.trim()}\n` : "";
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

  // Cards can come back under different keys (or as a bare array) — accept them all.
  const cardsFromRaw = (raw: string, what: string): SceneCard[] => {
    const parsed = parseJson<Record<string, unknown> | unknown[]>(raw, what);
    if (Array.isArray(parsed)) return coerceCards(parsed);
    const obj = parsed as Record<string, unknown>;
    return coerceCards(obj.cards ?? obj.board ?? obj.scenes ?? obj.beatSheet ?? []);
  };

  tick(`${input.engines.length} engine${input.engines.length === 1 ? "" : "s"} pitch beat sheets in parallel`);
  const pitchResults = await Promise.allSettled(
    input.engines.map(async (engine) => {
      const raw = await complete(engine, pitchSystem, pitchUser, { temperature: 0.8, maxTokens: 2400, timeoutMs: STAGE_TIMEOUT_MS });
      const cards = cardsFromRaw(raw, "pitch");
      if (!cards.length) throw new Error("empty pitch");
      tick(`${textAiProviderLabel(engine)}'s pitch is in`);
      return { engine, cards };
    }),
  );
  const pitches = pitchResults
    .filter((r): r is PromiseFulfilledResult<{ engine: TextAiProvider; cards: SceneCard[] }> => r.status === "fulfilled")
    .map((r) => r.value);
  if (!pitches.length) throw new Error("No engine produced a usable beat sheet. Try again or check your engine keys.");

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

  tick(`${textAiProviderLabel(seats.judge)} merges the board`);
  let board: SceneCard[] = pitches[0].cards;
  if (pitches.length > 1) {
    try {
      const pitchesText = pitches.map((p, i) => `PITCH ${i + 1} (${textAiProviderLabel(p.engine)}):\n${boardText(p.cards)}`).join("\n\n");
      const raw = await complete(seats.judge, `You are the showrunner assembling the story board from the room's pitches. Take the strongest version of each beat wherever it came from; keep the memo's sacred scenes; keep causality tight (this happened, THEREFORE that). Return ONLY valid JSON.`,
        `${memoBlock}\n\nBEAT BLUEPRINT:\n${blueprintText}\n\n${pitchesText}\n\nTARGET: ${input.targetPages} pages.${castBlock}\nReturn the merged board, same schema: {"cards":[...]}`,
        { temperature: 0.4, maxTokens: 2400, timeoutMs: STAGE_TIMEOUT_MS });
      const merged = cardsFromRaw(raw, "board merge");
      if (merged.length) board = merged;
      else throw new Error("merge returned no cards");
    } catch (e) {
      // Merge failed: actually FIND the strongest pitch (score each) rather than
      // silently taking whichever engine happened to resolve first.
      warnings.push(`Board merge failed (${e instanceof Error ? e.message : "error"}); scoring the pitches to pick the strongest.`);
      try {
        const scored = await Promise.all(pitches.map(async (p) => ({ p, s: (await scoreOutline(p.cards, blueprintText)).score })));
        scored.sort((a, b) => b.s - a.s);
        board = scored[0].p.cards;
        changeSummary.push(`Merge fallback: used ${textAiProviderLabel(scored[0].p.engine)}'s pitch (outline ${scored.map((x) => `${textAiProviderLabel(x.p.engine)} ${x.s}`).join(", ")}).`);
      } catch {
        warnings.push("Pitch scoring failed too; using the first pitch.");
      }
    }
  }

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
    if (verdict.score >= OUTLINE_TARGET || i === OUTLINE_MAX_ITERATIONS - 1) break;
    // A low score with NO notes must still trigger a revision — "the executive
    // didn't say why" is not "nothing to fix".
    const notes = verdict.notes.length
      ? verdict.notes
      : [`The board scored ${verdict.score}/100 against ${input.frameworkName}. Strengthen beat coverage, order, page placement, and causality; make every beat turn on a clear character choice with visible stakes.`];
    try {
      const raw = await complete(seats.judge, `You are the showrunner revising the story board from the executive's structural notes. Fix exactly what the notes flag; keep everything that already works. Return ONLY valid JSON.`,
        `${memoBlock}\n\nBEAT BLUEPRINT:\n${blueprintText}\n\nCURRENT BOARD:\n${boardText(board)}\n\nNOTES TO FIX:\n${notes.map((n, j) => `${j + 1}. ${n}`).join("\n")}\n\nTARGET: ${input.targetPages} pages.${castBlock}\nReturn the revised board: {"cards":[...]}`,
        { temperature: 0.4, maxTokens: 2400, timeoutMs: STAGE_TIMEOUT_MS });
      const revised = cardsFromRaw(raw, "board revision");
      if (revised.length) board = revised;
      else break;
    } catch {
      warnings.push("Board revision failed; drafting from the last good board.");
      break;
    }
  }
  // Normalize page budgets: models often omit them (cards then default to 1pp),
  // so the room PLANS less material than the target and every later stage
  // inherits the shortfall (observed live: 12 × 1pp cards against a 20pp target
  // delivered a 6pp draft). Scale budgets proportionally toward the target.
  const plannedPages = board.reduce((sum, c) => sum + c.pages, 0);
  if (input.targetPages && plannedPages > 0 && plannedPages < input.targetPages * 0.8) {
    const scale = input.targetPages / plannedPages;
    board = board.map((c) => ({ ...c, pages: Math.max(0.5, Math.min(6, Math.round(c.pages * scale * 2) / 2)) }));
    changeSummary.push(`Board page budgets scaled ${Math.round(plannedPages)}pp → ~${input.targetPages}pp target.`);
  }

  changeSummary.push(`Board: ${board.length} scenes (${board.filter((c) => c.source === "keep").length} kept, ${board.filter((c) => c.source === "rework").length} reworked, ${board.filter((c) => c.source === "new").length} new); outline score ${outlineScores.join(" → ") || "unscored"}.`);

  // Board is known — replace the provisional total with the real remaining work
  // (non-keep drafts + punch-up + expansion + 2 table-read steps + final score).
  const nonKeepCount = board.filter((c) => c.source !== "keep").length;
  total = step + nonKeepCount + 1 + 1 + 2 + 1;

  // ── Stage 2: Draft scene by scene, one voice ──────────────────────────────
  const castNames = input.allowedCast ?? [];
  const drafted: string[] = [];
  const slugUse = new Map<string, number>(); // k-th card for a slug -> k-th occurrence
  let draftAttempts = 0;
  let draftSuccesses = 0;
  let firstDraftError = "";
  let voiceRevisions = 0;
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
    draftAttempts++;
    const sceneSystem = `You are the episode's writer, drafting ONE scene from the approved board. Write in proper Fountain. Dramatize — real choices, real conflict, subtext over statement. Never re-introduce established characters, never recap. Write the FULL ~${card.pages}-page scene — a thin sketch fails the board.\n\n${FOUNTAIN_FORMAT_RULES}${castBlock}`;
    const sceneUser = `${memoBlock}\n${voiceBlock}${dossiersText}${journalsText}${styleText ? `\nSTYLE CONTRACT:\n${styleText}\n` : ""}${seriesBlock}
THE CARD (scene ${i + 1} of ${board.length}, beat: ${card.beat}, ~${card.pages} page${card.pages === 1 ? "" : "s"}):
Slugline: ${card.slugline}
Intent: ${card.intent}
Conflict: ${card.conflict}
Turn: ${card.turn}
In the scene: ${card.characters.join(", ") || "per the story"}
${original ? `\nTHE EXISTING SCENE TO REWORK (keep what lands, rewrite what doesn't):\n---\n${original.slice(0, 2200)}\n---\n` : card.source !== "new" ? "\n(The board marked this as an existing scene, but it could not be found — write it fresh, consistent with continuity.)\n" : ""}${soFar ? `\nSTORY SO FAR (continue smoothly from this):\n---\n${soFar}\n---\n` : ""}
Write ONLY this scene's Fountain text, starting with the slugline.`;
    const sceneOpts = { temperature: 0.75, maxTokens: Math.max(1400, Math.min(4000, Math.round(card.pages * 1300))), timeoutMs: STAGE_TIMEOUT_MS };
    const draftOn = async (seat: TextAiProvider) => cleanupGeneratedScreenplay(await complete(seat, sceneSystem, sceneUser, sceneOpts), castNames).trim();
    try {
      let scene = "";
      try {
        scene = await draftOn(seats.drafter);
      } catch (e) {
        if (seats.judge === seats.drafter) throw e;
        warnings.push(`Scene ${i + 1} (${card.slugline}) failed on ${textAiProviderLabel(seats.drafter)} (${e instanceof Error ? e.message.slice(0, 90) : "error"}); retrying on ${textAiProviderLabel(seats.judge)}.`);
        scene = await draftOn(seats.judge);
      }
      // An empty page is a failure too — give the judge one shot at it.
      if (!scene && seats.judge !== seats.drafter) {
        warnings.push(`Scene ${i + 1} (${card.slugline}) came back empty; retrying on ${textAiProviderLabel(seats.judge)}.`);
        scene = await draftOn(seats.judge);
      }
      // Voice gate: a scene that measures far from the author's print gets ONE
      // targeted revision — same beats, same length, fix only the measured
      // deviations. Capped per run; the revision must actually score better.
      if (scene && input.voicePrint && voiceRevisions < VOICE_GATE_MAX_REVISIONS) {
        const gate = compareToVoicePrint(scene, input.voicePrint);
        if (!gate.lowConfidence && gate.score < VOICE_GATE_MIN) {
          voiceRevisions++;
          tick(`voice gate: scene ${i + 1} measures ${gate.score}/100 — revising for voice`);
          try {
            const revised = cleanupGeneratedScreenplay(
              await complete(
                seats.drafter,
                `You are the same writer revising your own scene ONLY for authorial voice. Keep every story beat, every character, and the scene's length; change rhythm, word choice, and texture to hit the author's measured targets.\n\n${FOUNTAIN_FORMAT_RULES}${castBlock}`,
                `${voiceBlock}VOICE NOTES — measured deviations to fix:\n${deviationsToNotes(gate).map((n, k) => `${k + 1}. ${n}`).join("\n")}\n\nTHE SCENE:\n---\n${scene}\n---\nReturn ONLY the revised scene's Fountain text, starting with the slugline.`,
                sceneOpts,
              ),
              castNames,
            ).trim();
            if (revised && compareToVoicePrint(revised, input.voicePrint).score > gate.score) scene = revised;
          } catch {
            // Gate revision is best-effort; the drafted scene stands.
          }
        }
      }
      drafted.push(scene || (original || `${card.slugline}\n`));
      if (scene) draftSuccesses++;
      else warnings.push(`Scene ${i + 1} (${card.slugline}) came back empty on every seat; ${original ? "kept the original" : "left as a placeholder"}.`);
    } catch (e) {
      const message = e instanceof Error ? e.message : "error";
      if (!firstDraftError) firstDraftError = message;
      warnings.push(`Scene ${i + 1} (${card.slugline}) failed to draft (${message}); ${original ? "kept the original" : "skipped"}.`);
      if (original) drafted.push(original);
    }
  }
  // If the drafter failed on EVERY scene it attempted (a dead API key, most
  // likely), abort loudly — scoring the leftover stub as "the room's draft"
  // produces a garbage number that reads as a writing failure (observed live:
  // an invalid Claude key turned a 12-scene board into a 2-page fragment that
  // honestly scored 15).
  if (draftAttempts > 0 && draftSuccesses === 0) {
    throw new Error(`The drafter (${textAiProviderLabel(seats.drafter)}) failed on every scene — first error: ${firstDraftError.slice(0, 200)}. Check that engine's API key in Settings and run the room again.`);
  }
  // Join with blank lines only — drafted scenes were cleaned individually, and
  // KEPT scenes must stay byte-exact (a full reclassification here could mutate
  // the user's own hand-written material).
  let script = drafted.join("\n\n").replace(/\n{3,}/g, "\n\n").trim() + "\n";
  changeSummary.push(`Drafted by ${textAiProviderLabel(seats.drafter)} (single voice), ~${estimatePages(script.split("\n").length)} pages.`);

  // ── Stage 3: One combined punch-up pass on a second engine ────────────────
  // (Dialogue + continuity + cut in a single 16k call — two whole-script passes
  // doubled the runtime for marginal gain.)
  tick(`punch-up (${textAiProviderLabel(seats.punchUp)})`);
  try {
    const raw = await complete(seats.punchUp, `You are the room's punch-up specialist doing one scoped pass. Sharpen the dialogue (distinct voices, subtext over statement, cut on-the-nose lines), fix continuity against the knowledge base and series arcs, and remove repeated beats and restated information. ${voiceBlock ? "The draft is written in a specific AUTHOR VOICE (pack below) — your sharpening must deepen that voice, never smooth it toward neutral professional style. " : ""}Do NOT restructure — keep every slugline and the scene order. Do NOT add new scenes or characters. Keep total length within ±10%. Return ONLY valid JSON. Preserve Fountain formatting.\n\n${FOUNTAIN_FORMAT_RULES}${castBlock}`,
      `${memoBlock}\n${voiceBlock}${styleText ? `\nSTYLE CONTRACT:\n${styleText}\n` : ""}${kbText ? `\nSTORY KNOWLEDGE BASE:\n${kbText}\n` : ""}${seriesBlock}
THE DRAFT:\n---\n${script}\n---\n
Return ONLY: {"rewrittenScript":"<the complete revised screenplay>","changeSummary":["what you changed"],"warnings":[]}`,
      { temperature: 0.5, maxTokens: 16000, timeoutMs: STAGE_TIMEOUT_MS });
    const parsed = parseRewriteResponse(raw, castNames);
    // The pass is instructed to hold length within ±10%; models over-cut anyway
    // (observed live: a 22pp draft came back 15pp and cost 5+ framework points in
    // page placement). Enforce ±15% — outside that, the punch-up is a rewrite in
    // disguise and the drafted pages win.
    const ratio = parsed.rewrittenScript.trim().length / script.length;
    if (ratio >= 0.85 && ratio <= 1.15) {
      script = parsed.rewrittenScript;
      changeSummary.push(`Punch-up: ${parsed.changeSummary.slice(0, 3).join("; ") || "done"}.`);
    } else {
      warnings.push(`Punch-up changed the length by ${Math.round(Math.abs(1 - ratio) * 100)}% (limit 15%); kept the drafted pages.`);
    }
  } catch (e) {
    warnings.push(`Punch-up failed (${e instanceof Error ? e.message : "error"}); kept the previous draft.`);
  }

  // ── Stage 3b: Grow to the page target — and KEEP growing ──────────────────
  // Compact drafters underwrite their cards; a short draft lands every beat
  // outside its expected page range and tanks the framework score no matter how
  // good the structure is. One expansion pass is not a guarantee (planners fail,
  // writers under-deliver), so loop: plan new scenes → write → re-measure, up to
  // 3 rounds, alternating seats when a round stalls. Stop only at ~target or a
  // genuine stall.
  if (input.targetPages) {
    const expandTarget = Math.floor(input.targetPages * 0.9);
    let pagesNow = estimatePages(script.split("\n").length);
    const expansionSeats: TextAiProvider[] = [seats.drafter, seats.judge, seats.drafter];
    for (let round = 0; round < expansionSeats.length && pagesNow < expandTarget; round++) {
      const seat = expansionSeats[round];
      tick(`expanding ${pagesNow}pp toward the ${input.targetPages}pp target (round ${round + 1}, ${textAiProviderLabel(seat)})`);
      try {
        const expanded = await expandToTargetIfNeeded(
          { rewrittenScript: script, changeSummary: [], warnings: [] },
          {
            targetPages: input.targetPages,
            frameworkId: input.frameworkId,
            reportCard: input.reportCard,
            knowledgeBase: input.knowledgeBase,
            styleProfile: input.styleProfile,
            seriesContext: input.seriesContext,
            allowedCast: input.allowedCast,
          },
          undefined,
          (system, user, options) => complete(seat, system, user, options),
        );
        const newPages = estimatePages(expanded.rewrittenScript.split("\n").length);
        if (expanded.rewrittenScript.trim().length > script.length && newPages > pagesNow) {
          script = expanded.rewrittenScript;
          changeSummary.push(`Expansion round ${round + 1} (${textAiProviderLabel(seat)}): ${pagesNow}pp → ~${newPages}pp.`);
          pagesNow = newPages;
        } else {
          warnings.push(...expanded.warnings);
          // No growth on this seat — the next round tries a different one.
        }
      } catch (e) {
        warnings.push(`Expansion round ${round + 1} failed (${e instanceof Error ? e.message : "error"}).`);
      }
    }
    if (pagesNow < expandTarget) {
      warnings.push(`The draft is ~${pagesNow}pp against the ${input.targetPages}pp target after ${expansionSeats.length} expansion rounds — expect page-placement penalties in the score.`);
    }
  }

  // ── Stage 4: Table read — coverage from a rival, targeted fixes only ──────
  tick(`table read (${textAiProviderLabel(seats.coverage)})`);
  try {
    const coverageSystem = `You are giving hard-nosed studio coverage on a draft you did not write. Find the weakest MOMENTS (not general notes): scenes that don't turn, dead dialogue, unearned beats. Return ONLY valid JSON.`;
    const coverageUser = `TARGET: ${input.targetPages} pages as ${input.frameworkName}.\n${memoBlock}\n\nTHE DRAFT:\n---\n${script}\n---\n\nReturn ONLY: {"flagged":[{"slugline":"<exact slugline>","note":"what fails and the fix"}],"summary":"one paragraph"}. Flag at most 4 scenes; empty list if it genuinely holds.`;
    let raw: string;
    try {
      raw = await complete(seats.coverage, coverageSystem, coverageUser, { temperature: 0.4, maxTokens: 900, timeoutMs: STAGE_TIMEOUT_MS });
    } catch (e) {
      // A dead coverage key must not cost the table read — retry on the judge seat.
      if (seats.coverage === seats.judge) throw e;
      warnings.push(`Coverage seat (${textAiProviderLabel(seats.coverage)}) failed: ${e instanceof Error ? e.message.slice(0, 120) : "error"} — retrying with ${textAiProviderLabel(seats.judge)}.`);
      raw = await complete(seats.judge, coverageSystem, coverageUser, { temperature: 0.4, maxTokens: 900, timeoutMs: STAGE_TIMEOUT_MS });
    }
    const coverageResult = parseJson<{ flagged?: { slugline?: string; note?: string }[]; summary?: string }>(raw, "coverage");
    const flagged = (coverageResult.flagged ?? []).filter((f) => f.slugline && f.note).slice(0, 4);
    if (flagged.length) {
      tick(`revising ${flagged.length} flagged scene${flagged.length === 1 ? "" : "s"}`);
      const fixSystem = `You are the episode's writer addressing table-read notes. Revise ONLY the flagged scenes — every other scene stays EXACTLY as written. Return ONLY valid JSON.\n\n${FOUNTAIN_FORMAT_RULES}${castBlock}`;
      const fixUser = `${memoBlock}\n\nNOTES FROM THE TABLE READ:\n${flagged.map((f, i) => `${i + 1}. ${f.slugline}: ${f.note}`).join("\n")}\n\nTHE DRAFT:\n---\n${script}\n---\n
Return ONLY: {"rewrittenScript":"<the complete screenplay with ONLY the flagged scenes revised>","changeSummary":["scene: what changed"],"warnings":[]}`;
      // The drafter can fumble the strict-JSON revision (observed live with SAO) —
      // retry once on the judge seat before giving up on the notes.
      let parsed: { rewrittenScript: string } | null = null;
      try {
        parsed = parseRewriteResponse(await complete(seats.drafter, fixSystem, fixUser, { temperature: 0.6, maxTokens: 16000, timeoutMs: STAGE_TIMEOUT_MS }), castNames);
      } catch (e) {
        if (seats.judge === seats.drafter) throw e;
        warnings.push(`Table-read revision by ${textAiProviderLabel(seats.drafter)} failed (${e instanceof Error ? e.message.slice(0, 90) : "error"}); retrying with ${textAiProviderLabel(seats.judge)}.`);
        parsed = parseRewriteResponse(await complete(seats.judge, fixSystem, fixUser, { temperature: 0.6, maxTokens: 16000, timeoutMs: STAGE_TIMEOUT_MS }), castNames);
      }
      if (parsed && parsed.rewrittenScript.trim().length >= script.length * 0.5) {
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

  // ── Final score + remedial keep-best pass ─────────────────────────────────
  const startScore = metricScoreFromCard(input.reportCard, input.frameworkId);
  const scoreScript = deps.scoreScript ?? ((s: string) => runScriptReportCard(
    { script: s, knowledgeBase: input.knowledgeBase, styleProfile: input.styleProfile, targetPages: input.targetPages, seriesContext: input.seriesContext, frameworks: framework ? [framework] : undefined },
    { samples: 2 },
  ));
  tick("final score");
  let finalReport: ScriptReportCard | null = null;
  let finalScore: number | null = null;
  try {
    finalReport = await scoreScript(script);
    finalScore = metricScoreFromCard(finalReport, input.frameworkId);
  } catch {
    warnings.push("Final scoring failed; the draft is unscored.");
  }

  // The room must not quietly deliver a draft that scores BELOW the original.
  // One remedial pass: the judge rewrites against the new report's gaps, and we
  // keep whichever draft scores higher.
  if (finalReport && finalScore !== null && finalScore < startScore) {
    tick(`scored ${finalScore} < start ${startScore} — remedial pass (${textAiProviderLabel(seats.judge)})`);
    try {
      const prompt = buildMetricRewritePrompt({
        script,
        knowledgeBase: input.knowledgeBase,
        styleProfile: input.styleProfile,
        targetPages: input.targetPages,
        seriesContext: input.seriesContext,
        reportCard: finalReport,
        metricId: input.frameworkId,
        metricName: input.frameworkName,
        allowedCast: input.allowedCast,
      });
      const raw = await complete(seats.judge, prompt.system, prompt.user, { temperature: 0.5, maxTokens: prompt.maxTokens, timeoutMs: STAGE_TIMEOUT_MS });
      const remedial = parseRewriteResponse(raw, castNames).rewrittenScript;
      if (remedial.trim().length >= script.length * 0.5) {
        const remedialReport = await scoreScript(remedial);
        const remedialScore = metricScoreFromCard(remedialReport, input.frameworkId);
        if (remedialScore > finalScore) {
          script = remedial;
          finalReport = remedialReport;
          finalScore = remedialScore;
          changeSummary.push(`Remedial pass: ${input.frameworkName} recovered to ${remedialScore}.`);
        } else {
          warnings.push(`Remedial pass scored ${remedialScore} (no better than ${finalScore}); kept the room draft.`);
        }
      } else {
        warnings.push("Remedial pass came back truncated; kept the room draft.");
      }
    } catch (e) {
      warnings.push(`Remedial pass failed (${e instanceof Error ? e.message : "error"}).`);
    }
    if (finalScore !== null && finalScore < startScore) {
      warnings.push(`The room's best draft scored ${finalScore} vs your draft's ${startScore} on ${input.frameworkName} — review before accepting.`);
    }
  }

  // Persist the room's final scoring as the project's stored card, keyed to the
  // FINAL script — if the user Accepts, the next "Run Script Report Card" click
  // cache-hits on it instead of paying for a redundant scoring. (Re-score still
  // recomputes fresh; a rejected draft never matches the editor content, so the
  // cache simply never fires for it.)
  if (finalReport && input.projectId && !deps.scoreScript) {
    try {
      persistReportCard(input.projectId, {
        script,
        knowledgeBase: input.knowledgeBase,
        styleProfile: input.styleProfile,
        targetPages: input.targetPages,
        seriesContext: input.seriesContext,
        frameworks: framework ? [framework] : undefined,
      }, finalReport);
    } catch { /* persistence is best-effort */ }
  }

  const invented = findInventedCharacters(script, input.allowedCast ?? []);
  if (invented.length) warnings.push(`Cast lock: the room still introduced ${invented.join(", ")}.`);

  // Final voice measurement (deterministic, free) — how far the delivered draft
  // sits from the author's measured print.
  let voiceScore: number | null = null;
  if (input.voicePrint) {
    const finalVoice = compareToVoicePrint(script, input.voicePrint);
    voiceScore = finalVoice.score;
    changeSummary.push(
      `Voice: ${finalVoice.score}/100 against the author's print${voiceRevisions ? ` (${voiceRevisions} scene${voiceRevisions === 1 ? "" : "s"} revised at the voice gate)` : ""}.`,
    );
    if (!finalVoice.lowConfidence && finalVoice.score < VOICE_GATE_MIN) {
      warnings.push(`The delivered draft measures ${finalVoice.score}/100 on voice — top gap: ${finalVoice.deviations[0]?.note || "see the Voice card"}.`);
    }
  }

  onProgress?.({ completed: Math.max(step, total), total: Math.max(step, total), label: "Room: wrapped" });

  return {
    finalScript: script,
    memo,
    board,
    outlineScores,
    startScore,
    finalScore,
    finalReport,
    finalPages: estimatePages(script.split("\n").length),
    voiceScore,
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
