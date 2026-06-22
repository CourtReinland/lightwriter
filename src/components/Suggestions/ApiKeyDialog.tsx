import { useEffect, useMemo, useState } from "react";
import {
  getTextAiSettings,
  getTextAiProviderSettings,
  saveTextAiProviderSettings,
  saveTextAiSettings,
  textAiProviderLabel,
  textAiKeyPlaceholder,
  textAiProviderOptions,
  getCachedTextModelOptions,
  listTextModelsForProvider,
  type TextAiProvider,
  type TextModelOption,
} from "../../services/textAiSettingsService";
import "./ApiKeyDialog.css";

interface ApiKeyDialogProps {
  onSave: (key: string) => void;
  onClose: () => void;
}

const CUSTOM_MODEL = "__custom__";

export default function ApiKeyDialog({ onSave, onClose }: ApiKeyDialogProps) {
  const initialProvider = getTextAiSettings().selectedProvider;
  const initial = getTextAiProviderSettings(initialProvider);
  const [provider, setProvider] = useState<TextAiProvider>(initialProvider);
  const [key, setKey] = useState(initial.apiKey ?? "");
  const [model, setModel] = useState(initial.model ?? "");
  const [models, setModels] = useState<TextModelOption[]>(() => getCachedTextModelOptions(initialProvider));
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState("");
  const [customMode, setCustomMode] = useState(false);

  const loadModels = async (prov: TextAiProvider, apiKey: string) => {
    const trimmed = apiKey.trim();
    if (!trimmed) {
      setModels(getCachedTextModelOptions(prov));
      setStatus("Add a key, then Refresh to load the live model list.");
      return;
    }
    setLoading(true);
    setStatus(`Loading ${textAiProviderLabel(prov)} models…`);
    try {
      const options = await listTextModelsForProvider(prov, trimmed);
      setModels(options);
      setModel((prev) => prev || options[0]?.id || "");
      setStatus(options.length ? `${options.length} ${textAiProviderLabel(prov)} models available.` : "No models returned — pick Custom and type one.");
    } catch (error) {
      setModels(getCachedTextModelOptions(prov));
      setStatus(error instanceof Error ? error.message : "Couldn't load models — pick Custom and type one.");
    } finally {
      setLoading(false);
    }
  };

  // Auto-load the live list once on open when a key is already stored.
  useEffect(() => {
    if (initial.apiKey?.trim()) void loadModels(initialProvider, initial.apiKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleProviderChange = (next: TextAiProvider) => {
    const settings = getTextAiProviderSettings(next);
    setProvider(next);
    setKey(settings.apiKey);
    setModel(settings.model);
    setCustomMode(false);
    setModels(getCachedTextModelOptions(next));
    setStatus("");
    if (settings.apiKey.trim()) void loadModels(next, settings.apiKey);
  };

  // Always keep the currently-selected model visible in the list, even if the
  // live fetch hasn't returned it (e.g. a brand-new model id, or offline).
  const optionList = useMemo(() => {
    const list = [...models];
    if (model && !list.some((option) => option.id === model)) {
      list.unshift({ id: model, label: `${model} (current)` });
    }
    return list;
  }, [models, model]);

  const selectValue = customMode ? CUSTOM_MODEL : model;

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
        <div className="dialog-model-row">
          <select
            className="dialog-input"
            value={selectValue}
            onChange={(e) => {
              const value = e.target.value;
              if (value === CUSTOM_MODEL) {
                setCustomMode(true);
              } else {
                setCustomMode(false);
                setModel(value);
              }
            }}
          >
            {optionList.map((option) => (
              <option key={option.id} value={option.id}>{option.label}</option>
            ))}
            <option value={CUSTOM_MODEL}>Custom…</option>
          </select>
          <button
            type="button"
            className="dialog-btn secondary"
            onClick={() => void loadModels(provider, key)}
            disabled={loading || !key.trim()}
          >
            {loading ? "…" : "Refresh"}
          </button>
        </div>
        {customMode && (
          <input
            type="text"
            className="dialog-input"
            value={model}
            onChange={(e) => setModel(e.target.value)}
            placeholder="Model id (e.g. grok-4.3)"
            onKeyDown={(e) => e.key === "Enter" && handleSave()}
          />
        )}
        {status && <p className="dialog-status">{status}</p>}

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
