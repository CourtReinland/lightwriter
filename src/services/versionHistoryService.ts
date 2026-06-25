// Lightweight, per-project version history for the screenplay text.
//
// Model (as specified by the workflow):
//   - Opening or importing a document creates the FIRST snapshot ("open").
//   - Continuous typing collapses into ONE mutable "edit" snapshot that updates
//     in place as the user types.
//   - Each AI-tool application (rewrite / scene descriptions / clean up / fix
//     shot lines / formatting correction / story doctor) SEALS a new immutable
//     "ai" snapshot — AI applies are the commit boundaries.
//   - After an AI commit, the next typing starts a fresh mutable "edit" snapshot.
//
// The pure `append*` helpers hold the collapse/seal logic and are unit-tested
// without any storage; the `VersionHistoryService` object wraps them with
// per-project localStorage persistence.

export type VersionSnapshotType = "open" | "edit" | "ai";

export interface VersionSnapshot {
  id: string;
  type: VersionSnapshotType;
  /** Short human label: "Opened", "Imported", "Edits", "Scene descriptions", … */
  label: string;
  content: string;
  createdAt: number;
}

/** Keep history bounded so it never dominates the localStorage quota. */
export const MAX_SNAPSHOTS = 50;

const STORAGE_PREFIX = "lw-history-";

function storageKey(projectId: string): string {
  return `${STORAGE_PREFIX}${projectId}`;
}

let idCounter = 0;
function nextId(): string {
  idCounter += 1;
  return `v_${Date.now().toString(36)}_${idCounter}`;
}

// ---------------------------------------------------------------------------
// Pure snapshot logic (no storage, fully testable)
// ---------------------------------------------------------------------------

/** Trim to MAX_SNAPSHOTS, always preserving the first (open/import) entry. */
export function pruneSnapshots(snaps: VersionSnapshot[], max = MAX_SNAPSHOTS): VersionSnapshot[] {
  if (snaps.length <= max) return snaps;
  return [snaps[0], ...snaps.slice(snaps.length - (max - 1))];
}

/** Start a fresh history with a single open/import snapshot. */
export function appendOpen(content: string, label: string, now: number, id: string): VersionSnapshot[] {
  return [{ id, type: "open", label, content, createdAt: now }];
}

/** Seal a new immutable AI-tool snapshot at the end of history. */
export function appendAiCommit(
  snaps: VersionSnapshot[],
  content: string,
  label: string,
  now: number,
  id: string,
): VersionSnapshot[] {
  return pruneSnapshots([...snaps, { id, type: "ai", label, content, createdAt: now }]);
}

/**
 * Record a typing edit. Returns the next history array, or `null` when nothing
 * changed (so callers can skip a needless re-render / write).
 *
 * - If content matches the current tail → no-op (covers the autosave that fires
 *   right after an AI commit, and target-pages-only changes).
 * - Else if the tail is an "edit" (and we are not forcing a new entry) → update
 *   it in place, collapsing the typing session into one entry.
 * - Else → append a fresh "edit" entry (tail is open/ai, or `forceNew`).
 */
export function appendEdit(
  snaps: VersionSnapshot[],
  content: string,
  forceNew: boolean,
  now: number,
  id: string,
): VersionSnapshot[] | null {
  const tail = snaps[snaps.length - 1];
  if (tail && tail.content === content) return null;
  if (!forceNew && tail && tail.type === "edit") {
    const updated: VersionSnapshot = { ...tail, content, createdAt: now };
    return [...snaps.slice(0, -1), updated];
  }
  return pruneSnapshots([...snaps, { id, type: "edit", label: "Edits", content, createdAt: now }]);
}

// ---------------------------------------------------------------------------
// Persistence wrapper
// ---------------------------------------------------------------------------

function readStorage(projectId: string): VersionSnapshot[] {
  if (typeof localStorage === "undefined") return [];
  try {
    const raw = localStorage.getItem(storageKey(projectId));
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as VersionSnapshot[]) : [];
  } catch {
    return [];
  }
}

function writeStorage(projectId: string, snaps: VersionSnapshot[]): void {
  if (typeof localStorage === "undefined") return;
  const key = storageKey(projectId);
  try {
    localStorage.setItem(key, JSON.stringify(snaps));
  } catch {
    // Most likely a quota error — drop to the most recent half (keeping the
    // first entry) and try once more before giving up silently.
    try {
      const trimmed = pruneSnapshots(snaps, Math.max(2, Math.floor(MAX_SNAPSHOTS / 2)));
      localStorage.setItem(key, JSON.stringify(trimmed));
    } catch {
      /* give up — history is best-effort, never block editing */
    }
  }
}

export const VersionHistoryService = {
  load(projectId: string): VersionSnapshot[] {
    return readStorage(projectId);
  },

  /** Return existing history, or seed a fresh "open" snapshot if there is none. */
  ensureInitialized(projectId: string, content: string, label = "Opened"): VersionSnapshot[] {
    const existing = readStorage(projectId);
    if (existing.length > 0) return existing;
    const next = appendOpen(content, label, Date.now(), nextId());
    writeStorage(projectId, next);
    return next;
  },

  /** Reset history for a freshly opened/imported document. */
  recordOpen(projectId: string, content: string, label: string): VersionSnapshot[] {
    const next = appendOpen(content, label, Date.now(), nextId());
    writeStorage(projectId, next);
    return next;
  },

  /** Record a typing edit; returns null (and writes nothing) when unchanged. */
  recordEdit(projectId: string, content: string, forceNew = false): VersionSnapshot[] | null {
    const next = appendEdit(readStorage(projectId), content, forceNew, Date.now(), nextId());
    if (next) writeStorage(projectId, next);
    return next;
  },

  /** Seal an immutable AI-tool snapshot. */
  recordAiCommit(projectId: string, content: string, label: string): VersionSnapshot[] {
    const next = appendAiCommit(readStorage(projectId), content, label, Date.now(), nextId());
    writeStorage(projectId, next);
    return next;
  },

  clear(projectId: string): void {
    if (typeof localStorage === "undefined") return;
    try {
      localStorage.removeItem(storageKey(projectId));
    } catch {
      /* ignore */
    }
  },
};
