import { useEffect, useRef, useState } from "react";
import { WorldStateService } from "../../services/worldStateService";
import SeriesImageField, { type SeriesImageValue } from "./SeriesImageField";
import "./AddToSeriesPopup.css";

export interface AddToSeriesTarget {
  kind: "scene" | "character";
  /** Default human name (title-cased token for scenes, cue name for characters). */
  name: string;
  /** Uppercase alias seed (the heading token or cue spelling). */
  alias: string;
  seriesId: string;
  projectId: string;
  /** 0-based scene index, for binding a scene to the created location. */
  sceneIndex?: number;
  x: number;
  y: number;
}

interface AddToSeriesPopupProps {
  target: AddToSeriesTarget;
  onClose: () => void;
  onAdded: () => void;
}

const WIDTH = 280;

export default function AddToSeriesPopup({ target, onClose, onAdded }: AddToSeriesPopupProps) {
  const { kind, seriesId, projectId, sceneIndex, alias } = target;
  const isScene = kind === "scene";
  const ref = useRef<HTMLDivElement>(null);
  const [name, setName] = useState(target.name);
  const [description, setDescription] = useState("");
  const [image, setImage] = useState<SeriesImageValue | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  // Subscribe once for the popup's lifetime (onClose is read through a ref so the
  // listeners aren't torn down on every parent re-render).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onCloseRef.current(); };
    const onDown = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) onCloseRef.current(); };
    document.addEventListener("keydown", onKey);
    // Defer the outside-click listener so the click that opened this popup
    // doesn't immediately close it.
    const t = setTimeout(() => document.addEventListener("mousedown", onDown), 0);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onDown);
      clearTimeout(t);
    };
  }, []);

  const handleAdd = async () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    setSaving(true);
    setError(null);
    try {
      // Create the record WITHOUT the inline blob; attachRecordImage owns disk
      // persistence (and the browser-mode inline fallback).
      const common = {
        name: trimmed,
        aliases: [alias.toUpperCase()],
        description: description.trim(),
      };
      const saved = isScene
        ? WorldStateService.addLocation(seriesId, common)
        : WorldStateService.addCharacter(seriesId, common);

      if (image?.dataUrl) {
        await WorldStateService.attachRecordImage(kind, saved.id, image.dataUrl, image.mimeType || "image/png");
      }

      if (isScene && typeof sceneIndex === "number") {
        WorldStateService.bindScene(projectId, sceneIndex, saved.id);
      }

      onAdded();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not add to series.");
      setSaving(false);
    }
  };

  // Clamp to the viewport.
  const left = Math.min(target.x, window.innerWidth - WIDTH - 16);
  const top = Math.min(target.y + 8, window.innerHeight - 320);

  return (
    <div ref={ref} className="add-series-popup" style={{ left: Math.max(8, left), top: Math.max(8, top), width: WIDTH }}>
      <div className="asp-head">Add {isScene ? "scene" : "character"} to series</div>
      <input
        className="asp-input"
        value={name}
        autoFocus
        onChange={(e) => setName(e.target.value)}
        placeholder={isScene ? "Scene name" : "Character name"}
      />
      <textarea
        className="asp-textarea"
        rows={2}
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        placeholder={isScene ? "Visual description (optional)" : "Appearance / who they are (optional)"}
      />
      <SeriesImageField
        scopeId={seriesId}
        kind={isScene ? "scene_set" : "character"}
        name={name}
        description={description}
        imageDataUrl={image?.dataUrl}
        onChange={setImage}
      />
      {error && <div className="asp-error">{error}</div>}
      <div className="asp-actions">
        <button className="asp-btn primary" onClick={handleAdd} disabled={saving || !name.trim()}>
          {saving ? "Adding…" : "Add to series"}
        </button>
        <button className="asp-btn" onClick={onClose}>Cancel</button>
      </div>
    </div>
  );
}
