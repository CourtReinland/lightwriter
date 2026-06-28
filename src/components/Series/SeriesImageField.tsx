import { useState, type ChangeEvent } from "react";
import type { AssetProvider } from "../../types/assets";
import {
  generateImageAsset,
  getImageProviderSettings,
  hasImageProviderApiKey,
  providerLabel,
  type ImageGenerationRequest,
} from "../../services/imageGenerationService";
import "./SeriesImageField.css";

// Shared "attach a file OR generate one from a description" control, reused by
// series scenes, series characters, and the editor add-to-series popup. It only
// hands the chosen image (dataUrl + mimeType) back to the parent via onChange —
// persistence to disk is the parent's job (on save), mirroring WorldSection.

const PROVIDERS: AssetProvider[] = ["gemini-nano-banana", "grok-imagine"];

export interface SeriesImageValue {
  dataUrl: string;
  mimeType: string;
}

interface SeriesImageFieldProps {
  /** Series scope id, used as the projectId of the generation request. */
  seriesId: string;
  kind: "scene_set" | "character";
  /** Entity name (generation request name + scriptRef). */
  name: string;
  /** Description used to seed the generation prompt. */
  description: string;
  imageDataUrl?: string;
  onChange: (value: SeriesImageValue | null) => void;
}

export default function SeriesImageField({ seriesId, kind, name, description, imageDataUrl, onChange }: SeriesImageFieldProps) {
  const [mode, setMode] = useState<"idle" | "generate">("idle");
  const [provider, setProvider] = useState<AssetProvider>("gemini-nano-banana");
  const [prompt, setPrompt] = useState("");
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleUpload = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      setError("Choose an image file.");
      return;
    }
    setError(null);
    const reader = new FileReader();
    reader.onload = () => onChange({ dataUrl: String(reader.result), mimeType: file.type });
    reader.readAsDataURL(file);
    e.target.value = "";
  };

  const handleGenerate = async () => {
    const text = prompt.trim() || description.trim();
    if (!text) {
      setError("Add a description to generate from.");
      return;
    }
    const settings = getImageProviderSettings(provider);
    if (!settings.apiKey?.trim()) {
      setError(`Add a ${providerLabel(provider)} API key in Settings first.`);
      return;
    }
    if (!settings.selectedModel?.trim()) {
      setError(`Choose a ${providerLabel(provider)} image model in Settings first.`);
      return;
    }
    setGenerating(true);
    setError(null);
    try {
      const request: ImageGenerationRequest = {
        projectId: seriesId,
        kind,
        provider,
        model: settings.selectedModel,
        name: name || (kind === "character" ? "Character" : "Scene"),
        prompt: text,
        scriptRef: { scriptHash: "", ...(kind === "character" ? { characterName: name } : { sceneHeading: name }) },
        aspectRatio: kind === "character" ? "2:3" : "16:9",
      };
      const result = await generateImageAsset(request);
      if (!result.imageDataUrl) throw new Error("No image was returned.");
      onChange({ dataUrl: result.imageDataUrl, mimeType: result.mimeType });
      setPrompt("");
      setMode("idle");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Generation failed.");
    } finally {
      setGenerating(false);
    }
  };

  return (
    <div className="series-image-field">
      {imageDataUrl ? (
        <div className="sif-preview-row">
          <img className={`sif-preview ${kind === "character" ? "portrait" : "wide"}`} src={imageDataUrl} alt={name || "reference"} />
          <button type="button" className="sif-btn ghost" onClick={() => onChange(null)}>Remove</button>
        </div>
      ) : (
        <div className="sif-empty">No image yet</div>
      )}

      <div className="sif-actions">
        <label className="sif-btn">
          Upload
          <input type="file" accept="image/*" onChange={handleUpload} hidden />
        </label>
        <button
          type="button"
          className={`sif-btn ${mode === "generate" ? "active" : ""}`}
          onClick={() => { setMode(mode === "generate" ? "idle" : "generate"); setError(null); }}
        >
          {mode === "generate" ? "Close" : "Generate"}
        </button>
      </div>

      {mode === "generate" && (
        <div className="sif-generate">
          <select className="sif-select" value={provider} onChange={(e) => { setProvider(e.target.value as AssetProvider); setError(null); }}>
            {PROVIDERS.map((p) => (
              <option key={p} value={p}>{providerLabel(p)}{hasImageProviderApiKey(p) ? "" : " — no key"}</option>
            ))}
          </select>
          <textarea
            className="sif-prompt"
            rows={3}
            placeholder={description ? "Describe the image (leave blank to use the description above)…" : "Describe the image to generate…"}
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
          />
          <button type="button" className="sif-btn primary" onClick={handleGenerate} disabled={generating}>
            {generating ? "Generating…" : "Generate image"}
          </button>
        </div>
      )}

      {error && <div className="sif-error">{error}</div>}
    </div>
  );
}
