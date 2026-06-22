import { useState } from "react";
import {
  getTextAiSettings,
  getTextAiProviderSettings,
  saveTextAiProviderSettings,
  saveTextAiSettings,
  textAiProviderLabel,
  textAiKeyPlaceholder,
  textAiProviderOptions,
  type TextAiProvider,
} from "../../services/textAiSettingsService";
import ModelPicker from "../ModelPicker";
import "./ApiKeyDialog.css";

interface ApiKeyDialogProps {
  onSave: (key: string) => void;
  onClose: () => void;
}

export default function ApiKeyDialog({ onSave, onClose }: ApiKeyDialogProps) {
  const initialProvider = getTextAiSettings().selectedProvider;
  const initial = getTextAiProviderSettings(initialProvider);
  const [provider, setProvider] = useState<TextAiProvider>(initialProvider);
  const [key, setKey] = useState(initial.apiKey ?? "");
  const [model, setModel] = useState(initial.model ?? "");

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
          Choose the provider and model used by AI writing, KB scanning, style analysis, and prompt generation. Keys are stored locally in your browser.
        </p>

        <span className="dialog-field-label">Provider</span>
        <select
          className="dialog-input"
          value={provider}
          onChange={(e) => handleProviderChange(e.target.value as TextAiProvider)}
        >
          {textAiProviderOptions().map((option) => (
            <option key={option} value={option}>{textAiProviderLabel(option)}</option>
          ))}
        </select>

        <span className="dialog-field-label">API key</span>
        <input
          type="password"
          className="dialog-input"
          value={key}
          onChange={(e) => setKey(e.target.value)}
          placeholder={textAiKeyPlaceholder(provider)}
          onKeyDown={(e) => e.key === "Enter" && handleSave()}
          autoFocus
        />

        <span className="dialog-field-label">Model</span>
        <ModelPicker provider={provider} apiKey={key} value={model} onChange={setModel} />

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
