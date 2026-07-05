// The measured half of the voice engine: parse Fountain into channels
// (dialogue / action / cues / shots), compute a deterministic VoicePrint from
// the author's produced scripts, and score any candidate text against it.
// No LLM anywhere in this file — every number is reproducible, which is what
// lets the print act as a GATE (reject/revise drafts) instead of a vibe.
//
// Complements StyleProfileService (project-scoped, LLM-impressionistic);
// the VoicePrint is series-scoped and arithmetic.

export type FountainLineType =
  | "slugline"
  | "shot"
  | "transition"
  | "cue"
  | "parenthetical"
  | "dialogue"
  | "action"
  | "blank"
  | "title";

export interface DialogueCue {
  /** Cue as written, extensions stripped: "AIDEN THOUGHTS" stays distinct. */
  character: string;
  /** Base character: trailing THOUGHTS / V.O. / O.S. / CONT'D variants stripped. */
  baseCharacter: string;
  /** Full speech text (multi-line joined with spaces). */
  text: string;
  parentheticals: string[];
  /** 0-based index of the containing scene (-1 before the first slugline). */
  sceneIndex: number;
}

export interface FountainChannels {
  sluglines: string[];
  /** Forced shot lines: `!!MS AIDEN ...` and camera-style `.CU ...` lines. */
  shots: string[];
  /** Action blocks (contiguous action lines joined with spaces). */
  actionBlocks: string[];
  dialogue: DialogueCue[];
  transitions: string[];
  sceneCount: number;
  /** Non-blank, non-title line count (for scene-length stats). */
  bodyLineCount: number;
}

export interface ChannelStats {
  sentenceCount: number;
  wordCount: number;
  meanSentenceWords: number;
  stdevSentenceWords: number;
  /** Share of sentences with ≤4 words. */
  shortSentenceRate: number;
  /** Share of sentences with ≥20 words. */
  longSentenceRate: number;
  /** Per-sentence rates. */
  exclamationRate: number;
  questionRate: number;
  /** `?!` / `!?` combos per sentence. */
  interrobangRate: number;
  ellipsisRate: number;
  /** Contractions + informal forms (gonna, wanna…) per 100 words. */
  contractionRate: number;
  /** -ly adverbs per 100 words. */
  adverbLyRate: number;
  /** ALL-CAPS emphasis words (≥2 letters, not "I") per 100 words. */
  capsEmphasisRate: number;
}

export interface SignaturePhrase {
  phrase: string;
  count: number;
  /** How many distinct scripts it appears in. */
  scripts: number;
}

export interface VoicePrint {
  version: 1;
  computedAt: number;
  scriptCount: number;
  totalWords: number;
  dialogue: ChannelStats;
  action: ChannelStats;
  meanDialogueWordsPerCue: number;
  stdevDialogueWordsPerCue: number;
  /** Share of cues with ≤3 words ("What?", "Uh huh."). */
  shortCueRate: number;
  /** dialogue words / (dialogue + action words). */
  dialogueShareOfWords: number;
  cuesPerScene: number;
  /** Parentheticals per cue. */
  parentheticalRate: number;
  /** Forced-shot lines per scene (producer-edition habit). */
  shotLinesPerScene: number;
  sceneCount: number;
  meanSceneLines: number;
  /** Immediate same-sentence repetition inside one cue, per 100 cues. */
  incantationRate: number;
  signaturePhrases: SignaturePhrase[];
  /** Cue-opening interjections ("Ooh", "Ugh"…) per 100 cues, ranked. */
  topInterjections: Array<{ word: string; per100Cues: number }>;
}

export interface VoiceDeviation {
  metric: string;
  expected: string;
  actual: string;
  /** 0..1 — how far outside tolerance. */
  severity: number;
  /** Actionable revision note, phrased for a rewrite prompt. */
  note: string;
}

export interface VoiceMatchReport {
  /** 0-100. 100 = statistically indistinguishable from the corpus. */
  score: number;
  deviations: VoiceDeviation[];
  wordCount: number;
  /** True when the sample is too short for the numbers to mean much. */
  lowConfidence: boolean;
}

// ---------------------------------------------------------------------------
// Tokenizer
// ---------------------------------------------------------------------------

