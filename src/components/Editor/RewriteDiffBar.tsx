import "./RewriteDiffBar.css";

interface RewriteDiffBarProps {
  label: string;
  index: number;
  total: number;
  score: number | null;
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
}

// Floating bar shown while a pending rewrite is previewed as an inline diff in the
// editor. Accept commits it, Reject clears it (the doc was never mutated),
// "Compare next" cycles to the next take, and "Re-roll" generates a fresh take
// with the next installed engine — re-rolling just the highlighted text, or the
// whole draft when nothing is selected.
export default function RewriteDiffBar({ label, index, total, score, castWarnings, onAccept, onReject, onCycle, onReRoll, reRolling, nextEngine, error }: RewriteDiffBarProps) {
  return (
    <div className="rewrite-diff-bar">
      <div className="rdb-info">
        <span className="rdb-legend"><span className="rdb-del">deletion</span> <span className="rdb-add">addition</span></span>
        <span className="rdb-label">{label}</span>
        {score !== null && <span className="rdb-score">{score}/100</span>}
        {total > 1 && <span className="rdb-variant">take {index + 1} of {total}</span>}
        {castWarnings && castWarnings.length > 0 && (
          <span className="rdb-cast-warning" title={`This take invented characters outside your script/KB/series cast: ${castWarnings.join(", ")}`}>
            ⚠ adds {castWarnings.slice(0, 2).join(", ")}{castWarnings.length > 2 ? "…" : ""}
          </span>
        )}
        {error && !reRolling && (
          <span className="rdb-error" title={error}>✕ {error.length > 60 ? error.slice(0, 60) + "…" : error}</span>
        )}
      </div>
      <div className="rdb-actions">
        {onReRoll && (
          <button
            className="rdb-btn reroll"
            onClick={onReRoll}
            disabled={reRolling}
            title={`Re-roll the highlighted text (or the whole draft if nothing is selected) with ${nextEngine || "the next engine"}`}
          >
            {reRolling ? "Re-rolling…" : `↻ Re-roll${nextEngine ? ` · ${nextEngine}` : ""}`}
          </button>
        )}
        {total > 1 && (
          <button className="rdb-btn" onClick={onCycle} disabled={reRolling} title="Show the next take">Compare next ›</button>
        )}
        <button className="rdb-btn reject" onClick={onReject} disabled={reRolling} title="Discard — nothing is changed">Reject</button>
        <button className="rdb-btn accept" onClick={onAccept} disabled={reRolling} title="Apply this rewrite to the editor">Accept</button>
      </div>
    </div>
  );
}
