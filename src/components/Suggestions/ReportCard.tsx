import type { FrameworkReportScore, ScriptReportCard, SimpleReportScore, StyleReportScore } from "../../services/scriptReportCardService";
import "./ReportCard.css";

interface ReportCardProps {
  report: ScriptReportCard;
  onImproveMetric: (metricId: string, metricName: string) => void;
  loading?: boolean;
}

export default function ReportCard({ report, onImproveMetric, loading = false }: ReportCardProps) {
  return (
    <div className="script-report-card">
      <div className="report-header">
        <div>
          <div className="report-eyebrow">Script Report Card</div>
          <div className={`report-overall ${scoreClass(report.overallScore)}`}>{report.overallScore}/100</div>
        </div>
        <button className="report-copy-btn" onClick={() => navigator.clipboard.writeText(JSON.stringify(report, null, 2))}>Copy JSON</button>
      </div>

      {report.recommendedNextAction && (
        <div className="report-recommendation">{report.recommendedNextAction}</div>
      )}

      <div className="report-section-title">Frameworks</div>
      {report.frameworkScores.map((framework) => (
        <FrameworkRow key={framework.frameworkId} framework={framework} disabled={loading} onImproveMetric={onImproveMetric} />
      ))}

      <div className="report-section-title">Craft Metrics</div>
      <CraftRow id="style" name="Style Match" score={report.styleScore.score} summary={formatStyleSummary(report.styleScore)} disabled={loading} onImproveMetric={onImproveMetric} />
      <CraftRow id="character" name="Character Consistency" score={report.characterScore.score} summary={formatSimpleSummary(report.characterScore)} disabled={loading} onImproveMetric={onImproveMetric} />
      <CraftRow id="pacing" name="Pacing" score={report.pacingScore.score} summary={formatSimpleSummary(report.pacingScore)} disabled={loading} onImproveMetric={onImproveMetric} />

      {report.topFixes.length > 0 && (
        <div className="report-fixes">
          <div className="report-section-title">Top Fixes</div>
          <ol>
            {report.topFixes.slice(0, 5).map((fix, index) => <li key={index}>{fix}</li>)}
          </ol>
        </div>
      )}
    </div>
  );
}

function FrameworkRow({ framework, disabled, onImproveMetric }: { framework: FrameworkReportScore; disabled: boolean; onImproveMetric: (metricId: string, metricName: string) => void }) {
  const lowestBeat = [...framework.beatScores].sort((a, b) => a.score - b.score)[0];
  return (
    <div className="report-row">
      <div className="report-row-main">
        <span className="report-row-name">{framework.frameworkName}</span>
        <span className={`report-score ${scoreClass(framework.score)}`}>{framework.score}</span>
      </div>
      {framework.summary && <div className="report-row-summary">{framework.summary}</div>}
      {lowestBeat && (
        <div className="report-row-detail">
          Weakest: {lowestBeat.beatName} ({lowestBeat.score}){lowestBeat.missing ? " — missing" : ""}
        </div>
      )}
      <button className="report-improve-btn" disabled={disabled} onClick={() => onImproveMetric(framework.frameworkId, framework.frameworkName)}>
        Improve Against {framework.frameworkName}
      </button>
    </div>
  );
}

function CraftRow({ id, name, score, summary, disabled, onImproveMetric }: { id: string; name: string; score: number; summary: string; disabled: boolean; onImproveMetric: (metricId: string, metricName: string) => void }) {
  return (
    <div className="report-row compact">
      <div className="report-row-main">
        <span className="report-row-name">{name}</span>
        <span className={`report-score ${scoreClass(score)}`}>{score}</span>
      </div>
      {summary && <div className="report-row-summary">{summary}</div>}
      <button className="report-improve-btn" disabled={disabled} onClick={() => onImproveMetric(id, name)}>
        Improve {name}
      </button>
    </div>
  );
}

function scoreClass(score: number): string {
  if (score >= 80) return "high";
  if (score >= 60) return "mid";
  return "low";
}

function formatStyleSummary(style: StyleReportScore): string {
  const drift = style.drift.slice(0, 2).join("; ");
  const suggestions = style.suggestions.slice(0, 2).join("; ");
  return drift || suggestions || style.matchedTraits.slice(0, 2).join("; ");
}

function formatSimpleSummary(score: SimpleReportScore): string {
  return score.summary || score.suggestions.slice(0, 2).join("; ");
}
