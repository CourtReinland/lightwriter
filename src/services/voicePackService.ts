// The LLM half of the voice engine. Three artifacts, all series-scoped and
// editable, built FROM the corpus rather than about it:
//
// 1. Contrastive pairs — an LLM writes the competent-but-generic "house style"
//    version of real corpus scenes. The pair [generic, authored] teaches the
//    TRANSFORMATION (models learn "how this author differs from default" far
//    better from contrast than from samples alone).
// 2. Never/always rules — a commentary pass over the pairs harvests the
//    author's refusals ("the default reaches for X; this author does Y").
// 3. Policy — a compact decision-policy paragraph (what to withhold, where to
//    enter scenes, how humor works) distilled from the same contrast.
//
// compileVoicePack() assembles policy + rules + measured rhythm targets
// (deterministic VoicePrint) + one contrast example into a single prompt block
// for the Writers' Room's drafter and punch-up seats.

import { TextAiService } from "./textAiService";
import type { TextAiProvider } from "./textAiSettingsService";
import { VoiceCorpusStore, type VoiceCorpusScript } from "./voiceCorpusStore";
import { extractChannels, voicePrintToPromptBlock, type VoicePrint } from "./voiceMetricsService";

export interface ContrastivePair {
  id: string;
  /** "Episode title — SLUGLINE" for display. */
  sceneRef: string;
  /** The author's real scene (their half of the pair). */
  authored: string;
  /** The LLM's generic rendering of the same beats (the other half). */
  generic: string;
  createdAt: number;
}

export interface VoiceRule {
  id: string;
  kind: "never" | "always";
  text: string;
  enabled: boolean;
  source: "harvested" | "user";
}

export interface VoicePack {
  seriesId: string;
  pairs: ContrastivePair[];
  rules: VoiceRule[];
  policy: string;
  /** Engine that generated the generic halves / harvest. */
  builtWith?: string;
  updatedAt: number;
}

const PACK_PREFIX = "lw-voice-pack-";

function packKey(seriesId: string): string {
  return `${PACK_PREFIX}${seriesId}`;
}

function uid(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
}

export function loadVoicePack(seriesId: string): VoicePack | null {
  try {
    const raw = localStorage.getItem(packKey(seriesId));
    return raw ? (JSON.parse(raw) as VoicePack) : null;
  } catch {
    return null;
  }
}

export function saveVoicePack(pack: VoicePack): void {
  pack.updatedAt = Date.now();
  localStorage.setItem(packKey(pack.seriesId), JSON.stringify(pack));
}

export function clearVoicePack(seriesId: string): void {
  localStorage.removeItem(packKey(seriesId));
}

// ---------------------------------------------------------------------------
// Representative-scene selection (deterministic)
// ---------------------------------------------------------------------------

export interface CorpusScene {
  episode: string;
  heading: string;
  text: string;
  cueCount: number;
}

const SCENE_START_RE = /^((?:INT\.|EXT\.|EST\.|INT\.\/EXT\.|I\/E\.)\s+.+|\.[A-Z].*)$/i;

/** Split a script into scene chunks (slugline → next slugline). */
export function splitScenes(text: string): Array<{ heading: string; text: string }> {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const startIndexes: number[] = [];
  lines.forEach((line, i) => {
    if (SCENE_START_RE.test(line.trim()) && !/^\.(?:CU|MS|WS|ECU)\b/i.test(line.trim())) startIndexes.push(i);
  });
  return startIndexes.map((start, i) => {
    const end = startIndexes[i + 1] ?? lines.length;
    return { heading: lines[start].trim(), text: lines.slice(start, end).join("\n").trim() };
  });
}

/**
 * Pick the most teachable scenes: dialogue-rich, mid-length, spread across
 * episodes (one per episode until n is met, best-first).
 */
export function selectRepresentativeScenes(scripts: VoiceCorpusScript[], n = 5): CorpusScene[] {
  const perEpisode: CorpusScene[][] = scripts.map((script) => {
    const scenes = splitScenes(script.text)
      .map((s) => ({
        episode: script.title,
        heading: s.heading,
        text: s.text,
        cueCount: extractChannels(s.text).dialogue.length,
      }))
      .filter((s) => s.text.length >= 450 && s.text.length <= 3200 && s.cueCount >= 3);
    // Most dialogue first — dialogue carries the most voice per char.
    return scenes.sort((a, b) => b.cueCount - a.cueCount);
  });

  const picks: CorpusScene[] = [];
  for (let round = 0; picks.length < n && round < 3; round += 1) {
    for (const scenes of perEpisode) {
      if (picks.length >= n) break;
      if (scenes[round]) picks.push(scenes[round]);
    }
  }
  return picks.slice(0, n);
}

