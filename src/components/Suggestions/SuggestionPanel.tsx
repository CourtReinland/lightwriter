import { useState, useCallback } from "react";
import { getSelectedTextAiProviderSettings, textAiProviderLabel } from "../../services/textAiSettingsService";
import { rewriteScriptWithShotDirections, type ShotPassProgress } from "../../services/shotDirectionService";
import { runScriptReportCard, generateMetricImprovementPlan, rewriteScriptForMetric, fillScriptGaps, summarizeRewriteDiff, compareReportCards, type ScriptReportCard, type ScriptRewriteResult, type RewriteDiffSummary, type ReportCardComparison } from "../../services/scriptReportCardService";
import {
  generate,
  isAnalysisMode,
  type OrchestratorMode,
  type OrchestratorContext,
} from "../../services/aiOrchestrator";
import type { KnowledgeBase } from "../../services/knowledgeBase";
import type { StyleProfile } from "../../services/styleProfile";
import type { ComputedBeat } from "../../frameworks/utils";
import ApiKeyDialog from "./ApiKeyDialog";
import SuggestionCard from "./SuggestionCard";
import AnalysisCard from "./AnalysisCard";
import ReportCard from "./ReportCard";
import RewriteReviewCard from "./RewriteReviewCard";
import "./SuggestionPanel.css";

interface SuggestionPanelProps {
  selectedText: string;
  contextText: string;
  fullScript: string;
  cursorLine: number;
  cursorBeats: ComputedBeat[];
  knowledgeBase: KnowledgeBase | null;
  styleProfile: StyleProfile | null;
  targetPages: number;
  onApply: (text: string) => void;
  onInsertBelow: (text: string) => void;
  onReplaceScript: (text: string) => void;
}

interface RewriteReviewState {
  id: number;
  label: string;
  beforeScript: string;
  afterScript: string;
  beforeReport: ScriptReportCard;
  afterReport: ScriptReportCard | null;
  comparison: ReportCardComparison | null;
  result: ScriptRewriteResult;
  diff: RewriteDiffSummary;
  accepted: boolean;
}

const WRITING_MODES: { id: OrchestratorMode; label: string; icon: string }[] = [
  { id: "improve_dialogue", label: "Improve", icon: "^" },
  { id: "expand_scene", label: "Expand", icon: "+" },
  { id: "compress", label: "Compress", icon: "-" },
  { id: "alternative_line", label: "Alt Lines", icon: "~" },
  { id: "add_action", label: "Action", icon: "!" },
  { id: "add_shots", label: "Shots", icon: "MS" },
  { id: "fix_formatting", label: "Fix Fmt", icon: "#" },
];

const ADVANCED_MODES: { id: OrchestratorMode; label: string; icon: string; needsSelection: boolean }[] = [
  { id: "smart_continue", label: "Continue", icon: ">>", needsSelection: false },
  { id: "scene_builder", label: "Scene Build", icon: "[]", needsSelection: false },
  { id: "character_voice", label: "Char Voice", icon: "@", needsSelection: true },
  { id: "instant_critique", label: "Critique", icon: "?!", needsSelection: true },
  { id: "plot_hole_check", label: "Plot Holes", icon: "!?", needsSelection: true },
  { id: "beat_alignment_check", label: "Beat Check", icon: "<>", needsSelection: true },
];

