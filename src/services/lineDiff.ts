// Lightweight line-level diff (LCS) used by the whole-script tool Review pane so
// writers can SEE what Expand Descriptions / Clean Up changed, instead of staring
// at a wall of rewritten text and guessing.

export type DiffLineType = "same" | "add" | "del";

export interface DiffLine {
  type: DiffLineType;
  text: string;
}

export interface DiffRow {
  type: DiffLineType | "gap";
  text?: string;
  // For "gap" rows: how many unchanged lines were collapsed.
  hiddenCount?: number;
}

export interface DiffStats {
  added: number;
  removed: number;
}

// Guard: LCS is O(n*m). Scripts are normally well under this; bail to a cheap
// set-based diff for pathological sizes so the UI never hangs.
const LCS_CELL_LIMIT = 4_000_000;

export function computeLineDiff(before: string, after: string): DiffLine[] {
  const a = before.split("\n");
  const b = after.split("\n");
  const n = a.length;
  const m = b.length;

  if (n * m > LCS_CELL_LIMIT) {
    return cheapDiff(a, b);
  }

  // dp[i][j] = LCS length of a[i..] and b[j..]
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }

  const out: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      out.push({ type: "same", text: a[i] });
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      out.push({ type: "del", text: a[i] });
      i++;
    } else {
      out.push({ type: "add", text: b[j] });
      j++;
    }
  }
  while (i < n) out.push({ type: "del", text: a[i++] });
  while (j < m) out.push({ type: "add", text: b[j++] });
  return out;
}

// Fallback for very large inputs: mark lines absent from the other side.
function cheapDiff(a: string[], b: string[]): DiffLine[] {
  const bSet = new Set(b);
  const aSet = new Set(a);
  const out: DiffLine[] = [];
  for (const line of a) if (!bSet.has(line)) out.push({ type: "del", text: line });
  for (const line of b) out.push(aSet.has(line) ? { type: "same", text: line } : { type: "add", text: line });
  return out;
}

export function diffStats(lines: DiffLine[]): DiffStats {
  let added = 0;
  let removed = 0;
  for (const l of lines) {
    if (l.type === "add") added++;
    else if (l.type === "del") removed++;
  }
  return { added, removed };
}

// Collapse long runs of unchanged lines into "gap" rows, keeping a little context
// around each change so the diff is scannable instead of a giant scroll.
export function collapseUnchanged(lines: DiffLine[], context = 3): DiffRow[] {
  const rows: DiffRow[] = [];
  let run: DiffLine[] = [];

  const flushRun = (atStart: boolean, atEnd: boolean) => {
    if (run.length === 0) return;
    // Keep `context` lines adjacent to changes; collapse the middle.
    const head = atStart ? 0 : context;
    const tail = atEnd ? 0 : context;
    if (run.length <= head + tail) {
      run.forEach((l) => rows.push({ type: "same", text: l.text }));
    } else {
      for (let k = 0; k < head; k++) rows.push({ type: "same", text: run[k].text });
      rows.push({ type: "gap", hiddenCount: run.length - head - tail });
      for (let k = run.length - tail; k < run.length; k++) rows.push({ type: "same", text: run[k].text });
    }
    run = [];
  };

  for (let idx = 0; idx < lines.length; idx++) {
    const l = lines[idx];
    if (l.type === "same") {
      run.push(l);
    } else {
      flushRun(rows.length === 0, false);
      rows.push({ type: l.type, text: l.text });
    }
  }
  flushRun(rows.length === 0, true);
  return rows;
}