// ---------------------------------------------------------------------------
// LLM build steps (completion injectable for tests)
// ---------------------------------------------------------------------------

export type VoiceCompletion = (system: string, user: string, options?: { temperature?: number; maxTokens?: number; timeoutMs?: number }) => Promise<string>;

const BUILD_TIMEOUT_MS = 120_000;

function stripFences(text: string): string {
  return text.trim().replace(/^```(?:fountain|json|text)?\s*\n?/i, "").replace(/\n?```\s*$/i, "").trim();
}

async function makeGenericHalf(scene: CorpusScene, complete: VoiceCompletion): Promise<string> {
  const system = `You are a competent, professional, completely conventional screenwriter. Rewrite the given scene in neutral industry "house style" — the way a capable staff writer with NO personal voice would write it.
Keep: the same beats, events, characters, and scene outcome, in proper Fountain format, at roughly the same length.
Remove: every stylistic idiosyncrasy — unusual punctuation habits, repeated-phrase runs, interjections, fragments, forced shot lines (fold them into action), quirky rhythm. Write smooth, grammatical, professional, forgettable pages.
Return ONLY the Fountain text of the rewritten scene.`;
  const user = `Rewrite this scene in neutral house style:\n---\n${scene.text}\n---`;
  const generic = stripFences(await complete(system, user, { temperature: 0.4, maxTokens: 2600, timeoutMs: BUILD_TIMEOUT_MS }));
  if (!generic || generic.length < scene.text.length * 0.3) throw new Error("generic rewrite came back too short");
  return generic;
}

async function harvestRulesAndPolicy(
  pairs: ContrastivePair[],
  printBlock: string,
  complete: VoiceCompletion,
): Promise<{ rules: Array<{ kind: "never" | "always"; text: string }>; policy: string }> {
  const pairsText = pairs
    .slice(0, 4)
    .map(
      (p, i) =>
        `PAIR ${i + 1} (${p.sceneRef}):\n[GENERIC VERSION]\n${p.generic.slice(0, 1500)}\n[THE AUTHOR'S ACTUAL SCENE]\n${p.authored.slice(0, 1500)}`,
    )
    .join("\n\n");

  const system = `You are a forensic style analyst. You are given pairs of scenes: a competent GENERIC version and the AUTHOR'S ACTUAL version of the same beats, plus measured rhythm statistics. Your job is to extract the author's voice as OPERATING RULES — the specific places where this author deviates from professional default.
Rules must be concrete and checkable while writing ("never let a character answer the question that was asked" — not "be more playful"). Derive them ONLY from differences visible in the pairs and the measurements. Return ONLY valid JSON.`;
  const user = `${printBlock}\n\n${pairsText}\n\nReturn ONLY:
{"rules":[{"kind":"never","text":"what the generic version does that the author never does"},{"kind":"always","text":"what the author does that the generic version misses"}],"policy":"5-8 sentences of decision policy: where the author enters/exits scenes, what they withhold vs state, how their humor works, how emotion is shown, what they do with description. Written as instructions to a writer impersonating them."}
Give 8-14 rules total, mixed kinds, most-distinctive first.`;

  const raw = stripFences(await complete(system, user, { temperature: 0.3, maxTokens: 2000, timeoutMs: BUILD_TIMEOUT_MS }));
  const jsonStart = raw.indexOf("{");
  const parsed = JSON.parse(raw.slice(jsonStart >= 0 ? jsonStart : 0)) as {
    rules?: Array<{ kind?: string; text?: string }>;
    policy?: string;
  };
  const rules = (Array.isArray(parsed.rules) ? parsed.rules : [])
    .map((r) => ({ kind: r.kind === "always" ? ("always" as const) : ("never" as const), text: String(r.text || "").trim() }))
    .filter((r) => r.text.length > 0)
    .slice(0, 16);
  return { rules, policy: String(parsed.policy || "").trim() };
}

export interface BuildVoicePackOptions {
  provider?: TextAiProvider;
  pairCount?: number;
  onProgress?: (label: string) => void;
  /** Injectable for tests. */
  complete?: VoiceCompletion;
}

/**
 * Full build: pick representative scenes → generic halves → harvest rules +
 * policy → persist. Requires a computed VoicePrint (rhythm targets feed the
 * harvest) and at least one API key.
 */
