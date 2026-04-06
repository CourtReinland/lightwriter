import type { PacingAnalysis } from "../../services/analysisEngine";
import "./PacingChart.css";

interface PacingChartProps {
  pacing: PacingAnalysis;
}

function scoreColor(score: number): string {
  if (score >= 7) return "#22c55e";
  if (score >= 4) return "#eab308";
  return "#ef4444";
}

export default function PacingChart({ pacing }: PacingChartProps) {
  return (
    <div className="pacing-chart">
      <div className="pacing-overall">
        <span className="overall-label">OVERALL PACING</span>
        <span className="overall-score" style={{ color: scoreColor(pacing.overallScore) }}>
          {pacing.overallScore.toFixed(1)}/10
        </span>
      </div>
      <div className="pacing-scenes">
        {pacing.scenes.map((scene, i) => (
          <div key={i} className="pacing-row">
            <div className="pacing-row-header">
              <span className="pacing-scene-num">#{i + 1}</span>
              <span className="pacing-scene-heading">{scene.heading}</span>
              <span className="pacing-score-num" style={{ color: scoreColor(scene.score) }}>
                {scene.score}/10
              </span>
            </div>
            <div className="pacing-bar-container">
              <div
                className="pacing-bar"
                style={{
                  width: `${(scene.score / 10) * 100}%`,
                  background: scoreColor(scene.score),
                }}
              />
            </div>
            {scene.notes && <div className="pacing-notes">{scene.notes}</div>}
          </div>
        ))}
      </div>
    </div>
  );
}
