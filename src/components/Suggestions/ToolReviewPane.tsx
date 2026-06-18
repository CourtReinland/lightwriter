import { useMemo, useState } from "react";
import { computeLineDiff, collapseUnchanged, diffStats } from "../../services/lineDiff";
import "./ToolReviewPane.css";

export interface ToolReviewData {
  label: string;
  beforeScript: string;
  afterScript: string;
}

interface ToolReviewPaneProps {
  review: ToolReviewData;
  editText: string;
  onEdit: (text: string) => void;
  onApply: () => void;
  onDiscard: () => void;
}

export default function ToolReviewPane({ review, editText, onEdit, onApply, onDiscard }: ToolReviewPaneProps) {
  const [mode, setMode] = useState<"changes" | "edit">("changes");

  // Diff the ORIGINAL against the (possibly edited) result, so edits are reflected.
  const diff = useMemo(() => computeLineDiff(review.beforeScript, editText), [review.beforeScript, editText]);
  const rows = useMemo(() => collapseUnchanged(diff), [diff]);
  const stats = useMemo(() => diffStats(diff), [diff]);

  const beforeLines = review.beforeScript.split("\n").length;
  const afterLines = editText.split("\n").length;
  const noChanges = stats.added === 0 && stats.removed === 0;

  return (
    <div className="tool-review-pane">
      <div className="tool-review-bar">
        <div className="tool-review-heading">
          <span className="tool-review-title">{review.label} — Review Changes</span>
          <span className="tool-review-stats">
            <span className="trv-add">+{stats.added}</span>
            <span className="trv-del">−{stats.removed}</span>
            <span className="trv-dim">{beforeLines} → {afterLines} lines</span>
          </span>
        </div>
        <div className="tool-review-modes">
          <button
            className={mode === "changes" ? "trv-tab active" : "trv-tab"}
            onClick={() => setMode("changes")}
          >
            Changes
          </button>
          <button
            className={mode === "edit" ? "trv-tab active" : "trv-tab"}
            onClick={() => setMode("edit")}
          >
            Edit
          </button>
        </div>
      </div>

      {noChanges && (
        <div className="tool-review-empty">
          {review.label} returned no changes. The AI may have judged the script already complete for this pass.
        </div>
      )}

      {mode === "changes" ? (
        <div className="tool-review-diff">
          {rows.map((row, idx) => {
            if (row.type === "gap") {
              return (
                <div key={idx} className="trv-gap">⋯ {row.hiddenCount} unchanged line{row.hiddenCount === 1 ? "" : "s"} ⋯</div>
              );
            }
            const cls = row.type === "add" ? "trv-line add" : row.type === "del" ? "trv-line del" : "trv-line same";
            const sign = row.type === "add" ? "+" : row.type === "del" ? "−" : " ";
            return (
              <div key={idx} className={cls}>
                <span className="trv-sign">{sign}</span>
                <span className="trv-text">{row.text || " "}</span>
              </div>
            );
          })}
        </div>
      ) : (
        <textarea
          className="tool-review-edit"
          value={editText}
          onChange={(e) => onEdit(e.target.value)}
          spellCheck={false}
        />
      )}

      <div className="tool-review-actions">
        <button className="trv-discard" onClick={onDiscard}>Discard</button>
        <div className="trv-actions-right">
          <span className="trv-hint">
            {mode === "changes" ? "Green = added, red = removed. Switch to Edit to tweak before applying." : "Edit freely, then Apply To Draft."}
          </span>
          <button className="trv-apply" onClick={onApply}>Apply To Draft</button>
        </div>
      </div>
    </div>
  );
}
