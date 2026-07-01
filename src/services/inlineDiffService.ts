import { computeLineDiff } from "./lineDiff";

// Turns a before/after pair into DOCUMENT-OFFSET spans for the in-editor inline
// diff overlay: deletion ranges (strikethrough over the ORIGINAL text) and
// insertion points (highlighted widgets showing the new text). Offsets are into
// the BEFORE text, because the overlay leaves the editor document UNMUTATED
// (showing the original) until the user commits — the commit replaces the doc
// with the exact after-text, so these spans are for DISPLAY only and can be
// line-granular without affecting correctness.

export interface DiffDeletion {
  /** Range in the before-text to strike through. */
  from: number;
  to: number;
}

export interface DiffInsertion {
  /** Offset in the before-text at which to show the added text (as a widget). */
  at: number;
  /** The added text (may span multiple lines). */
  text: string;
}

export interface InlineDiff {
  deletions: DiffDeletion[];
  insertions: DiffInsertion[];
  /** True when there is no visible change. */
  empty: boolean;
}

/** One candidate rewrite shown in the editor's inline-diff overlay. */
export interface RewriteDiffCandidate {
  /** The full rewritten script this candidate would apply. */
  afterScript: string;
  /** Short label (e.g. provider name) shown in the overlay bar. */
  label: string;
  /** Metric score of this candidate, if available. */
  score: number | null;
}

export function computeInlineDiff(before: string, after: string): InlineDiff {
  if (before === after) return { deletions: [], insertions: [], empty: true };

  const aLines = before.split("\n");
  // Start offset of each before line.
  const aStart: number[] = [];
  let off = 0;
  for (const line of aLines) {
    aStart.push(off);
    off += line.length + 1; // + newline
  }
  const endOffset = before.length;
  const startAt = (idx: number) => (idx < aStart.length ? aStart[idx] : endOffset);

  const diff = computeLineDiff(before, after);
  const deletions: DiffDeletion[] = [];
  const insertions: DiffInsertion[] = [];

  let aIdx = 0;
  let pendingAdd: string[] = [];
  let delStart = -1;
  let delEnd = -1;

  const flushDel = () => {
    if (delStart >= 0) {
      deletions.push({ from: delStart, to: delEnd });
      delStart = -1;
      delEnd = -1;
    }
  };
  const flushAdd = (at: number) => {
    if (pendingAdd.length) {
      insertions.push({ at, text: pendingAdd.join("\n") });
      pendingAdd = [];
    }
  };

  for (const d of diff) {
    if (d.type === "same") {
      const at = startAt(aIdx);
      flushDel();
      flushAdd(at);
      aIdx++;
    } else if (d.type === "del") {
      const s = startAt(aIdx);
      const e = s + (aLines[aIdx]?.length ?? 0); // strike the text, keep the newline
      if (delStart < 0) delStart = s;
      delEnd = e;
      aIdx++;
    } else {
      // add — collect; it will be inserted at the next boundary.
      pendingAdd.push(d.text);
    }
  }
  const tailAt = startAt(aIdx);
  flushDel();
  flushAdd(tailAt);

  return { deletions, insertions, empty: deletions.length === 0 && insertions.length === 0 };
}
