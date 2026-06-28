import { useEffect, useRef, useState } from "react";
import type { AssetProvider } from "../types/assets";
import {
  getImageModelOptions,
  getImageProviderSettings,
  hasImageProviderApiKey,
  listImageModelsForProvider,
  providerLabel,
  saveImageProviderSettings,
  type ImageModelOption,
} from "../services/imageGenerationService";
import "./ImageModelPicker.css";

const PROVIDERS: AssetProvider[] = ["gemini-nano-banana", "grok-imagine"];

interface ImageModelPickerProps {
  provider: AssetProvider;
  model: string;
  onChange: (provider: AssetProvider, model: string) => void;
}

// Compact point-of-use provider + image-model selector, so the user picks the
// model right where they generate (KB series panel, KB entry editor). Reads the
// live model list per provider key and persists the chosen model to the shared
// image-provider settings.
export default function ImageModelPicker({ provider, model, onChange }: ImageModelPickerProps) {
  const [options, setOptions] = useState<ImageModelOption[]>(() => getImageModelOptions(provider));
  const [loading, setLoading] = useState(false);
  const onChangeRef = useRef(onChange);
  const modelRef = useRef(model);
  onChangeRef.current = onChange;
  modelRef.current = model;

  useEffect(() => {
    let cancelled = false;
    setOptions(getImageModelOptions(provider));
    const key = getImageProviderSettings(provider).apiKey?.trim();
    if (!key) return;
    setLoading(true);
    listImageModelsForProvider(provider, key)
      .then((opts) => {
        if (cancelled) return;
        setOptions(opts);
        // Reconcile: if the picked model isn't in the freshly-loaded list (e.g. a
        // persisted id the provider renamed/removed), fall back to the first one
        // so the select doesn't show blank while generation uses a stale id.
        const current = modelRef.current;
        if (opts.length && (!current || !opts.some((o) => o.id === current))) {
          onChangeRef.current(provider, opts[0]?.id || "");
        }
      })
      .catch(() => { /* keep cached options */ })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [provider]);

  const handleProvider = (p: AssetProvider) => {
    const nextModel = getImageProviderSettings(p).selectedModel || getImageModelOptions(p)[0]?.id || "";
    onChange(p, nextModel);
  };
  const handleModel = (m: string) => {
    saveImageProviderSettings(provider, { selectedModel: m });
    onChange(provider, m);
  };

  return (
    <div className="image-model-picker">
      <select className="imp-select" value={provider} onChange={(e) => handleProvider(e.target.value as AssetProvider)}>
        {PROVIDERS.map((p) => (
          <option key={p} value={p}>{providerLabel(p)}{hasImageProviderApiKey(p) ? "" : " — no key"}</option>
        ))}
      </select>
      <select className="imp-select" value={model} onChange={(e) => handleModel(e.target.value)} disabled={loading && options.length === 0}>
        <option value="">{loading ? "Loading models…" : options.length ? "Choose model…" : "No models (add key)"}</option>
        {options.map((o) => (
          <option key={o.id} value={o.id}>{o.label}</option>
        ))}
      </select>
    </div>
  );
}
