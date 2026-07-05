import "./RewriteDiffBar.css";

interface RewriteDiffBarProps {
  label: string;
  index: number;
  total: number;
  score: number | null;
  /** Estimated page count of this take's full script. */
  pages?: number;
  /** Page delta vs the current draft (+grown / −shrunk). */
  pagesDelta?: number;
  /** The project's target page count. */
  targetPages?: number;
  /** Scene-heading delta vs the current draft (+added / -cut). */
  scenesAdded?: number;
  /** Invented-character names when this take violates the cast lock. */
  castWarnings?: string[];
  onAccept: () => void;
  onReject: () => void;
  onCycle: () => void;
  /** Re-roll with the next engine (absent for deterministic tools). */
  onReRoll?: () => void;
  /** True while a bar re-roll is generating (all actions disabled). */
  reRolling?: boolean;
  /** Engine label the next re-roll will use. */
  nextEngine?: string;
  /** Last re-roll failure — shown on the bar (the side panel may be closed). */
  error?: string;
  /** Iterate this take against its own report card until the target score (absent when no metric context). */
  onKeepGoing?: () => void;
  /** The score the keep-going loop drives toward (default 80). */
  keepGoingTarget?: number;
  /** Live loop status while keep-going runs (all actions disabled). */
  keepGoingStatus?: string;
  /** Stop the running loop after its current step (best draft so far is kept). */
  onKeepGoingStop?: () => void;
}

// Floating bar shown while a pending rewrite is previewed as an inline diff in the
// editor. Accept commits it, Reject clears it (the doc was never mutated),
// "Compare next" cycles to the next take, and "Re-roll" generates a fresh take
// with the next installed engine — re-rolling just the highlighted text, or the
// whole draft when nothing is selected.
export default function RewriteDiffBar({ label, index, total, score, pages, pagesDelta, targetPages, scenesAdded, castWarnings, onAccept, onReject, onCycle, onReRoll, reRolling, nextEngine, error, onKeepGoing, keepGoingTarget, keepGoingStatus, onKeepGoingStop }: RewriteDiffBarProps) {
  const busy = Boolean(reRolling) || Boolean(keepGoingStatus);
  return (
    <div className="rewrite-diff-bar">
      <div className="rdb-info">
        <span className="rdb-legend"><span className="rdb-del">deletion</span> <span className="rdb-add">addition</span></span>
        <span className="rdb-label">{label}</span>
        {score !== null && <span className="rdb-score">{score}/100</span>}
        {pages !== undefined && (
          <span className="rdb-pages" title={`This take is ~${pages} pages total${pagesDelta !== undefined ? `, ${pagesDelta >= 0 ? "adding" : "cutting"} ${Math.abs(pagesDelta)} vs your current draft` : ""}${targetPages ? `; your target is ${targetPages} pages` : ""}`}>
            {pages}pp total{pagesDelta !== undefined && pagesDelta !== 0 ? ` (${pagesDelta > 0 ? "+" : "−"}${Math.abs(pagesDelta)}pp)` : ""}{targetPages ? ` · target ${targetPages}` : ""}
          </span>
        )}
        {scenesAdded !== undefined && scenesAdded !== 0 && (
          <span className="rdb-scenes" title="Scene headings added (+) or cut (−) vs your current draft">
            {scenesAdded > 0 ? `+${scenesAdded}` : scenesAdded} scene{Math.abs(scenesAdded) === 1 ? "" : "s"}
          </span>
        )}
        {total > 1 && <span className="rdb-variant">take {index + 1} of {total}</span>}
        {castWarnings && castWarnings.length > 0 && (
          <span className="rdb-cast-warning" title={`This take invented characters outside your script/KB/series cast: ${castWarnings.join(", ")}`}>
            ⚠ adds {castWarnings.slice(0, 2).join(", ")}{castWarnings.length > 2 ? "…" : ""}
          </span>
        )}
        {keepGoingStatus && (
          <span className="rdb-keepgoing-status" title="Keep going is iterating this take — rewrite, re-score, keep the better draft">
            ⟳ {keepGoingStatus}
          </span>
        )}
        {error && !busy && (
          <span className="rdb-error" title={error}>✕ {error.length > 60 ? error.slice(0, 60) + "…" : error}</span>
        )}
      </div>
      <div className="rdb-actions">
        {onKeepGoing && !keepGoingStatus && (
          <button
            className="rdb-btn keepgoing"
            onClick={onKeepGoing}
            disabled={busy}
            title={`Iterate THIS take against its own fresh report card — rewrite, re-score, keep the better draft — until it scores ≥${keepGoingTarget ?? 80} or stalls. Engines rotate between rounds; you never get a worse take.`}
          >
            {`» Keep going${keepGoingTarget ? ` · ${keepGoingTarget}+` : ""}`}
          </button>
        )}
        {keepGoingStatus && onKeepGoingStop && (
          <button
            className="rdb-btn keepgoing-stop"
            onClick={onKeepGoingStop}
            title="Stop after the current step — you keep the best draft found so far"
          >
            ■ Stop
          </button>
        )}
        {onReRoll && (
          <button
            className="rdb-btn reroll"
            onClick={onReRoll}
            disabled={busy}
            title={`Re-roll the highlighted text (or the whole draft if nothing is selected) with ${nextEngine || "the next engine"}`}
          >
            {reRolling ? "Re-rolling…" : `↻ Re-roll${nextEngine ? ` · ${nextEngine}` : ""}`}
          </button>
        )}
        {total > 1 && (
          <button className="rdb-btn" onClick={onCycle} disabled={busy} title="Show the next take">Compare next ›</button>
        )}
        <button className="rdb-btn reject" onClick={onReject} disabled={busy} title="Discard — nothing is changed">Reject</button>
        <button className="rdb-btn accept" onClick={onAccept} disabled={busy} title="Apply this rewrite to the editor">Accept</button>
      </div>
    </div>
  );
}
