import { useState, useCallback } from "react";
import { GrokService, type SuggestionMode } from "../../services/grokService";
import ApiKeyDialog from "./ApiKeyDialog";
import SuggestionCard from "./SuggestionCard";
import "./SuggestionPanel.css";

interface SuggestionPanelProps {
  selectedText: string;
  contextText: string;
  onApply: (text: string) => void;
  onInsertBelow: (text: string) => void;
}

const MODES: { id: SuggestionMode; label: string; icon: string }[] = [
  { id: "improve_dialogue", label: "Improve", icon: "^" },
  { id: "expand_scene", label: "Expand", icon: "+" },
  { id: "compress", label: "Compress", icon: "-" },
  { id: "alternative_line", label: "Alt Lines", icon: "~" },
  { id: "add_action", label: "Action", icon: "!" },
  { id: "fix_formatting", label: "Fix Fmt", icon: "#" },
];

export default function SuggestionPanel({
  selectedText,
  contextText,
  onApply,
  onInsertBelow,
}: SuggestionPanelProps) {
  const [apiKey, setApiKey] = useState(GrokService.getStoredApiKey());
  const [showKeyDialog, setShowKeyDialog] = useState(false);
  const [loading, setLoading] = useState(false);
  const [suggestion, setSuggestion] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [customPrompt, setCustomPrompt] = useState("");

  const handleSuggest = useCallback(
    async (mode: SuggestionMode, prompt?: string) => {
      if (!apiKey) {
        setShowKeyDialog(true);
        return;
      }
      if (!selectedText.trim()) {
        setError("Select some text in the editor first.");
        return;
      }

      setLoading(true);
      setError(null);
      setSuggestion(null);

      try {
        const service = new GrokService(apiKey);
        const result = await service.suggest(
          selectedText,
          contextText,
          mode,
          prompt,
        );
        setSuggestion(result);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Unknown error");
      } finally {
        setLoading(false);
      }
    },
    [apiKey, selectedText, contextText],
  );

  const handleCustomSubmit = useCallback(() => {
    if (!customPrompt.trim()) return;
    handleSuggest("custom", customPrompt.trim());
  }, [customPrompt, handleSuggest]);

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

      {!selectedText.trim() && (
        <div className="suggestion-hint">
          Select text in the editor to get AI suggestions.
        </div>
      )}

      {selectedText.trim() && (
        <>
          <div className="suggestion-selected">
            <div className="selected-label">Selected:</div>
            <div className="selected-preview">
              {selectedText.length > 120
                ? selectedText.slice(0, 120) + "..."
                : selectedText}
            </div>
          </div>

          {/* Custom prompt input */}
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

          {/* Quick mode buttons */}
          <div className="suggestion-modes">
            {MODES.map((m) => (
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
        </>
      )}

      {loading && (
        <div className="suggestion-loading">
          <span className="spinner" />
          Thinking...
        </div>
      )}

      {error && <div className="suggestion-error">{error}</div>}

      {suggestion && (
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