export async function buildVoicePack(seriesId: string, options: BuildVoicePackOptions = {}): Promise<VoicePack> {
  const scripts = VoiceCorpusStore.listScripts(seriesId);
  if (scripts.length === 0) throw new Error("Import scripts into the voice corpus first.");
  const print = VoiceCorpusStore.getPrint(seriesId) ?? VoiceCorpusStore.computePrint(seriesId);

  const service = options.provider ? TextAiService.forProvider(options.provider) : new TextAiService();
  const complete: VoiceCompletion = options.complete ?? ((system, user, opts) => service.complete(system, user, opts));
  const progress = options.onProgress ?? (() => {});

  const scenes = selectRepresentativeScenes(scripts, options.pairCount ?? 5);
  if (scenes.length === 0) throw new Error("No dialogue-rich scenes found in the corpus to build pairs from.");

  const pairs: ContrastivePair[] = [];
  for (let i = 0; i < scenes.length; i += 1) {
    const scene = scenes[i];
    progress(`writing generic half ${i + 1}/${scenes.length} (${scene.episode.slice(0, 28)})`);
    try {
      const generic = await makeGenericHalf(scene, complete);
      pairs.push({
        id: uid("vp"),
        sceneRef: `${scene.episode} — ${scene.heading}`,
        authored: scene.text,
        generic,
        createdAt: Date.now(),
      });
    } catch {
      // A failed pair is skipped, not fatal — 3 good pairs beat 5 with garbage.
    }
  }
  if (pairs.length === 0) throw new Error("Every generic-half generation failed — check the engine's API key.");

  progress("harvesting never/always rules + policy");
  const { rules, policy } = await harvestRulesAndPolicy(pairs, voicePrintToPromptBlock(print), complete);

  const existing = loadVoicePack(seriesId);
  const userRules = (existing?.rules || []).filter((r) => r.source === "user");
  const pack: VoicePack = {
    seriesId,
    pairs,
    rules: [
      ...userRules,
      ...rules.map((r) => ({ id: uid("vr"), kind: r.kind, text: r.text, enabled: true, source: "harvested" as const })),
    ],
    policy,
    builtWith: options.provider,
    updatedAt: Date.now(),
  };
  saveVoicePack(pack);
  return pack;
}

// ---------------------------------------------------------------------------
// Compilation (pack -> prompt block)
// ---------------------------------------------------------------------------

/**
 * Assemble the prompt block for writing passes. Budgeted: policy + rules +
 * measured rhythm targets + ONE contrast excerpt (the shortest pair).
 */
export function compileVoicePack(pack: VoicePack, print: VoicePrint | null, budgetChars = 5200): string {
  const lines: string[] = [
    "=== AUTHOR VOICE PACK (write as THIS author — not as a generic professional) ===",
  ];
  if (pack.policy) lines.push(`POLICY:\n${pack.policy}`);

  const enabled = pack.rules.filter((r) => r.enabled && r.text.trim());
  const always = enabled.filter((r) => r.kind === "always").map((r) => `+ ${r.text}`);
  const never = enabled.filter((r) => r.kind === "never").map((r) => `- ${r.text}`);
  if (always.length) lines.push(`ALWAYS:\n${always.join("\n")}`);
  if (never.length) lines.push(`NEVER:\n${never.join("\n")}`);
  if (print) lines.push(voicePrintToPromptBlock(print));

  let block = lines.join("\n\n");

  // One contrast example if it fits — the shortest pair, both sides truncated.
  const shortest = [...pack.pairs].sort((a, b) => a.authored.length - b.authored.length)[0];
  if (shortest) {
    const excerpt = `CONTRAST EXAMPLE (a generic draft of a beat vs how the author ACTUALLY writes it — study the difference):\n[GENERIC]\n${shortest.generic.slice(0, 750)}\n[THE AUTHOR]\n${shortest.authored.slice(0, 750)}`;
    if (block.length + excerpt.length + 2 <= budgetChars) block = `${block}\n\n${excerpt}`;
  }

  return block.length > budgetChars ? block.slice(0, budgetChars) : block;
}

/** Convenience: compiled block for a series, or "" when nothing is built. */
export function compiledVoicePackFor(seriesId: string | undefined | null): string {
  if (!seriesId) return "";
  const pack = loadVoicePack(seriesId);
  if (!pack) return "";
  return compileVoicePack(pack, VoiceCorpusStore.getPrint(seriesId));
}
