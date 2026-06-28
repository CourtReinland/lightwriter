import { useMemo, useState } from "react";
import {
  WorldStateService,
  parseAliases,
  type WorldLocation,
  type WorldLocationCategory,
  type WorldCharacter,
} from "../../services/worldStateService";
import { persistGeneratedImageFile } from "../../services/imageAssetStorageService";
import SeriesImageField, { type SeriesImageValue } from "./SeriesImageField";
import "./SeriesRecordsPanel.css";

// Renders the portable, series-scoped SCENES (WorldLocation) or CHARACTERS
// (WorldCharacter) for a series, with an inline image (upload OR generate) and
// add/edit/delete. Mounted at the top of the KB "Scenes" and "Characters"
// sections so series records and per-project KB notes live in one place.

type RecordKind = "scene" | "character";

interface SeriesRecordsPanelProps {
  seriesId: string;
  kind: RecordKind;
  /** Bump the App's worldVersion so the gutter + AI context recompute. */
  onChange?: () => void;
  /** App-level world version: when records change elsewhere (e.g. the editor
   *  add-to-series popup), this changes and the list re-reads from storage. */
  refreshKey?: number;
}

interface RecordDraft {
  id?: string;
  name: string;
  aliases: string;
  category: WorldLocationCategory; // scenes only
  description: string;
  traits: string; // characters only
  voiceNotes: string; // characters only
  referenceImageDataUrl?: string;
  referenceMimeType?: string;
  referenceFilePath?: string;
  imageChanged?: boolean;
}

const EMPTY_DRAFT: RecordDraft = {
  name: "",
  aliases: "",
  category: "interior",
  description: "",
  traits: "",
  voiceNotes: "",
};

