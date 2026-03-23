import { useState } from "react";
import { GrokService } from "../../services/grokService";
import "./ApiKeyDialog.css";

interface ApiKeyDialogProps {
  onSave: (key: string) => void;
  onClose: () => void;
}

export default function ApiKeyDialog({ onSave, onClose }: ApiKeyDialogProps) {
  const [key, setKey] = useState(GrokService.getStoredApiKey() ?? "");

  const handleSave = () => {
    if (key.trim()) {
      GrokService.setStoredApiKey(key.trim());
      onSave(key.trim());
    }
  };

  return (
    <div className="dialog-backdrop" onClick={onClose}>
      <div className="dialog" onClick={(e) => e.stopPropagation()}>
        <div className="dialog-title">Grok API Key</div>
        <p className="dialog-desc">
          Enter your xAI API key to enable AI suggestions.
          Your key is stored locally in your browser.
        </p>
        <input
          type="password"
          className="dialog-input"
          value={key}
          onChange={(e) => setKey(e.target.value)}
          placeholder="xai-..."
          onKeyDown={(e) => e.key === "Enter" && handleSave()}
          autoFocus
        />
        <div className="dialog-actions">
          <button className="dialog-btn secondary" onClick={onClose}>
            Cancel
          </button>
          <button
            className="dialog-btn primary"
            onClick={handleSave}
            disabled={!key.trim()}
          >
            Save
          </button>
        </div>
      </div>
    </div>
  );
}
