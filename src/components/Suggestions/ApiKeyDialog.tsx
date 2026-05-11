import { useState } from "react";
import {
  getTextAiSettings,
  getTextAiProviderSettings,
  saveTextAiProviderSettings,
  saveTextAiSettings,
  textAiProviderLabel,
  textAiProviderOptions,
  type TextAiProvider,
} from "../../services/textAiSettingsService";
import "./ApiKeyDialog.css";

interface ApiKeyDialogProps {
  onSave: (key: string) => void;
  onClose: () => void;
}

export default function ApiKeyDialog({ onSave, onClose }: ApiKeyDialogProps) {
  const [provider, setProvider] = useState<TextAiProvider>(getTextAiSettings().selectedProvider);
  const current = getTextAiProviderSettings(provider);
  const [key, setKey] = useState(current.apiKey ?? "");
  const [model, setModel] = useState(current.model ?? "");

  const handleProviderChange = (next: TextAiProvider) => {
    const settings = getTextAiProviderSettings(next);
    setProvider(next);
    setKey(settings.apiKey);
    setModel(settings.model);
  };

  const handleSave = () => {
    if (key.trim() && model.trim()) {
      saveTextAiSettings({ selectedProvider: provider });
      saveTextAiProviderSettings(provider, { apiKey: key.trim(), model: model.trim() });
      onSave(key.trim());
    }
  };

  return (
    <div className="dialog-backdrop" onClick={onClose}>
      <div className="dialog" onClick={(e) => e.stopPropagation()}>
        <div className="dialog-title">Text AI Provider</div>
        <p className="dialog-desc">
          Choose the provider used by AI writing, KB scanning, style analysis, and prompt generation. Keys are stored locally in your browser.
        </p>
        <select
          className="dialog-input"
          value={provider}
          onChange={(e) => handleProviderChange(e.target.value as TextAiProvider)}
        >
          {textAiProviderOptions().map((option) => (
            <option key={option} value={option}>{textAiProviderLabel(option)}</option>
          ))}
        </select>
        <input
          type="password"
          className="dialog-input"
          value={key}
          onChange={(e) => setKey(e.target.value)}
          placeholder={provider === "grok" ? "xai-..." : provider === "openai" ? "sk-..." : "sk-ant-..."}
          onKeyDown={(e) => e.key === "Enter" && handleSave()}
          autoFocus
        />
        <input
          type="text"
          className="dialog-input"
          value={model}
          onChange={(e) => setModel(e.target.value)}
          placeholder="Model name"
          onKeyDown={(e) => e.key === "Enter" && handleSave()}
        />
        <div className="dialog-actions">
          <button className="dialog-btn secondary" onClick={onClose}>
            Cancel
          </button>
          <button
            className="dialog-btn primary"
            onClick={handleSave}
            disabled={!key.trim() || !model.trim()}
          >
            Save
          </button>
        </div>
      </div>
    </div>
  );
}