export default function SeriesRecordsPanel({ seriesId, kind, onChange, refreshKey = 0 }: SeriesRecordsPanelProps) {
  const isScene = kind === "scene";
  const [version, setVersion] = useState(0);
  const refresh = () => {
    setVersion((v) => v + 1);
    onChange?.();
  };

  const scenes = useMemo(() => (isScene ? WorldStateService.listLocations(seriesId) : []), [isScene, seriesId, version, refreshKey]);
  const characters = useMemo(() => (!isScene ? WorldStateService.listCharacters(seriesId) : []), [isScene, seriesId, version, refreshKey]);
  const records: (WorldLocation | WorldCharacter)[] = isScene ? scenes : characters;

  const [draft, setDraft] = useState<RecordDraft | null>(null);

  const aliasLabel = isScene
    ? "Aliases — scene-heading words, comma-separated (KITCHEN, FAMILY KITCHEN)"
    : "Aliases — cue spellings, comma-separated (AIDEN, YOUNG AIDEN)";
  const noun = isScene ? "scene" : "character";
  const NounCap = isScene ? "Scene" : "Character";

  const startEdit = (rec: WorldLocation | WorldCharacter) => {
    const asScene = rec as WorldLocation;
    const asChar = rec as WorldCharacter;
    setDraft({
      id: rec.id,
      name: rec.name,
      aliases: rec.aliases.join(", "),
      category: isScene ? asScene.category : "interior",
      description: rec.description,
      traits: !isScene && asChar.traits ? asChar.traits.join(", ") : "",
      voiceNotes: !isScene ? asChar.voiceNotes || "" : "",
      referenceImageDataUrl: rec.referenceImageDataUrl,
      referenceMimeType: rec.referenceMimeType,
      referenceFilePath: rec.referenceFilePath,
    });
  };

  const handleImageChange = (value: SeriesImageValue | null) => {
    setDraft((prev) =>
      prev
        ? {
            ...prev,
            referenceImageDataUrl: value?.dataUrl,
            referenceMimeType: value?.mimeType,
            imageChanged: true,
          }
        : prev,
    );
  };

  const handleSave = async () => {
    if (!draft || !draft.name.trim()) return;
    const common = {
      name: draft.name.trim(),
      aliases: parseAliases(draft.aliases),
      description: draft.description.trim(),
      referenceImageDataUrl: draft.referenceImageDataUrl,
      referenceMimeType: draft.referenceMimeType,
    };

    let saved: WorldLocation | WorldCharacter | null;
    if (isScene) {
      const fields = { ...common, category: draft.category };
      saved = draft.id ? WorldStateService.updateLocation(draft.id, fields) : WorldStateService.addLocation(seriesId, fields);
    } else {
      const fields = {
        ...common,
        traits: parseTraits(draft.traits),
        voiceNotes: draft.voiceNotes.trim() || undefined,
      };
      saved = draft.id ? WorldStateService.updateCharacter(draft.id, fields) : WorldStateService.addCharacter(seriesId, fields);
    }

    // Persist the reference image to disk (Electron) for the ScriptToScreen
    // handoff. Best-effort; no-op in browser. Series-scoped, keyed by record id.
    if (saved && common.referenceImageDataUrl && (draft.imageChanged || !draft.referenceFilePath)) {
      try {
        const filePath = await persistGeneratedImageFile({
          projectId: seriesId,
          assetId: saved.id,
          name: saved.name,
          mimeType: common.referenceMimeType || "image/png",
          dataUrl: common.referenceImageDataUrl,
        });
        if (filePath) {
          if (isScene) WorldStateService.updateLocation(saved.id, { referenceFilePath: filePath });
          else WorldStateService.updateCharacter(saved.id, { referenceFilePath: filePath });
        }
      } catch {
        /* keep the dataUrl-only fallback */
      }
    }

    setDraft(null);
    refresh();
  };

  const handleDelete = (rec: WorldLocation | WorldCharacter) => {
    if (!window.confirm(`Delete ${noun} "${rec.name}"? This removes it from the whole series.`)) return;
    if (isScene) WorldStateService.deleteLocation(rec.id);
    else WorldStateService.deleteCharacter(rec.id);
    if (draft?.id === rec.id) setDraft(null);
    refresh();
  };

  return (
    <div className="series-records">
      <div className="series-records-head">
        <span className="kb-field-label">SERIES {isScene ? "SCENES" : "CHARACTERS"} ({records.length})</span>
        <button className="kb-add-btn" title={`Add a series ${noun}`} onClick={() => setDraft({ ...EMPTY_DRAFT })}>+</button>
      </div>

      {records.length === 0 && !draft && (
        <div className="kb-empty">
          No shared {noun}s yet — these persist across every script in the series.
        </div>
      )}

      {records.map((rec) => {
        const portrait = !isScene;
        return (
          <div key={rec.id} className="kb-asset-entry">
            {rec.referenceImageDataUrl ? (
              <img className={`kb-asset-thumb ${portrait ? "" : "wide"}`} src={rec.referenceImageDataUrl} alt={rec.name} />
            ) : (
              <div className={`kb-asset-thumb ${portrait ? "" : "wide"} kb-thumb-empty`}>no image</div>
            )}
            <div className="kb-asset-body">
              <div className="kb-entry-name">{rec.name} <span className="series-rec-badge">series</span></div>
              <div className="kb-entry-preview">{rec.aliases.join(", ") || "—"}</div>
              {rec.description && (
                <div className="kb-entry-preview">{rec.description.slice(0, 120)}{rec.description.length > 120 ? "…" : ""}</div>
              )}
              <div className="kb-entry-actions">
                <button onClick={() => startEdit(rec)}>Edit</button>
                <button onClick={() => handleDelete(rec)}>Del</button>
              </div>
            </div>
          </div>
        );
      })}

      {draft && (
        <div className="series-rec-editor">
          <div className="kb-field-label">{draft.id ? `EDIT ${NounCap.toUpperCase()}` : `NEW ${NounCap.toUpperCase()}`}</div>
          <input
            className="kb-input-sm"
            placeholder={isScene ? "Name (e.g. Maddox Family Kitchen)" : "Name (e.g. Aiden)"}
            value={draft.name}
            onChange={(e) => setDraft({ ...draft, name: e.target.value })}
          />
          <input
            className="kb-input-sm"
            placeholder={aliasLabel}
            value={draft.aliases}
            onChange={(e) => setDraft({ ...draft, aliases: e.target.value })}
          />
          {isScene && (
            <select
              className="kb-input-sm"
              value={draft.category}
              onChange={(e) => setDraft({ ...draft, category: e.target.value as WorldLocationCategory })}
            >
              <option value="interior">Interior</option>
              <option value="exterior">Exterior</option>
              <option value="other">Other</option>
            </select>
          )}
          <textarea
            className="kb-textarea-sm"
            rows={3}
            placeholder={isScene ? "Visual description (used for image generation & continuity)" : "Appearance / who they are (used for portrait generation & continuity)"}
            value={draft.description}
            onChange={(e) => setDraft({ ...draft, description: e.target.value })}
          />
          {!isScene && (
            <>
              <input
                className="kb-input-sm"
                placeholder="Traits — comma-separated (brave, impulsive)"
                value={draft.traits}
                onChange={(e) => setDraft({ ...draft, traits: e.target.value })}
              />
              <textarea
                className="kb-textarea-sm"
                rows={2}
                placeholder="Voice notes (speech patterns, vocabulary)"
                value={draft.voiceNotes}
                onChange={(e) => setDraft({ ...draft, voiceNotes: e.target.value })}
              />
            </>
          )}
          <SeriesImageField
            seriesId={seriesId}
            kind={isScene ? "scene_set" : "character"}
            name={draft.name}
            description={draft.description}
            imageDataUrl={draft.referenceImageDataUrl}
            onChange={handleImageChange}
          />
          <div className="series-rec-btn-row">
            <button className="kb-action-btn primary" onClick={handleSave} disabled={!draft.name.trim()}>Save</button>
            <button className="kb-action-btn" onClick={() => setDraft(null)}>Cancel</button>
          </div>
        </div>
      )}
    </div>
  );
}

function parseTraits(input: string): string[] {
  return Array.from(new Set(input.split(/[,;\n]/).map((t) => t.trim()).filter(Boolean)));
}
