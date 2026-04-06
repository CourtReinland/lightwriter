import type { SceneDialogueResult } from "../../services/analysisEngine";
import "./DialogueCard.css";

interface DialogueCardProps {
  results: SceneDialogueResult[];
}

function scoreColor(score: number): string {
  if (score >= 7) return "#22c55e";
  if (score >= 4) return "#eab308";
  return "#ef4444";
}

export default function DialogueCard({ results }: DialogueCardProps) {
  if (results.length === 0) {
    return (
      <div className="dialogue-empty">
        <p>No dialogue-heavy scenes found.</p>
      </div>
    );
  }

  return (
    <div className="dialogue-list">
      {results.map((r, i) => (
        <div key={i} className="dialogue-scene">
          <div className="dialogue-scene-header">
            <span className="dialogue-scene-num">#{i + 1}</span>
            <span className="dialogue-scene-heading">{r.heading}</span>
          </div>
          <div className="dialogue-metrics">
            <Metric label="Subtext" value={r.subtext} />
            <Metric label="Natural" value={r.naturalness} />
            <Metric label="Distinct" value={r.distinctiveness} />
          </div>
          {r.notes && <div className="dialogue-notes">{r.notes}</div>}
        </div>
      ))}
    </div>
  );
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <div className="dialogue-metric">
      <div className="metric-label">
        <span>{label}</span>
        <span className="metric-value" style={{ color: scoreColor(value) }}>
          {value > 0 ? value : "—"}
        </span>
      </div>
      <div className="metric-bar">
        <div
          className="metric-fill"
          style={{
            width: `${(value / 10) * 100}%`,
            background: scoreColor(value),
          }}
        />
      </div>
    </div>
  );
}