export default function SuggestionPanel({
  selectedText,
  contextText,
  fullScript,
  cursorLine,
  cursorBeats,
  knowledgeBase,
  styleProfile,
  targetPages,
  onApply,
  onInsertBelow,
  onReplaceScript,
}: SuggestionPanelProps) {
  const [textAiSettings, setTextAiSettings] = useState(() => getSelectedTextAiProviderSettings());
  const [showKeyDialog, setShowKeyDialog] = useState(false);
  const [loading, setLoading] = useState(false);
  const [suggestion, setSuggestion] = useState<string | null>(null);
  const [lastMode, setLastMode] = useState<OrchestratorMode | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [customPrompt, setCustomPrompt] = useState("");
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [charSelect, setCharSelect] = useState<string>("");
  const [shotPassProgress, setShotPassProgress] = useState<ShotPassProgress | null>(null);
  const [reportCard, setReportCard] = useState<ScriptReportCard | null>(null);
  const [rewriteReview, setRewriteReview] = useState<RewriteReviewState | null>(null);

  const handleFullShotPass = useCallback(async () => {
    const currentSettings = getSelectedTextAiProviderSettings();
    setTextAiSettings(currentSettings);
    if (!currentSettings.apiKey.trim()) {
      setShowKeyDialog(true);
      return;
    }
    if (!fullScript.trim()) {
      setError("No script content to rewrite.");
      return;
    }
    const confirmed = window.confirm(
      `Run a full-script shot pass with ${textAiProviderLabel(currentSettings.provider)}? This will send the script scene-by-scene and replace the editor text with a shot-annotated version. Undo remains available in the editor.`,
    );
    if (!confirmed) return;

    setLoading(true);
    setError(null);
    setSuggestion(null);
    setLastMode(null);
    setShotPassProgress({ completed: 0, total: 1, label: "Starting full-script shot pass..." });

    try {
      const rewritten = await rewriteScriptWithShotDirections(
        fullScript,
        currentSettings.apiKey,
        knowledgeBase,
        setShotPassProgress,
      );
      onReplaceScript(rewritten);
      setSuggestion("Full-script shot pass complete. The editor has been updated with professional shot direction lines.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Shot pass failed");
    } finally {
      setLoading(false);
      setShotPassProgress(null);
    }
  }, [fullScript, knowledgeBase, onReplaceScript]);

  const handleSuggest = useCallback(
    async (mode: OrchestratorMode, prompt?: string, characterName?: string) => {
      const currentSettings = getSelectedTextAiProviderSettings();
      setTextAiSettings(currentSettings);
      if (!currentSettings.apiKey.trim()) {
        setShowKeyDialog(true);
        return;
      }
      // Smart continue doesn't need selection
      if (mode !== "smart_continue" && mode !== "scene_builder" && !selectedText.trim()) {
        setError("Select some text in the editor first.");
        return;
      }

      setLoading(true);
      setError(null);
      setSuggestion(null);
      setLastMode(mode);

      try {
        const ctx: OrchestratorContext = {
          selectedText,
          surroundingContext: contextText,
          fullScript,
          cursorLine,
          cursorBeats,
          knowledgeBase,
          styleProfile,
          mode,
          customPrompt: prompt,
          characterName,
          targetPages,
        };

        const result = await generate(ctx);
        setSuggestion(result);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Unknown error");
      } finally {
        setLoading(false);
      }
    },
    [selectedText, contextText, fullScript, cursorLine, cursorBeats, knowledgeBase, styleProfile, targetPages],
  );

  const handleCustomSubmit = useCallback(() => {
    if (!customPrompt.trim()) return;
    handleSuggest("custom", customPrompt.trim());
  }, [customPrompt, handleSuggest]);

  const handleReportCard = useCallback(async () => {
    const currentSettings = getSelectedTextAiProviderSettings();
    setTextAiSettings(currentSettings);
    if (!currentSettings.apiKey.trim()) {
      setShowKeyDialog(true);
      return;
    }
    if (!fullScript.trim()) {
      setError("No script content to analyze.");
      return;
    }

    setLoading(true);
    setError(null);
    setSuggestion(null);
    setLastMode(null);
    try {
      const report = await runScriptReportCard({
        script: fullScript,
        knowledgeBase,
        styleProfile,
        targetPages,
      });
      setReportCard(report);
      setRewriteReview(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Report card failed");
    } finally {
      setLoading(false);
    }
  }, [fullScript, knowledgeBase, styleProfile, targetPages]);

  const handleImproveMetric = useCallback(async (metricId: string, metricName: string) => {
    if (!reportCard) return;
    const currentSettings = getSelectedTextAiProviderSettings();
    setTextAiSettings(currentSettings);
    if (!currentSettings.apiKey.trim()) {
      setShowKeyDialog(true);
      return;
    }

    setLoading(true);
    setError(null);
    setSuggestion(null);
    setLastMode("instant_critique");
    try {
      const plan = await generateMetricImprovementPlan({
        script: fullScript,
        knowledgeBase,
        styleProfile,
        targetPages,
        reportCard,
        metricId,
        metricName,
      });
      setSuggestion(plan);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Improve plan failed");
    } finally {
      setLoading(false);
    }
  }, [fullScript, knowledgeBase, styleProfile, targetPages, reportCard]);

  const ensureRewriteReady = useCallback((): boolean => {
    const currentSettings = getSelectedTextAiProviderSettings();
    setTextAiSettings(currentSettings);
    if (!currentSettings.apiKey.trim()) {
      setShowKeyDialog(true);
      return false;
    }
    if (!reportCard) {
      setError("Run Script Report Card first, then choose a rewrite action.");
      return false;
    }
    if (!fullScript.trim()) {
      setError("No script content to rewrite.");
      return false;
    }
    return true;
  }, [fullScript, reportCard]);

  const applyRewriteResult = useCallback((result: ScriptRewriteResult, label: string, beforeScript: string, beforeReport: ScriptReportCard) => {
    onReplaceScript(result.rewrittenScript);
    setRewriteReview({
      id: Date.now(),
      label,
      beforeScript,
      afterScript: result.rewrittenScript,
      beforeReport,
      afterReport: null,
      comparison: null,
      result,
      diff: summarizeRewriteDiff(beforeScript, result.rewrittenScript),
      accepted: false,
    });
    setSuggestion(`${label} complete. The editor has been replaced with the revised full script. Review the snapshot below, then Accept, Revert, or Re-score After Rewrite.`);
    setLastMode(null);
  }, [onReplaceScript]);

  const handleRewriteMetric = useCallback(async (metricId: string, metricName: string) => {
    if (!ensureRewriteReady() || !reportCard) return;
    const confirmed = window.confirm(`Rewrite the full script to improve ${metricName}? This replaces the editor text with a complete revised draft. Undo remains available in the editor.`);
    if (!confirmed) return;

    setLoading(true);
    setError(null);
    setSuggestion(null);
    try {
      const result = await rewriteScriptForMetric({
        script: fullScript,
        knowledgeBase,
        styleProfile,
        targetPages,
        reportCard,
        metricId,
        metricName,
      });
      applyRewriteResult(result, `${metricName} rewrite`, fullScript, reportCard);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Metric rewrite failed");
    } finally {
      setLoading(false);
    }
  }, [applyRewriteResult, ensureRewriteReady, fullScript, knowledgeBase, reportCard, styleProfile, targetPages]);

  const handleFillGaps = useCallback(async (mode: "missing_beats" | "target_pages") => {
    if (!ensureRewriteReady() || !reportCard) return;
    const label = mode === "target_pages" ? "complete toward target pages" : "fill missing beats";
    const confirmed = window.confirm(`Run a full-script rewrite to ${label}? This replaces the editor text with a complete revised draft. Undo remains available in the editor.`);
    if (!confirmed) return;

    setLoading(true);
    setError(null);
    setSuggestion(null);
    try {
      const result = await fillScriptGaps({
        script: fullScript,
        knowledgeBase,
        styleProfile,
        targetPages,
        reportCard,
        mode,
      });
      applyRewriteResult(result, mode === "target_pages" ? "Target-page completion" : "Missing-beat fill", fullScript, reportCard);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Fill gaps rewrite failed");
    } finally {
      setLoading(false);
    }
  }, [applyRewriteResult, ensureRewriteReady, fullScript, knowledgeBase, reportCard, styleProfile, targetPages]);

  const handleReScoreRewrite = useCallback(async () => {
    if (!rewriteReview) return;
    const currentSettings = getSelectedTextAiProviderSettings();
    setTextAiSettings(currentSettings);
    if (!currentSettings.apiKey.trim()) {
      setShowKeyDialog(true);
      return;
    }

    setLoading(true);
    setError(null);
    setSuggestion(null);
    try {
      const afterReport = await runScriptReportCard({
        script: rewriteReview.afterScript,
        knowledgeBase,
        styleProfile,
        targetPages,
      });
      const comparison = compareReportCards(rewriteReview.beforeReport, afterReport);
      setReportCard(afterReport);
      setRewriteReview((current) => current && current.id === rewriteReview.id ? { ...current, afterReport, comparison } : current);
      setSuggestion(`Re-score complete. Overall score ${comparison.beforeOverall} -> ${comparison.afterOverall} (${comparison.overallDelta > 0 ? "+" : ""}${comparison.overallDelta}).`);
      setLastMode(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Re-score after rewrite failed");
    } finally {
      setLoading(false);
    }
  }, [knowledgeBase, rewriteReview, styleProfile, targetPages]);

  const handleAcceptRewrite = useCallback(() => {
    if (!rewriteReview) return;
    setRewriteReview({ ...rewriteReview, accepted: true });
    setSuggestion("Rewrite accepted. You can continue editing or run another report card pass.");
    setLastMode(null);
  }, [rewriteReview]);

  const handleRevertRewrite = useCallback(() => {
    if (!rewriteReview) return;
    const confirmed = window.confirm("Revert to the pre-rewrite snapshot? This replaces the editor text with the saved pre-rewrite draft.");
    if (!confirmed) return;
    onReplaceScript(rewriteReview.beforeScript);
    setReportCard(rewriteReview.beforeReport);
    setSuggestion("Rewrite reverted. The editor has been restored to the pre-rewrite snapshot.");
    setLastMode(null);
    setRewriteReview(null);
  }, [onReplaceScript, rewriteReview]);

  const handleCopyRewriteScript = useCallback(() => {
    if (!rewriteReview) return;
    navigator.clipboard.writeText(rewriteReview.afterScript);
  }, [rewriteReview]);

  const characters = knowledgeBase?.characters ?? [];

  return (
    <div className="suggestion-panel">
      <div className="suggestion-header">
        <span className="suggestion-title">AI Assist</span>
        <button
          className="key-btn"
          onClick={() => setShowKeyDialog(true)}
          title="Configure API key"
        >
          {textAiSettings.apiKey.trim() ? `${textAiProviderLabel(textAiSettings.provider)} OK` : "Set Text AI"}
        </button>
      </div>

      {/* Beat context indicator */}
      {cursorBeats.length > 0 && (
        <div className="beat-context">
          {cursorBeats.map((b, i) => (
            <span key={i} className="beat-badge" style={{ borderColor: b.color, color: b.color }}>
              {b.name}
            </span>
          ))}
        </div>
      )}

      {/* Context indicators */}
      <div className="context-indicators">
        {knowledgeBase && knowledgeBase.characters.length > 0 && (
          <span className="ctx-badge kb">KB: {knowledgeBase.characters.length}ch</span>
        )}
        {styleProfile && <span className="ctx-badge style">Style</span>}
      </div>

      <div className="full-shot-pass">
        <button
          className="full-shot-pass-btn report-card-btn"
          onClick={handleReportCard}
          disabled={loading || !fullScript.trim()}
          title="Score the whole script against structure frameworks, style match, character consistency, and pacing"
        >
          Run Script Report Card
        </button>
        <div className="full-shot-pass-hint">
          Scores Hero's Journey, Save the Cat, Propp, Aristotle, Dan Harmon, style match, characters, and pacing.
        </div>
      </div>

      <div className="full-shot-pass">
        <button
          className="full-shot-pass-btn"
          onClick={handleFullShotPass}
          disabled={loading || !fullScript.trim()}
          title="Analyze the whole script scene-by-scene and automatically add professional shot direction lines"
        >
          Full Script Shot Pass
        </button>
        <div className="full-shot-pass-hint">
          Adds WS/MS/CU coverage, OTS dialogue shots, inserts, reactions, and action beats across the whole script.
        </div>
      </div>

      {!selectedText.trim() && (
        <div className="suggestion-hint">
          Select text for suggestions, or use Continue/Scene Build without selection.
        </div>
      )}

      {selectedText.trim() && (
        <div className="suggestion-selected">
          <div className="selected-label">Selected:</div>
          <div className="selected-preview">
            {selectedText.length > 120
              ? selectedText.slice(0, 120) + "..."
              : selectedText}
          </div>
        </div>
      )}

      {/* Custom prompt */}
      <div className="custom-prompt-section">
        <textarea
          className="custom-prompt-input"
          placeholder="Ask anything about the selected text..."
          value={customPrompt}
          onChange={(e) => setCustomPrompt(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              handleCustomSubmit();
            }
          }}
          rows={2}
          disabled={loading}
        />
        <button
          className="custom-prompt-btn"
          onClick={handleCustomSubmit}
          disabled={loading || !customPrompt.trim()}
        >
          Ask
        </button>
      </div>

      {/* Writing mode buttons */}
      <div className="suggestion-modes">
        {WRITING_MODES.map((m) => (
          <button
            key={m.id}
            className="mode-btn"
            onClick={() => handleSuggest(m.id)}
            disabled={loading}
            title={m.id.replace(/_/g, " ")}
          >
            <span className="mode-icon">{m.icon}</span>
            {m.label}
          </button>
        ))}
      </div>

      {/* Advanced tools toggle */}
      <button
        className="advanced-toggle"
        onClick={() => setShowAdvanced(!showAdvanced)}
      >
        {showAdvanced ? "v" : ">"} AI Tools
      </button>

      {showAdvanced && (
        <div className="advanced-section">
          {/* Character selector for character-specific modes */}
          {characters.length > 0 && (
            <div className="char-selector">
              <select
                className="char-select"
                value={charSelect}
                onChange={e => setCharSelect(e.target.value)}
              >
                <option value="">Select character...</option>
                {characters.map(c => (
                  <option key={c.id} value={c.name}>{c.name}</option>
                ))}
              </select>
            </div>
          )}

          <div className="suggestion-modes">
            {ADVANCED_MODES.map((m) => (
              <button
                key={m.id}
                className={`mode-btn ${isAnalysisMode(m.id) ? "analysis" : ""}`}
                onClick={() => {
                  if (m.id === "character_voice" && charSelect) {
                    handleSuggest(m.id, undefined, charSelect);
                  } else if (m.id === "scene_builder") {
                    handleSuggest(m.id, undefined, charSelect || undefined);
                  } else {
                    handleSuggest(m.id);
                  }
                }}
                disabled={loading || (m.needsSelection && !selectedText.trim())}
                title={m.id.replace(/_/g, " ")}
              >
                <span className="mode-icon">{m.icon}</span>
                {m.label}
              </button>
            ))}
          </div>
        </div>
      )}

      {loading && (
        <div className="suggestion-loading">
          <span className="spinner" />
          {shotPassProgress
            ? `${shotPassProgress.label} (${shotPassProgress.completed}/${shotPassProgress.total})`
            : "Thinking..."}
        </div>
      )}

      {error && <div className="suggestion-error">{error}</div>}

      {reportCard && (
        <ReportCard
          report={reportCard}
          onImproveMetric={handleImproveMetric}
          onRewriteMetric={handleRewriteMetric}
          onFillGaps={handleFillGaps}
          loading={loading}
        />
      )}

      {rewriteReview && (
        <RewriteReviewCard
          label={rewriteReview.label}
          result={rewriteReview.result}
          diff={rewriteReview.diff}
          beforeReport={rewriteReview.beforeReport}
          afterReport={rewriteReview.afterReport}
          comparison={rewriteReview.comparison}
          loading={loading}
          accepted={rewriteReview.accepted}
          onRescore={handleReScoreRewrite}
          onAccept={handleAcceptRewrite}
          onRevert={handleRevertRewrite}
          onCopyScript={handleCopyRewriteScript}
        />
      )}

      {suggestion && lastMode && isAnalysisMode(lastMode) && (
        <AnalysisCard text={suggestion} />
      )}

      {suggestion && lastMode && !isAnalysisMode(lastMode) && (
        <SuggestionCard
          text={suggestion}
          onApply={() => onApply(suggestion)}
          onInsertBelow={() => onInsertBelow(suggestion)}
        />
      )}

      {suggestion && !lastMode && (
        <div className="suggestion-success">{suggestion}</div>
      )}

      {showKeyDialog && (
        <ApiKeyDialog
          onSave={() => {
            setTextAiSettings(getSelectedTextAiProviderSettings());
            setShowKeyDialog(false);
          }}
          onClose={() => setShowKeyDialog(false)}
        />
      )}
    </div>
  );
}
