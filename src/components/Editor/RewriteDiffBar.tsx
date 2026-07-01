import "./RewriteDiffBar.css";

interface RewriteDiffBarProps {
  label: string;
  index: number;
  total: number;
  score: number | null;
  onAccept: () => void;
  onReject: () => void;
  onCycle: () => void;
}

// Floating bar shown while a pending rewrite is previewed as an inline diff in the
// editor. Accept commits it, Reject clears it (the doc was never mutated), and
// "Compare next" cycles to the next provider's take.
export default function RewriteDiffBar({ label, index, total, score, onAccept, onReject, onCycle }: RewriteDiffBarProps) {
  return (
    <div className="rewrite-diff-bar">
      <div className="rdb-info">
        <span className="rdb-legend"><span className="rdb-del">deletion</span> <span className="rdb-add">addition</span></span>
        <span className="rdb-label">{label}</span>
        {score !== null && <span className="rdb-score">{score}/100</span>}
        {total > 1 && <span className="rdb-variant">take {index + 1} of {total}</span>}
      </div>
      <div className="rdb-actions">
        {total > 1 && (
          <button className="rdb-btn" onClick={onCycle} title="Show the next provider's take">Compare next ›</button>
        )}
        <button className="rdb-btn reject" onClick={onReject} title="Discard — nothing is changed">Reject</button>
        <button className="rdb-btn accept" onClick={onAccept} title="Apply this rewrite to the editor">Accept</button>
      </div>
    </div>
  );
}
