import { useState, useEffect, useCallback } from "react";
import {
  runFullAnalysis,
  loadCachedAnalysis,
  clearCachedAnalysis,
  type AnalysisResult,
  type AnalysisProgress,
} from "../../services/analysisEngine";
import { GrokService } from "../../services/grokService";
import type { KnowledgeBase } from "../../services/knowledgeBase";
import type { StyleProfile } from "../../services/styleProfile";
import PacingChart from "./PacingChart";
import ConsistencyCard from "./ConsistencyCard";
import BeatAlignmentCard from "./BeatAlignmentCard";
import DialogueCard from "./DialogueCard";
import "./AnalysisPanel.css";

interface AnalysisPanelProps {
  projectId: string;
  content: string;
  knowledgeBase: KnowledgeBase;
  styleProfile: StyleProfile | null;
  activeFrameworks: string[];
  targetPages: number;
}

type AnalysisTab = "pacing" | "character" | "beat" | "dialogue";

function scoreClass(score: number): string {
  if (score >= 7) return "high";
  if (score >= 4) return "mid";
  return "low";
}

export default function AnalysisPanel({
  projectId,
  content,
  knowledgeBase,
  styleProfile,
  activeFrameworks,
  targetPages,
}: AnalysisPanelProps) {
  const [result, setResult] = useState<AnalysisResult | null>(null);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<AnalysisProgress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<AnalysisTab>("pacing");

  // Load cached analysis on mount / project change
  useEffect(() => {
    const cached = loadCachedAnalysis(projectId);
    if (cached) setResult(cached);
    else setResult(null);
  }, [projectId]);

  const handleRun = useCallback(async () => {
    const apiKey = GrokService.getStoredApiKey();
    if (!apiKey) {
      setError("Set your Grok API key first (AI panel → Set Key)");
      return;
    }
    if (!content.trim()) {
      setError("No content to analyze");
      return;
    }

    setRunning(true);
    setError(null);
    setProgress({ section: "pacing", completed: 0, total: 1, label: "Starting..." });

    try {
      const final = await runFullAnalysis(
        projectId,
        content,
        knowledgeBase,
        styleProfile,
        activeFrameworks,
        targetPages,
        apiKey,
        (prog, partial) => {
          setProgress(prog);
          // Progressive update: show partial results as they come in
          if (partial) setResult({ ...(partial as AnalysisResult) });
        },
      );
      setResult(final);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Analysis failed");
    } finally {
      setRunning(false);
      setProgress(null);
    }
  }, [projectId, content, knowledgeBase, styleProfile, activeFrameworks, targetPages]);

  const handleClear = useCallback(() => {
    clearCachedAnalysis(projectId);
    setResult(null);
  }, [projectId]);

  const lastRunLabel = result
    ? new Date(result.timestamp).toLocaleString(undefined, {
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      })
    : null;

  return (
    <div className="analysis-panel">
      <div className="analysis-header">
        <div className="analysis-header-left">
          <h2 className="analysis-title">Script Analysis</h2>
          {lastRunLabel && (
            <span className="analysis-timestamp">Last run: {lastRunLabel}</span>
          )}
        </div>
        <div className="analysis-header-right">
          {result && (
            <div className={`overall-score-badge score-${scoreClass(result.overallScore)}`}>
              <span className="overall-score-num">{result.overallScore.toFixed(1)}</span>
              <span className="overall-score-max">/10</span>
            </div>
          )}
          <button className="analysis-run-btn" onClick={handleRun} disabled={running}>
            {running ? "Analyzing..." : result ? "Re-analyze" : "Run Full Analysis"}
          </button>
          {result && !running && (
            <button className="analysis-clear-btn" onClick={handleClear}>
              Clear
            </button>
          )}
        </div>
      </div>

      {progress && (
        <div className="analysis-progress">
          <div className="progress-label">
            {progress.label} ({progress.completed}/{progress.total})
          </div>
          <div className="progress-bar-container">
            <div
              className="progress-bar"
              style={{ width: `${(progress.completed / Math.max(1, progress.total)) * 100}%` }}
            />
          </div>
        </div>
      )}

      {error && <div className="analysis-error">{error}</div>}

      {!result && !running && (
        <div className="analysis-empty">
          <p>No analysis yet.</p>
          <p className="hint">Click "Run Full Analysis" to analyze your screenplay.</p>
          <p className="hint">
            For best results: add characters to the Knowledge Base, toggle a framework overlay,
            and set your target page count.
          </p>
        </div>
      )}

      {result && (
        <>
          <div className="analysis-tabs">
            <button
              className={`analysis-tab ${activeTab === "pacing" ? "active" : ""}`}
              onClick={() => setActiveTab("pacing")}
            >
              Pacing {result.pacing && `(${result.pacing.overallScore.toFixed(1)})`}
            </button>
            <button
              className={`analysis-tab ${activeTab === "character" ? "active" : ""}`}
              onClick={() => setActiveTab("character")}
            >
              Characters ({result.characterConsistency.length})
            </button>
            <button
              className={`analysis-tab ${activeTab === "beat" ? "active" : ""}`}
              onClick={() => setActiveTab("beat")}
            >
              Beats ({result.beatAlignment.length})
            </button>
            <button
              className={`analysis-tab ${activeTab === "dialogue" ? "active" : ""}`}
              onClick={() => setActiveTab("dialogue")}
            >
              Dialogue ({result.dialogueQuality.length})
            </button>
          </div>

          <div className="analysis-content">
            {activeTab === "pacing" && result.pacing && <PacingChart pacing={result.pacing} />}
            {activeTab === "pacing" && !result.pacing && (
              <div className="analysis-empty"><p>No pacing data yet.</p></div>
            )}
            {activeTab === "character" && <ConsistencyCard results={result.characterConsistency} />}
            {activeTab === "beat" && <BeatAlignmentCard results={result.beatAlignment} />}
            {activeTab === "dialogue" && <DialogueCard results={result.dialogueQuality} />}
          </div>
        </>
      )}
    </div>
  );
}
