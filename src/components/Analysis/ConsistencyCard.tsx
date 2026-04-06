import type { CharacterConsistencyResult } from "../../services/analysisEngine";
import "./ConsistencyCard.css";

interface ConsistencyCardProps {
  results: CharacterConsistencyResult[];
}

function scoreClass(score: number): string {
  if (score >= 7) return "high";
  if (score >= 4) return "mid";
  return "low";
}

export default function ConsistencyCard({ results }: ConsistencyCardProps) {
  if (results.length === 0) {
    return (
      <div className="consistency-empty">
        <p>No character profiles found.</p>
        <p className="hint">Add characters to the Knowledge Base first.</p>
      </div>
    );
  }

  return (
    <div className="consistency-list">
      {results.map((r, i) => (
        <div key={i} className={`consistency-card score-${scoreClass(r.score)}`}>
          <div className="consistency-header">
            <span className="consistency-name">{r.characterName}</span>
            <span className={`consistency-score ${scoreClass(r.score)}`}>
              {r.score > 0 ? `${r.score}/10` : "N/A"}
            </span>
          </div>
          {r.notes && <div className="consistency-notes">{r.notes}</div>}
          {r.issues.length > 0 && (
            <ul className="consistency-issues">
              {r.issues.map((issue, j) => (
                <li key={j}>{issue}</li>
              ))}
            </ul>
          )}
        </div>
      ))}
    </div>
  );
}
