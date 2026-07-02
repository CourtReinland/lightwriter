import type { FrameworkReportScore, ScriptReportCard, SimpleReportScore, StyleReportScore } from "../../services/scriptReportCardService";
import "./ReportCard.css";

interface ReportCardProps {
  report: ScriptReportCard;
  onImproveMetric: (metricId: string, metricName: string) => void;
  onRewriteMetric: (metricId: string, metricName: string) => void;
  loading?: boolean;
}

export default function ReportCard({ report, onImproveMetric, onRewriteMetric, loading = false }: ReportCardProps) {
  // The one-button rewrite targets the WEAKEST framework: one pass does it all —
  // restructures to that framework's beat ladder (writing any missing beats),
  // expands to the target page count, and keeps voice/KB/arcs — across every
  // installed engine, shown as an inline diff. Per-framework buttons below let
  // the writer pick a specific framework instead.
  const weakest = report.frameworkScores.length
    ? report.frameworkScores.reduce((lo, f) => (f.score < lo.score ? f : lo))
    : null;
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

      <div className="report-howto">
        <strong>Rewrite w/ AI</strong> does it all in one pass: restructures to the framework&apos;s beats (writing any that are missing), completes to your target page count, and keeps your voice, KB, and series arcs — you approve the inline diff before anything changes. <strong>Plan</strong> just explains the fix.
      </div>

      {weakest && (
        <div className="report-action-row">
          <button
            className="report-rewrite-btn"
            disabled={loading}
            title={`Full rewrite toward ${weakest.frameworkName} (your weakest framework): fills missing beats AND completes to your target pages in the same pass.`}
            onClick={() => onRewriteMetric(weakest.frameworkId, weakest.frameworkName)}
          >
            Rewrite Draft — {weakest.frameworkName} (beats + pages)
          </button>
        </div>
      )}

      <div className="report-section-title">Frameworks</div>
      {report.frameworkScores.map((framework) => (
        <FrameworkRow key={framework.frameworkId} framework={framework} disabled={loading} onImproveMetric={onImproveMetric} onRewriteMetric={onRewriteMetric} />
      ))}

      <div className="report-section-title">Craft Metrics</div>
      <CraftRow id="style" name="Style Match" score={report.styleScore.score} summary={formatStyleSummary(report.styleScore)} disabled={loading} onImproveMetric={onImproveMetric} onRewriteMetric={onRewriteMetric} />
      <CraftRow id="character" name="Character Consistency" score={report.characterScore.score} summary={formatSimpleSummary(report.characterScore)} disabled={loading} onImproveMetric={onImproveMetric} onRewriteMetric={onRewriteMetric} />
      <CraftRow id="pacing" name="Pacing" score={report.pacingScore.score} summary={formatSimpleSummary(report.pacingScore)} disabled={loading} onImproveMetric={onImproveMetric} onRewriteMetric={onRewriteMetric} />

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

function FrameworkRow({ framework, disabled, onImproveMetric, onRewriteMetric }: { framework: FrameworkReportScore; disabled: boolean; onImproveMetric: (metricId: string, metricName: string) => void; onRewriteMetric: (metricId: string, metricName: string) => void }) {
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
      <div className="report-row-actions">
        <button className="report-improve-btn" disabled={disabled} onClick={() => onImproveMetric(framework.frameworkId, framework.frameworkName)}>
          Plan Fix
        </button>
        <button className="report-rewrite-btn small" disabled={disabled} onClick={() => onRewriteMetric(framework.frameworkId, framework.frameworkName)}>
          Rewrite w/ AI
        </button>
      </div>
    </div>
  );
}

function CraftRow({ id, name, score, summary, disabled, onImproveMetric, onRewriteMetric }: { id: string; name: string; score: number; summary: string; disabled: boolean; onImproveMetric: (metricId: string, metricName: string) => void; onRewriteMetric: (metricId: string, metricName: string) => void }) {
  return (
    <div className="report-row compact">
      <div className="report-row-main">
        <span className="report-row-name">{name}</span>
        <span className={`report-score ${scoreClass(score)}`}>{score}</span>
      </div>
      {summary && <div className="report-row-summary">{summary}</div>}
      <div className="report-row-actions">
        <button className="report-improve-btn" disabled={disabled} onClick={() => onImproveMetric(id, name)}>
          Plan Fix
        </button>
        <button className="report-rewrite-btn small" disabled={disabled} onClick={() => onRewriteMetric(id, name)}>
          Rewrite w/ AI
        </button>
      </div>
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
