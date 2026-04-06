import type { BeatAlignmentResult } from "../../services/analysisEngine";
import "./BeatAlignmentCard.css";

interface BeatAlignmentCardProps {
  results: BeatAlignmentResult[];
}

function scoreClass(score: number): string {
  if (score >= 7) return "high";
  if (score >= 4) return "mid";
  return "low";
}

export default function BeatAlignmentCard({ results }: BeatAlignmentCardProps) {
  if (results.length === 0) {
    return (
      <div className="beat-alignment-empty">
        <p>No frameworks active.</p>
        <p className="hint">Toggle a framework overlay first.</p>
      </div>
    );
  }

  // Group by framework
  const groups = new Map<string, BeatAlignmentResult[]>();
  for (const r of results) {
    if (!groups.has(r.frameworkName)) groups.set(r.frameworkName, []);
    groups.get(r.frameworkName)!.push(r);
  }

  return (
    <div className="beat-alignment-list">
      {Array.from(groups.entries()).map(([fwName, beats]) => (
        <div key={fwName} className="beat-framework-group">
          <div
            className="beat-framework-header"
            style={{ borderColor: beats[0].beatColor }}
          >
            <span
              className="beat-framework-dot"
              style={{ background: beats[0].beatColor }}
            />
            {fwName}
          </div>
          {beats.map((b, i) => (
            <div key={i} className="beat-card">
              <div className="beat-card-header">
                <span className="beat-card-name">{b.beatName}</span>
                <span className="beat-card-pages">pp {b.startPage}-{b.endPage}</span>
                <span className={`beat-card-score ${scoreClass(b.score)}`}>
                  {b.score > 0 ? `${b.score}/10` : "—"}
                </span>
              </div>
              {b.accomplished && (
                <div className="beat-card-row">
                  <span className="beat-card-label">✓</span>
                  <span className="beat-card-text">{b.accomplished}</span>
                </div>
              )}
              {b.missing && (
                <div className="beat-card-row">
                  <span className="beat-card-label missing">!</span>
                  <span className="beat-card-text">{b.missing}</span>
                </div>
              )}
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}
