import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import {
  WorldStateService,
  parseAliases,
  type WorldLocation,
  type WorldLocationCategory,
  type WorldCharacter,
} from "../../services/worldStateService";
import { loadPersistedImageDataUrl } from "../../services/imageAssetStorageService";
import useRecordImageUrl from "./useRecordImageUrl";
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
  const editorRef = useRef<HTMLDivElement | null>(null);
  // The editor renders inline under the record being edited (or at the bottom
  // for a new one). With a full cast that spot can still be below the fold, so
  // pull it into view whenever it opens for a different record.
  useEffect(() => {
    if (draft) editorRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [draft?.id, draft ? !draft.id : false]);

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
    // Disk-backed records carry only a file path — hydrate the preview from disk
    // WITHOUT flagging imageChanged, so a plain Save won't re-persist it.
    if (!rec.referenceImageDataUrl && rec.referenceFilePath) {
      void loadPersistedImageDataUrl(rec.referenceFilePath).then((loaded) => {
        if (loaded) setDraft((prev) => (prev && prev.id === rec.id ? { ...prev, referenceImageDataUrl: loaded } : prev));
      });
    }
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
    // Records no longer store the inline image blob directly — the image is
    // handled separately below (attach → disk / detach) so localStorage stays
    // free of base64.
    const common = {
      name: draft.name.trim(),
      aliases: parseAliases(draft.aliases),
      description: draft.description.trim(),
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

    // Image side-channel. attachRecordImage owns disk persistence + stripping the
    // inline blob (or keeping it in browser mode). Only touch the image when it
    // actually changed in this edit.
    if (saved && draft.imageChanged) {
      if (draft.referenceImageDataUrl) {
        await WorldStateService.attachRecordImage(kind, saved.id, draft.referenceImageDataUrl, draft.referenceMimeType || "image/png");
      } else {
        WorldStateService.detachRecordImage(kind, saved.id);
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

  // The add/edit form. Rendered INLINE directly under the record being edited
  // (so clicking a record near the top of a long cast doesn't open the editor
  // far below the fold), or at the bottom for a brand-new record.
  const renderEditor = () =>
    draft ? (
      <div ref={editorRef} className="series-rec-editor">
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
          scopeId={seriesId}
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
    ) : null;

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

      {records.map((rec) => (
        <Fragment key={rec.id}>
          <SeriesRecordRow rec={rec} portrait={!isScene} onEdit={startEdit} onDelete={handleDelete} />
          {/* Editor opens right here, under the record being edited. */}
          {draft?.id === rec.id && renderEditor()}
        </Fragment>
      ))}

      {/* A brand-new record's editor renders at the bottom of the list. */}
      {draft && !draft.id && renderEditor()}
    </div>
  );
}

function parseTraits(input: string): string[] {
  return Array.from(new Set(input.split(/[,;\n]/).map((t) => t.trim()).filter(Boolean)));
}

// One record row. Extracted into its own component so the image hook (which
// hydrates a disk-backed thumbnail) can run per-record — hooks can't be called
// conditionally inside a .map callback.
function SeriesRecordRow({
  rec,
  portrait,
  onEdit,
  onDelete,
}: {
  rec: WorldLocation | WorldCharacter;
  portrait: boolean;
  onEdit: (rec: WorldLocation | WorldCharacter) => void;
  onDelete: (rec: WorldLocation | WorldCharacter) => void;
}) {
  const thumbUrl = useRecordImageUrl(rec);
  const editTitle = `Edit ${rec.name} — add or change image`;
  return (
    <div className="kb-asset-entry">
      {thumbUrl ? (
        <img className={`kb-asset-thumb series-rec-clickable ${portrait ? "" : "wide"}`} src={thumbUrl} alt={rec.name} title={editTitle} onClick={() => onEdit(rec)} />
      ) : (
        <div className={`kb-asset-thumb series-rec-clickable ${portrait ? "" : "wide"} kb-thumb-empty`} title={`Add an image to ${rec.name}`} onClick={() => onEdit(rec)}>
          + add image
        </div>
      )}
      <div className="kb-asset-body">
        <div className="kb-entry-name series-rec-clickable" title={editTitle} onClick={() => onEdit(rec)}>{rec.name} <span className="series-rec-badge">series</span></div>
        <div className="kb-entry-preview">{rec.aliases.join(", ") || "—"}</div>
        {rec.description && (
          <div className="kb-entry-preview">{rec.description.slice(0, 120)}{rec.description.length > 120 ? "…" : ""}</div>
        )}
        <div className="kb-entry-actions">
          <button onClick={() => onEdit(rec)}>Edit</button>
          <button onClick={() => onDelete(rec)}>Del</button>
        </div>
      </div>
    </div>
  );
}
