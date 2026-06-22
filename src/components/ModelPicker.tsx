import { useEffect, useMemo, useRef, useState } from "react";
import {
  getCachedTextModelOptions,
  listTextModelsForProvider,
  textAiProviderLabel,
  type TextAiProvider,
  type TextModelOption,
} from "../services/textAiSettingsService";
import "./ModelPicker.css";

interface ModelPickerProps {
  provider: TextAiProvider;
  apiKey: string;
  value: string;
  onChange: (model: string) => void;
}

// A type-to-search model field: the text input IS the model id (so any custom
// slug works), and a filtered suggestion list helps pick from the provider's
// live catalogue — essential for OpenRouter, which lists 300+ models.
export default function ModelPicker({ provider, apiKey, value, onChange }: ModelPickerProps) {
  const [models, setModels] = useState<TextModelOption[]>(() => getCachedTextModelOptions(provider));
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState("");
  const boxRef = useRef<HTMLDivElement>(null);

  const loadModels = async (showStatus: boolean) => {
    const key = apiKey.trim();
    setModels(getCachedTextModelOptions(provider));
    // OpenRouter's catalogue is public; the others need a key to enumerate.
    if (!key && provider !== "openrouter") {
      if (showStatus) setStatus("Add a key, then Refresh to load the live model list.");
      return;
    }
    setLoading(true);
    if (showStatus) setStatus(`Loading ${textAiProviderLabel(provider)} models…`);
    try {
      const options = await listTextModelsForProvider(provider, key);
      setModels(options);
      if (showStatus) setStatus(`${options.length} ${textAiProviderLabel(provider)} models available.`);
    } catch (error) {
      setModels(getCachedTextModelOptions(provider));
      if (showStatus) setStatus(error instanceof Error ? error.message : "Couldn't load models — type a model id.");
    } finally {
      setLoading(false);
    }
  };

  // Auto-load the catalogue on mount and whenever the provider changes.
  useEffect(() => {
    void loadModels(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [provider]);

  // Close the suggestion list on an outside click.
  useEffect(() => {
    const onDocMouseDown = (event: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDocMouseDown);
    return () => document.removeEventListener("mousedown", onDocMouseDown);
  }, []);

  const filtered = useMemo(() => {
    const q = value.trim().toLowerCase();
    // When the value exactly matches a known model, show the whole list (let the
    // user browse); otherwise treat the text as a search query.
    const exact = models.some((m) => m.id.toLowerCase() === q);
    const list = !q || exact
      ? models
      : models.filter((m) => m.id.toLowerCase().includes(q) || m.label.toLowerCase().includes(q));
    return list.slice(0, 100);
  }, [models, value]);

  return (
    <div className="model-picker" ref={boxRef}>
      <div className="model-picker-row">
        <input
          className="model-picker-input"
          value={value}
          placeholder="Search or paste a model id…"
          onChange={(event) => { onChange(event.target.value); setOpen(true); }}
          onFocus={() => setOpen(true)}
          onKeyDown={(event) => { if (event.key === "Escape") setOpen(false); }}
        />
        <button
          type="button"
          className="model-picker-refresh"
          onClick={() => void loadModels(true)}
          disabled={loading}
        >
          {loading ? "…" : "Refresh"}
        </button>
      </div>
      {open && filtered.length > 0 && (
        <ul className="model-picker-list">
          {filtered.map((model) => (
            <li
              key={model.id}
              className={model.id === value ? "selected" : ""}
              onMouseDown={(event) => { event.preventDefault(); onChange(model.id); setOpen(false); }}
            >
              <span className="model-picker-id">{model.id}</span>
              {model.label && model.label !== model.id && <span className="model-picker-label">{model.label}</span>}
            </li>
          ))}
        </ul>
      )}
      {status && <p className="model-picker-status">{status}</p>}
    </div>
  );
}
