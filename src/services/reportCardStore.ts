import type { ScriptReportCard } from "./scriptReportCardService";

// Per-project persistence + content-addressed cache for the script report card.
// Persistence: the AI panel reloads the stored card on mount, so the score
// survives switching tabs (the panel unmounts) and app restarts.
// Cache: `hash` is a fingerprint of the scoring inputs; runScriptReportCard
// returns the stored card verbatim on a hash match, so re-scoring unchanged text
// yields the identical score instead of re-rolling the model.

const KEY = (projectId: string) => `lw-reportcard-${projectId}`;

export interface StoredReportCard {
  hash: string;
  card: ScriptReportCard;
  updatedAt: number;
}

export function loadStoredReportCard(projectId: string): StoredReportCard | null {
  if (typeof localStorage === "undefined" || !projectId) return null;
  try {
    const raw = localStorage.getItem(KEY(projectId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as StoredReportCard;
    return parsed && parsed.card && typeof parsed.hash === "string" ? parsed : null;
  } catch {
    return null;
  }
}

export function saveStoredReportCard(projectId: string, hash: string, card: ScriptReportCard): void {
  if (typeof localStorage === "undefined" || !projectId) return;
  try {
    localStorage.setItem(KEY(projectId), JSON.stringify({ hash, card, updatedAt: Date.now() } satisfies StoredReportCard));
  } catch {
    /* quota — best effort */
  }
}

export function clearStoredReportCard(projectId: string): void {
  if (typeof localStorage === "undefined" || !projectId) return;
  try {
    localStorage.removeItem(KEY(projectId));
  } catch {
    /* best effort */
  }
}
