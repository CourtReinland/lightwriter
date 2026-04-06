import { useState, useCallback } from "react";
import { GrokService } from "../../services/grokService";
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
import "./SuggestionPanel.css";

interface SuggestionPanelProps {
  selectedText: string;
  contextText: string;
  fullScript: string;
  cursorLine: number;
  cursorBeats: ComputedBeat[];
  knowledgeBase: KnowledgeBase | null;
  styleProfile: StyleProfile | null;
  onApply: (text: string) => void;
  onInsertBelow: (text: string) => void;
}

const WRITING_MODES: { id: OrchestratorMode; label: string; icon: string }[] = [
  { id: "improve_dialogue", label: "Improve", icon: "^" },
  { id: "expand_scene", label: "Expand", icon: "+" },
  { id: "compress", label: "Compress", icon: "-" },
  { id: "alternative_line", label: "Alt Lines", icon: "~" },
  { id: "add_action", label: "Action", icon: "!" },
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
  onApply,
  onInsertBelow,
}: SuggestionPanelProps) {
  const [apiKey, setApiKey] = useState(GrokService.getStoredApiKey());
  const [showKeyDialog, setShowKeyDialog] = useState(false);
  const [loading, setLoading] = useState(false);
  const [suggestion, setSuggestion] = useState<string | null>(null);
  const [lastMode, setLastMode] = useState<OrchestratorMode | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [customPrompt, setCustomPrompt] = useState("");
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [charSelect, setCharSelect] = useState<string>("");

  const handleSuggest = useCallback(
    async (mode: OrchestratorMode, prompt?: string, characterName?: string) => {
      if (!apiKey) {
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
        };

        const result = await generate(ctx, apiKey);
        setSuggestion(result);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Unknown error");
      } finally {
        setLoading(false);
      }
    },
    [apiKey, selectedText, contextText, fullScript, cursorLine, cursorBeats, knowledgeBase, styleProfile],
  );

  const handleCustomSubmit = useCallback(() => {
    if (!customPrompt.trim()) return;
    handleSuggest("custom", customPrompt.trim());
  }, [customPrompt, handleSuggest]);

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
          {apiKey ? "Key OK" : "Set Key"}
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
          Thinking...
        </div>
      )}

      {error && <div className="suggestion-error">{error}</div>}

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

      {showKeyDialog && (
        <ApiKeyDialog
          onSave={(key) => {
            setApiKey(key);
            setShowKeyDialog(false);
          }}
          onClose={() => setShowKeyDialog(false)}
        />
      )}
    </div>
  );
}
