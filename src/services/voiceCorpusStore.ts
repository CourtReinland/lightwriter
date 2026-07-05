// Series-scoped voice corpus: the author's produced scripts, imported once and
// shared by every project in the series. This is the ground truth the voice
// engine measures (VoicePrint), mines ("you said that" line index, contrastive
// pairs), and gates against. Scripts live in localStorage next to the rest of
// the app's data — ~20 episodes of a half-hour show is well under 1MB.

import { computeVoicePrint, type VoicePrint } from "./voiceMetricsService";

export interface VoiceCorpusScript {
  id: string;
  /** Filename or user-facing title, e.g. "03 MM - Sneaky Snake". */
  title: string;
  text: string;
  wordCount: number;
  addedAt: number;
}

const CORPUS_PREFIX = "lw-voice-corpus-";
const PRINT_PREFIX = "lw-voice-print-";

/** Soft ceiling: localStorage is ~5MB shared with everything else. */
const MAX_CORPUS_BYTES = 2_500_000;

function corpusKey(seriesId: string): string {
  return `${CORPUS_PREFIX}${seriesId}`;
}

function printKey(seriesId: string): string {
  return `${PRINT_PREFIX}${seriesId}`;
}

function uid(): string {
  return `vcs_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
}

function read<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

export class VoiceCorpusStore {
  static listScripts(seriesId: string): VoiceCorpusScript[] {
    return read<VoiceCorpusScript[]>(corpusKey(seriesId)) || [];
  }

  static corpusBytes(seriesId: string): number {
    return (localStorage.getItem(corpusKey(seriesId)) || "").length;
  }

  /**
   * Add scripts (e.g. from a multi-file import). Replaces an existing script
   * with the same title so re-importing a revised draft updates in place.
   */
  static addScripts(seriesId: string, inputs: Array<{ title: string; text: string }>): VoiceCorpusScript[] {
    const existing = this.listScripts(seriesId);
    const byTitle = new Map(existing.map((s) => [s.title.trim().toLowerCase(), s]));

    for (const input of inputs) {
      const title = input.title.trim();
      const text = input.text.replace(/\r\n/g, "\n").trim();
      if (!title || !text) continue;
      const prior = byTitle.get(title.toLowerCase());
      const script: VoiceCorpusScript = {
        id: prior?.id || uid(),
        title,
        text,
        wordCount: text.split(/\s+/).filter(Boolean).length,
        addedAt: prior?.addedAt || Date.now(),
      };
      byTitle.set(title.toLowerCase(), script);
    }

    const next = Array.from(byTitle.values()).sort((a, b) => a.title.localeCompare(b.title));
    const serialized = JSON.stringify(next);
    if (serialized.length > MAX_CORPUS_BYTES) {
      throw new Error(
        `Voice corpus would be ${(serialized.length / 1_000_000).toFixed(1)}MB — over the ${(MAX_CORPUS_BYTES / 1_000_000).toFixed(1)}MB limit. Remove a script or trim the imports.`,
      );
    }
    localStorage.setItem(corpusKey(seriesId), serialized);
    // Any corpus change invalidates the computed print.
    localStorage.removeItem(printKey(seriesId));
    return next;
  }

  static removeScript(seriesId: string, scriptId: string): VoiceCorpusScript[] {
    const next = this.listScripts(seriesId).filter((s) => s.id !== scriptId);
    localStorage.setItem(corpusKey(seriesId), JSON.stringify(next));
    localStorage.removeItem(printKey(seriesId));
    return next;
  }

  static clear(seriesId: string): void {
    localStorage.removeItem(corpusKey(seriesId));
    localStorage.removeItem(printKey(seriesId));
  }

  /** The stored print, or null when the corpus changed since last compute. */
  static getPrint(seriesId: string): VoicePrint | null {
    return read<VoicePrint>(printKey(seriesId));
  }

  /** Compute (and persist) the VoicePrint from the current corpus. */
  static computePrint(seriesId: string): VoicePrint {
    const scripts = this.listScripts(seriesId);
    if (scripts.length === 0) throw new Error("Import at least one script into the voice corpus first.");
    const print = computeVoicePrint(scripts.map((s) => ({ title: s.title, text: s.text })));
    localStorage.setItem(printKey(seriesId), JSON.stringify(print));
    return print;
  }
}