const SCENE_HEADING_RE = /^(INT\.|EXT\.|EST\.|INT\.\/EXT\.|I\/E\.)\s+.+/i;
const FORCED_SHOT_RE = /^!!\s*(.+)$/;
const TRANSITION_RE = /^(?:>?\s*)?(CUT TO:|FADE OUT\.?|FADE IN:?|FADE TO BLACK\.?|DISSOLVE TO:|SMASH CUT TO:|MATCH CUT TO:)$/i;
const CAMERA_CUE_RE = /^(?:CU|MS|WS|ECU|OTS|POV|INSERT|ANGLE|TRACKING|DOLLY|PAN|TILT|WIDE SHOT|MEDIUM SHOT|CLOSE UP|CLOSE-UP|EXTREME CLOSE UP)\b/i;
const CHARACTER_CUE_RE = /^@?([A-Z][A-Z0-9 '\-.]{0,39}?)(?:\s*\(([^)]+)\))?$/;
const TITLE_PAGE_RE = /^[A-Za-z][A-Za-z ]{0,30}:(\s|$)/;
/** Trailing cue variants that still belong to the same character. */
const CUE_VARIANT_RE = /\s+(THOUGHTS?|V\.?O\.?|O\.?S\.?|O\.?C\.?|CONT'?D\.?|PRE-?LAP)$/;

function normalizeApostrophes(text: string): string {
  return text.replace(/[‘’]/g, "'").replace(/[“”]/g, '"');
}

function isCueLine(trimmed: string): { name: string; extension: string } | null {
  if (trimmed !== trimmed.toUpperCase()) return null;
  const match = trimmed.match(CHARACTER_CUE_RE);
  if (!match) return null;
  const name = match[1].trim();
  if (!name || name.length > 30) return null;
  if (!/[A-Z]/.test(name)) return null;
  if (SCENE_HEADING_RE.test(trimmed) || TRANSITION_RE.test(trimmed) || CAMERA_CUE_RE.test(name)) return null;
  if (/^(INT|EXT|EST|THE END|END OF|TITLE|SUPER|FADE)/.test(name)) return null;
  return { name, extension: (match[2] || "").trim() };
}

export function baseCharacterName(cue: string): string {
  let name = cue.trim().toUpperCase();
  for (let i = 0; i < 3; i += 1) {
    const next = name.replace(CUE_VARIANT_RE, "");
    if (next === name) break;
    name = next;
  }
  return name.trim();
}

/**
 * Split a Fountain script into voice channels. Handles both traditional
 * format and the shot-forward "producer edition" (`!!MS …` / `.CU …`) format.
 */
export function extractChannels(script: string): FountainChannels {
  const lines = normalizeApostrophes(script.replace(/\r\n/g, "\n")).split("\n");
  const channels: FountainChannels = {
    sluglines: [],
    shots: [],
    actionBlocks: [],
    dialogue: [],
    transitions: [],
    sceneCount: 0,
    bodyLineCount: 0,
  };

  let inTitlePage = true;
  let currentCue: DialogueCue | null = null;
  let actionBuffer: string[] = [];
  let sceneIndex = -1;

  const flushAction = () => {
    if (actionBuffer.length > 0) {
      channels.actionBlocks.push(actionBuffer.join(" "));
      actionBuffer = [];
    }
  };
  const flushCue = () => {
    if (currentCue && currentCue.text.trim()) channels.dialogue.push(currentCue);
    currentCue = null;
  };

  for (let i = 0; i < lines.length; i += 1) {
    const trimmed = lines[i].trim();

    if (inTitlePage) {
      if (!trimmed) continue;
      if (TITLE_PAGE_RE.test(trimmed)) continue;
      inTitlePage = false;
    }

    if (!trimmed) {
      flushCue();
      flushAction();
      continue;
    }
    channels.bodyLineCount += 1;

    if (SCENE_HEADING_RE.test(trimmed)) {
      flushCue();
      flushAction();
      channels.sluglines.push(trimmed.toUpperCase());
      sceneIndex += 1;
      continue;
    }

    const shot = trimmed.match(FORCED_SHOT_RE);
    if (shot) {
      flushCue();
      flushAction();
      channels.shots.push(shot[1].trim());
      continue;
    }

    // Forced `.SLUGLINE` — the author uses `.CU SHOT OF …` as a shot line.
    if (/^\.[A-Z]/.test(trimmed)) {
      flushCue();
      flushAction();
      const body = trimmed.slice(1).trim();
      if (CAMERA_CUE_RE.test(body)) channels.shots.push(body);
      else {
        channels.sluglines.push(body.toUpperCase());
        sceneIndex += 1;
      }
      continue;
    }

    if (TRANSITION_RE.test(trimmed)) {
      flushCue();
      flushAction();
      channels.transitions.push(trimmed.toUpperCase());
      continue;
    }

    if (currentCue) {
      if (/^\(.*\)$/.test(trimmed)) {
        currentCue.parentheticals.push(trimmed.slice(1, -1).trim());
      } else {
        currentCue.text = currentCue.text ? `${currentCue.text} ${trimmed}` : trimmed;
      }
      continue;
    }

    const cue = isCueLine(trimmed);
    if (cue) {
      // A cue must be followed by something speakable before the next break.
      const next = (lines[i + 1] || "").trim();
      if (next && !SCENE_HEADING_RE.test(next) && !FORCED_SHOT_RE.test(next) && !TRANSITION_RE.test(next) && !isCueLine(next)) {
        flushAction();
        currentCue = {
          character: cue.name,
          baseCharacter: baseCharacterName(cue.name),
          text: "",
          parentheticals: cue.extension ? [cue.extension] : [],
          sceneIndex,
        };
        continue;
      }
    }

    actionBuffer.push(trimmed);
  }

  flushCue();
  flushAction();
  channels.sceneCount = Math.max(channels.sluglines.length, sceneIndex + 1, 0);
  return channels;
}

// ---------------------------------------------------------------------------
// Channel statistics
// ---------------------------------------------------------------------------

const CONTRACTION_RE = /\b\w+'(?:s|t|re|ve|ll|d|m|em)\b/gi;
const INFORMAL_WORDS_RE = /\b(gonna|wanna|gotta|kinda|sorta|ain't|y'all|c'mon|lemme|gimme|dunno|betcha|outta|'cause|cuz)\b/gi;
const INTERJECTIONS = new Set([
  "oh", "ooh", "oooh", "ugh", "uh", "um", "hey", "whoa", "woah", "wow", "huh",
  "aw", "aww", "yeah", "yea", "nah", "no", "hmm", "hm", "ha", "haha", "wait",
  "look", "okay", "ok", "well", "so", "like", "man", "dude", "yo", "psst",
  "shh", "ew", "eww", "yikes", "phew", "oops", "uh-oh", "uh-huh", "yay",
  "woohoo", "hooray", "ahem", "argh", "eek", "gah", "pfft", "mmm", "yum",
]);

function words(text: string): string[] {
  return text.split(/\s+/).filter((w) => /[A-Za-z0-9]/.test(w));
}

function splitSentences(text: string): string[] {
  return text
    .replace(/…/g, "...")
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter((s) => /[A-Za-z0-9]/.test(s));
}

function mean(values: number[]): number {
  return values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0;
}

function stdev(values: number[]): number {
  if (values.length < 2) return 0;
  const m = mean(values);
  return Math.sqrt(mean(values.map((v) => (v - m) * (v - m))));
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export function computeChannelStats(texts: string[]): ChannelStats {
  const sentences = texts.flatMap(splitSentences);
  const sentenceLengths = sentences.map((s) => words(s).length);
  const allText = texts.join(" ");
  const wordList = words(allText);
  const wordCount = wordList.length || 1;
  const sentenceCount = sentences.length || 1;

  const contractions = (allText.match(CONTRACTION_RE) || []).length + (allText.match(INFORMAL_WORDS_RE) || []).length;
  const adverbs = wordList.filter((w) => /^[A-Za-z]{3,}ly[.,!?…"]*$/.test(w)).length;
  const capsWords = wordList.filter((w) => {
    const clean = w.replace(/[^A-Za-z]/g, "");
    return clean.length >= 2 && clean === clean.toUpperCase();
  }).length;

  return {
    sentenceCount: sentences.length,
    wordCount: wordList.length,
    meanSentenceWords: round2(mean(sentenceLengths)),
    stdevSentenceWords: round2(stdev(sentenceLengths)),
    shortSentenceRate: round2(sentenceLengths.filter((l) => l <= 4).length / sentenceCount),
    longSentenceRate: round2(sentenceLengths.filter((l) => l >= 20).length / sentenceCount),
    exclamationRate: round2(sentences.filter((s) => /!/.test(s)).length / sentenceCount),
    questionRate: round2(sentences.filter((s) => /\?/.test(s)).length / sentenceCount),
    interrobangRate: round2(sentences.filter((s) => /\?!|!\?/.test(s)).length / sentenceCount),
    ellipsisRate: round2(sentences.filter((s) => /\.\.\./.test(s)).length / sentenceCount),
    contractionRate: round2((contractions / wordCount) * 100),
    adverbLyRate: round2((adverbs / wordCount) * 100),
    capsEmphasisRate: round2((capsWords / wordCount) * 100),
  };
}

// ---------------------------------------------------------------------------
// Signature phrases (2-4 grams recurring across scripts)
// ---------------------------------------------------------------------------

const STOPWORDS = new Set([
  "the", "a", "an", "and", "or", "but", "of", "to", "in", "on", "at", "for",
  "with", "is", "are", "was", "were", "be", "been", "it", "its", "it's",
  "this", "that", "these", "those", "i", "you", "he", "she", "we", "they",
  "his", "her", "their", "my", "your", "our", "me", "him", "them", "us",
  "as", "by", "from", "into", "out", "up", "down", "over", "not", "do",
  "does", "did", "have", "has", "had", "will", "would", "can", "could",
  "there", "then", "than", "what", "who", "when", "where", "how", "all",
]);

function phraseGrams(text: string, minN: number, maxN: number): string[] {
  const tokens = normalizeApostrophes(text.toLowerCase())
    .replace(/[^a-z0-9'\- ]/g, " ")
    .split(/\s+/)
    .filter(Boolean);
  const grams: string[] = [];
  for (let n = minN; n <= maxN; n += 1) {
    for (let i = 0; i + n <= tokens.length; i += 1) {
      grams.push(tokens.slice(i, i + n).join(" "));
    }
  }
  return grams;
}

export function extractSignaturePhrases(scripts: string[], cap = 25, excludeTokens: Set<string> = new Set()): SignaturePhrase[] {
  const totals = new Map<string, number>();
  const spread = new Map<string, Set<number>>();

  scripts.forEach((script, scriptIdx) => {
    for (const gram of phraseGrams(script, 2, 5)) {
      const tokens = gram.split(" ");
      // A phrase must contain at least one meaningful token — not just
      // stopwords and not just character names ("aiden and aliyah").
      if (tokens.every((t) => STOPWORDS.has(t) || excludeTokens.has(t))) continue;
      totals.set(gram, (totals.get(gram) || 0) + 1);
      if (!spread.has(gram)) spread.set(gram, new Set());
      spread.get(gram)!.add(scriptIdx);
    }
  });

  const candidates = Array.from(totals.entries())
    .filter(([gram, count]) => count >= 3 && (spread.get(gram)?.size || 0) >= Math.min(2, scripts.length))
    .map(([phrase, count]) => ({ phrase, count, scripts: spread.get(phrase)!.size }))
    .sort((a, b) => b.count * b.phrase.length - a.count * a.phrase.length);

  // Prefer the longest form: drop a phrase contained in an already-kept longer
  // phrase unless it occurs substantially more often on its own.
  const kept: SignaturePhrase[] = [];
  for (const candidate of candidates) {
    const swallowed = kept.some(
      (k) => k.phrase.includes(candidate.phrase) && candidate.count <= k.count * 1.25,
    );
    if (!swallowed) kept.push(candidate);
    if (kept.length >= cap) break;
  }
  return kept;
}

// ---------------------------------------------------------------------------
// VoicePrint
// ---------------------------------------------------------------------------

export function computeVoicePrint(scripts: Array<{ title: string; text: string }>): VoicePrint {
  const perScript = scripts.map((s) => extractChannels(s.text));
  const allDialogue = perScript.flatMap((c) => c.dialogue);
  const allAction = perScript.flatMap((c) => c.actionBlocks);
  const cueCount = allDialogue.length || 1;
  const sceneCount = perScript.reduce((a, c) => a + c.sceneCount, 0) || 1;
  const shotCount = perScript.reduce((a, c) => a + c.shots.length, 0);
  const parenCount = allDialogue.reduce((a, d) => a + d.parentheticals.length, 0);

  const cueWordCounts = allDialogue.map((d) => words(d.text).length);
  const dialogueStats = computeChannelStats(allDialogue.map((d) => d.text));
  const actionStats = computeChannelStats(allAction);
  const dialogueWords = dialogueStats.wordCount;
  const actionWords = actionStats.wordCount;

  // Incantations: a sentence immediately repeated inside one cue.
  let incantations = 0;
  for (const d of allDialogue) {
    const sentences = splitSentences(d.text).map((s) => s.toLowerCase().replace(/[^a-z0-9' ]/g, "").trim());
    for (let i = 1; i < sentences.length; i += 1) {
      if (sentences[i] && sentences[i] === sentences[i - 1]) {
        incantations += 1;
        break;
      }
    }
  }

  // Cue-opening interjections.
  const interjectionCounts = new Map<string, number>();
  for (const d of allDialogue) {
    const first = (words(d.text)[0] || "").toLowerCase().replace(/[^a-z\-']/g, "");
    if (INTERJECTIONS.has(first)) interjectionCounts.set(first, (interjectionCounts.get(first) || 0) + 1);
  }
  const topInterjections = Array.from(interjectionCounts.entries())
    .filter(([, count]) => count >= 3)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([word, count]) => ({ word, per100Cues: round2((count / cueCount) * 100) }));

  return {
    version: 1,
    computedAt: Date.now(),
    scriptCount: scripts.length,
    totalWords: dialogueWords + actionWords,
    dialogue: dialogueStats,
    action: actionStats,
    meanDialogueWordsPerCue: round2(mean(cueWordCounts)),
    stdevDialogueWordsPerCue: round2(stdev(cueWordCounts)),
    shortCueRate: round2(cueWordCounts.filter((c) => c <= 3).length / cueCount),
    dialogueShareOfWords: round2(dialogueWords / Math.max(1, dialogueWords + actionWords)),
    cuesPerScene: round2(allDialogue.length / sceneCount),
    parentheticalRate: round2(parenCount / cueCount),
    shotLinesPerScene: round2(shotCount / sceneCount),
    sceneCount,
    meanSceneLines: round2(perScript.reduce((a, c) => a + c.bodyLineCount, 0) / sceneCount),
    incantationRate: round2((incantations / cueCount) * 100),
    // Mine phrases from what the audience hears/sees (dialogue + action),
    // never from cue lines or shot directions — and never from names.
    signaturePhrases: extractSignaturePhrases(
      perScript.map((c) => [...c.dialogue.map((d) => d.text), ...c.actionBlocks].join(" ")),
      25,
      new Set(
        allDialogue.flatMap((d) => d.baseCharacter.toLowerCase().split(/[^a-z0-9'-]+/)).filter(Boolean),
      ),
    ),
    topInterjections,
  };
}

// ---------------------------------------------------------------------------
// Voice match (the gate)
// ---------------------------------------------------------------------------

interface MetricSpec {
  metric: string;
  weight: number;
  expected: number;
  actual: number;
  /** Relative tolerance before any penalty applies. */
  tolerance: number;
  unit: string;
  /** How to phrase the fix when the candidate is high/low. */
  high: string;
  low: string;
}

function formatValue(value: number, unit: string): string {
  return unit ? `${value} ${unit}` : String(value);
}

export function compareToVoicePrint(text: string, print: VoicePrint): VoiceMatchReport {
  const channels = extractChannels(text);
  const cueWordCounts = channels.dialogue.map((d) => words(d.text).length);
  const dialogueStats = computeChannelStats(channels.dialogue.map((d) => d.text));
  const actionStats = computeChannelStats(channels.actionBlocks);
  const cueCount = channels.dialogue.length || 1;
  const totalWords = dialogueStats.wordCount + actionStats.wordCount;
  const lowConfidence = totalWords < 120 || channels.dialogue.length < 6;

  const specs: MetricSpec[] = [
    {
      metric: "dialogue words per cue",
      weight: 18,
      expected: print.meanDialogueWordsPerCue,
      actual: round2(mean(cueWordCounts)),
      tolerance: 0.2,
      unit: "words",
      high: "Speeches run long — break them into shorter back-and-forth exchanges.",
      low: "Lines are clipped shorter than the author writes — let characters finish thoughts.",
    },
    {
      metric: "short-cue rate (≤3 words)",
      weight: 8,
      expected: print.shortCueRate,
      actual: round2(cueWordCounts.filter((c) => c <= 3).length / cueCount),
      tolerance: 0.3,
      unit: "",
      high: "Too many one-beat replies — the author uses them as punctuation, not as the norm.",
      low: "Missing the author's quick one-beat replies (\"What?\", \"Uh huh.\").",
    },
    {
      metric: "dialogue share of words",
      weight: 12,
      expected: print.dialogueShareOfWords,
      actual: round2(dialogueStats.wordCount / Math.max(1, totalWords)),
      tolerance: 0.15,
      unit: "",
      high: "Too talky — the author balances dialogue with visible action.",
      low: "Too much description — this author carries scenes on dialogue.",
    },
    {
      metric: "action sentence length",
      weight: 10,
      expected: print.action.meanSentenceWords,
      actual: actionStats.meanSentenceWords,
      tolerance: 0.25,
      unit: "words",
      high: "Action lines are overwritten — the author writes short, filmable sentences.",
      low: "Action lines are more clipped than the author's.",
    },
    {
      metric: "dialogue sentence length",
      weight: 8,
      expected: print.dialogue.meanSentenceWords,
      actual: dialogueStats.meanSentenceWords,
      tolerance: 0.25,
      unit: "words",
      high: "Dialogue sentences are longer/more formal than the author's.",
      low: "Dialogue sentences are choppier than the author's.",
    },
    {
      metric: "exclamations per dialogue sentence",
      weight: 6,
      expected: print.dialogue.exclamationRate,
      actual: dialogueStats.exclamationRate,
      tolerance: 0.35,
      unit: "",
      high: "Over-exclaiming — dial the energy back to the author's level.",
      low: "Flat energy — this author's characters exclaim more.",
    },
    {
      metric: "questions per dialogue sentence",
      weight: 5,
      expected: print.dialogue.questionRate,
      actual: dialogueStats.questionRate,
      tolerance: 0.35,
      unit: "",
      high: "Too interrogative versus the corpus.",
      low: "Characters ask fewer questions than the author's do.",
    },
    {
      metric: "contractions/informal per 100 dialogue words",
      weight: 8,
      expected: print.dialogue.contractionRate,
      actual: dialogueStats.contractionRate,
      tolerance: 0.25,
      unit: "",
      high: "More slangy than the author.",
      low: "Dialogue is too formal — use contractions and informal forms (gonna, wanna) like the author.",
    },
    {
      metric: "ellipses per dialogue sentence",
      weight: 4,
      expected: print.dialogue.ellipsisRate,
      actual: dialogueStats.ellipsisRate,
      tolerance: 0.4,
      unit: "",
      high: "Too many trailing ellipses.",
      low: "Missing the author's trailing-off rhythm (…).",
    },
    {
      metric: "-ly adverbs per 100 action words",
      weight: 4,
      expected: print.action.adverbLyRate,
      actual: actionStats.adverbLyRate,
      tolerance: 0.4,
      unit: "",
      high: "Adverb-heavy action lines — pick stronger verbs like the author does.",
      low: "Fewer adverbs than the author uses (minor).",
    },
    {
      metric: "parentheticals per cue",
      weight: 4,
      expected: print.parentheticalRate,
      actual: round2(channels.dialogue.reduce((a, d) => a + d.parentheticals.length, 0) / cueCount),
      tolerance: 0.4,
      unit: "",
      high: "Over-directing with parentheticals.",
      low: "The author uses more (wrylies) than this draft does.",
    },
  ];

  if (channels.sceneCount > 0 && print.cuesPerScene > 0) {
    specs.push({
      metric: "cues per scene",
      weight: 4,
      expected: print.cuesPerScene,
      actual: round2(channels.dialogue.length / channels.sceneCount),
      tolerance: 0.3,
      unit: "",
      high: "Scenes run chattier than the corpus.",
      low: "Scenes are quieter than the corpus.",
    });
  }

  const deviations: VoiceDeviation[] = [];
  let penalty = 0;
  let totalWeight = 0;

  for (const spec of specs) {
    totalWeight += spec.weight;
    const scale = Math.max(Math.abs(spec.expected), 0.05);
    const relDev = Math.abs(spec.actual - spec.expected) / scale;
    const over = Math.max(0, relDev - spec.tolerance);
    // Full weight lost when the metric is 100% past tolerance.
    const severity = Math.min(1, over);
    if (severity > 0.05) {
      deviations.push({
        metric: spec.metric,
        expected: formatValue(spec.expected, spec.unit),
        actual: formatValue(spec.actual, spec.unit),
        severity: round2(severity),
        note: spec.actual > spec.expected ? spec.high : spec.low,
      });
    }
    penalty += spec.weight * severity;
  }

  deviations.sort((a, b) => b.severity - a.severity);
  const score = Math.max(0, Math.round(100 - (penalty / Math.max(1, totalWeight)) * 100));
  return { score, deviations, wordCount: totalWords, lowConfidence };
}

// ---------------------------------------------------------------------------
// Prompt serialization
// ---------------------------------------------------------------------------

/** Compact, hard-numbers block for writing prompts (the "rhythm targets"). */
export function voicePrintToPromptBlock(print: VoicePrint): string {
  const lines = [
    `=== VOICE PRINT (measured from ${print.scriptCount} produced script${print.scriptCount === 1 ? "" : "s"} — treat as hard targets) ===`,
    `Dialogue: ~${print.meanDialogueWordsPerCue} words per speech (σ ${print.stdevDialogueWordsPerCue}); ${Math.round(print.shortCueRate * 100)}% of speeches are ≤3 words; sentences avg ${print.dialogue.meanSentenceWords} words.`,
    `Dialogue texture: ${Math.round(print.dialogue.exclamationRate * 100)}% of sentences exclaim, ${Math.round(print.dialogue.questionRate * 100)}% ask; ellipses in ${Math.round(print.dialogue.ellipsisRate * 100)}%; ~${print.dialogue.contractionRate} contractions/informal forms per 100 words${print.dialogue.interrobangRate > 0.02 ? "; uses ?!/!? combos" : ""}.`,
    `Action lines: sentences avg ${print.action.meanSentenceWords} words (σ ${print.action.stdevSentenceWords}); ${print.action.adverbLyRate} -ly adverbs per 100 words — short, filmable, present tense.`,
    `Balance: ${Math.round(print.dialogueShareOfWords * 100)}% of words are dialogue; ~${print.cuesPerScene} speeches per scene; ${print.parentheticalRate} parentheticals per speech.`,
  ];
  if (print.shotLinesPerScene >= 1) {
    lines.push(`Shot habit: ~${print.shotLinesPerScene} forced shot lines (!!WS/MS/CU …) per scene when writing producer editions.`);
  }
  if (print.incantationRate >= 2) {
    lines.push(`Signature move: repeats a sentence back-to-back inside one speech for comic/emphatic effect (~${print.incantationRate}% of speeches).`);
  }
  if (print.topInterjections.length > 0) {
    lines.push(`Cue-opening interjections: ${print.topInterjections.slice(0, 6).map((i) => `"${i.word}"`).join(", ")}.`);
  }
  if (print.signaturePhrases.length > 0) {
    lines.push(`Recurring phrases (use sparingly, they are the author's, not wallpaper): ${print.signaturePhrases.slice(0, 8).map((p) => `"${p.phrase}"`).join("; ")}.`);
  }
  return lines.join("\n");
}

/** Turn a match report's worst deviations into revision notes for a rewrite pass. */
export function deviationsToNotes(report: VoiceMatchReport, max = 4): string[] {
  return report.deviations.slice(0, max).map((d) => `${d.note} (measured ${d.actual} vs the author's ${d.expected} for ${d.metric})`);
}
