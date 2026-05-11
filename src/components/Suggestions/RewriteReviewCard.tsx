import type { ReportCardComparison, RewriteDiffSummary, ScriptReportCard, ScriptRewriteResult } from "../../services/scriptReportCardService";
import "./RewriteReviewCard.css";

interface RewriteReviewCardProps {
  label: string;
  result: ScriptRewriteResult;
  diff: RewriteDiffSummary;
  beforeReport: ScriptReportCard;
  afterReport: ScriptReportCard | null;
  comparison: ReportCardComparison | null;
  loading?: boolean;
  onRescore: () => void;
  onAccept: () => void;
  onRevert: () => void;
  onCopyScript: () => void;
  accepted?: boolean;
}

export default function RewriteReviewCard({
  label,
  result,
  diff,
  beforeReport,
  afterReport,
  comparison,
  loading = false,
  onRescore,
  onAccept,
  onRevert,
  onCopyScript,
  accepted = false,
}: RewriteReviewCardProps) {
  return (
    <div className="rewrite-review-card">
      <div className="rewrite-review-header">
        <div>
          <div className="rewrite-review-eyebrow">Rewrite Review</div>
          <div className="rewrite-review-title">{label}{accepted ? " — Accepted" : ""}</div>
        </div>
        <button className="rewrite-review-copy" disabled={loading} onClick={onCopyScript}>Copy Revised</button>
      </div>

      <div className="rewrite-review-grid">
        <Metric label="Lines" value={`${diff.beforeLines} -> ${diff.afterLines}`} delta={diff.lineDelta} />
        <Metric label="Scene Headings" value={`${diff.beforeSceneHeadings} -> ${diff.afterSceneHeadings}`} delta={diff.sceneHeadingDelta} />
        <Metric label="Characters" value={`${diff.beforeCharacters} -> ${diff.afterCharacters}`} delta={diff.characterDelta} />
        <Metric label="Changed Lines" value={String(diff.changedLineCount)} />
      </div>

      {result.changeSummary.length > 0 && (
        <div className="rewrite-review-section">
          <div className="rewrite-review-section-title">Change Summary</div>
          <ul>
            {result.changeSummary.map((item, index) => <li key={index}>{item}</li>)}
          </ul>
        </div>
      )}

      {result.warnings.length > 0 && (
        <div className="rewrite-review-section warning">
          <div className="rewrite-review-section-title">Warnings</div>
          <ul>
            {result.warnings.map((item, index) => <li key={index}>{item}</li>)}
          </ul>
        </div>
      )}

      <div className="rewrite-score-box">
        <div className="rewrite-review-section-title">Score Comparison</div>
        {comparison && afterReport ? (
          <>
            <div className="rewrite-overall-delta">
              Overall: {comparison.beforeOverall} {'->'} {comparison.afterOverall}
              <span className={comparison.overallDelta >= 0 ? "delta-positive" : "delta-negative"}> {formatSigned(comparison.overallDelta)}</span>
            </div>
            {comparison.topImprovement && (
              <div className="rewrite-score-note">
                Best lift: {comparison.topImprovement.name} {formatSigned(comparison.topImprovement.delta)}
              </div>
            )}
            <div className="rewrite-metric-deltas">
              {comparison.metricDeltas.slice().sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta)).slice(0, 4).map((metric) => (
                <span key={metric.id} className={metric.delta >= 0 ? "delta-chip positive" : "delta-chip negative"}>
                  {metric.name}: {formatSigned(metric.delta)}
                </span>
              ))}
            </div>
          </>
        ) : (
          <div className="rewrite-score-note">
            Pre-rewrite score: {beforeReport.overallScore}/100. Run Re-score After Rewrite to measure score lift.
          </div>
        )}
      </div>

      <div className="rewrite-review-actions">
        <button className="rewrite-secondary-btn" disabled={loading} onClick={onRescore}>Re-score After Rewrite</button>
        <button className="rewrite-secondary-btn" disabled={loading} onClick={onRevert}>Revert Rewrite</button>
        <button className="rewrite-primary-btn" disabled={loading || accepted} onClick={onAccept}>{accepted ? "Accepted" : "Accept Rewrite"}</button>
      </div>
    </div>
  );
}

function Metric({ label, value, delta }: { label: string; value: string; delta?: number }) {
  return (
    <div className="rewrite-review-metric">
      <div className="rewrite-review-section-title">{label}</div>
      <div className="rewrite-review-metric-value">{value}</div>
      {delta !== undefined && <div className={delta >= 0 ? "delta-positive" : "delta-negative"}>{formatSigned(delta)}</div>}
    </div>
  );
}

function formatSigned(value: number): string {
  return value > 0 ? `+${value}` : String(value);
}
