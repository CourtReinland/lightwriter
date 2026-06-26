import { useMemo, useState, type ChangeEvent } from "react";
import {
  WorldStateService,
  parseAliases,
  type WorldLocation,
  type WorldLocationCategory,
} from "../../services/worldStateService";
import { persistGeneratedImageFile } from "../../services/imageAssetStorageService";
import type { Project } from "../../services/storageService";

interface WorldSectionProps {
  project: Project;
  onAssignSeries: (seriesId: string | undefined) => void;
}

interface LocationDraft {
  id?: string;
  name: string;
  aliases: string;
  category: WorldLocationCategory;
  description: string;
  referenceImageDataUrl?: string;
  referenceMimeType?: string;
  referenceFilePath?: string;
  imageChanged?: boolean;
}

const EMPTY_DRAFT: LocationDraft = { name: "", aliases: "", category: "interior", description: "" };

export default function WorldSection({ project, onAssignSeries }: WorldSectionProps) {
  const [version, setVersion] = useState(0);
  const refresh = () => setVersion((v) => v + 1);

  const seriesList = useMemo(() => WorldStateService.listSeries(), [version]);
  const activeSeriesId = project.seriesId;
  const activeSeries = useMemo(
    () => (activeSeriesId ? WorldStateService.getSeries(activeSeriesId) : null),
    [activeSeriesId, version],
  );
  const locations = useMemo(
    () => (activeSeriesId ? WorldStateService.listLocations(activeSeriesId) : []),
    [activeSeriesId, version],
  );

  const [showNewSeries, setShowNewSeries] = useState(false);
  const [newSeriesName, setNewSeriesName] = useState("");
  const [draft, setDraft] = useState<LocationDraft | null>(null);

  const handleSeriesSelect = (e: ChangeEvent<HTMLSelectElement>) => {
    const val = e.target.value;
    if (val === "__new__") {
      setShowNewSeries(true);
      return;
    }
    onAssignSeries(val || undefined);
  };

  const handleCreateSeries = () => {
    const name = newSeriesName.trim();
    if (!name) return;
    const series = WorldStateService.createSeries(name);
    setNewSeriesName("");
    setShowNewSeries(false);
    refresh();
    onAssignSeries(series.id);
  };

  const handleImageFile = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () =>
      setDraft((prev) =>
        prev ? { ...prev, referenceImageDataUrl: String(reader.result), referenceMimeType: file.type, imageChanged: true } : prev,
      );
    reader.readAsDataURL(file);
  };

  const handleSaveDraft = async () => {
    if (!draft || !activeSeriesId || !draft.name.trim()) return;
    const fields = {
      name: draft.name.trim(),
      aliases: parseAliases(draft.aliases),
      category: draft.category,
      description: draft.description.trim(),
      referenceImageDataUrl: draft.referenceImageDataUrl,
      referenceMimeType: draft.referenceMimeType,
    };
    const loc = draft.id
      ? WorldStateService.updateLocation(draft.id, fields)
      : WorldStateService.addLocation(activeSeriesId, fields);

    // Persist the reference image to disk (Electron) so the ScriptToScreen
    // manifest can hand off a durable file path. Best-effort; no-op in browser.
    if (loc && fields.referenceImageDataUrl && (draft.imageChanged || !draft.referenceFilePath)) {
      try {
        const filePath = await persistGeneratedImageFile({
          projectId: activeSeriesId,
          assetId: loc.id,
          name: loc.name,
          mimeType: fields.referenceMimeType || "image/png",
          dataUrl: fields.referenceImageDataUrl,
        });
        if (filePath) WorldStateService.updateLocation(loc.id, { referenceFilePath: filePath });
      } catch {
        /* keep the dataUrl-only fallback */
      }
    }

    setDraft(null);
    refresh();
  };

  const startEdit = (loc: WorldLocation) =>
    setDraft({
      id: loc.id,
      name: loc.name,
      aliases: loc.aliases.join(", "),
      category: loc.category,
      description: loc.description,
      referenceImageDataUrl: loc.referenceImageDataUrl,
      referenceMimeType: loc.referenceMimeType,
      referenceFilePath: loc.referenceFilePath,
    });

  const handleDelete = (loc: WorldLocation) => {
    if (!window.confirm(`Delete world location "${loc.name}"? This removes it from the whole series.`)) return;
    WorldStateService.deleteLocation(loc.id);
    if (draft?.id === loc.id) setDraft(null);
    refresh();
  };

  return (
    <div className="world-section">
      <div className="kb-field-label">SERIES</div>
      <div className="world-series-row">
        <select value={activeSeriesId || ""} onChange={handleSeriesSelect} className="kb-input-sm">
          <option value="">— No series —</option>
          {seriesList.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
          <option value="__new__">+ New series…</option>
        </select>
      </div>

      {showNewSeries && (
        <div className="world-new-series">
          <input
            className="kb-input-sm"
            autoFocus
            placeholder="Series name (e.g. The Maddox Chronicles)"
            value={newSeriesName}
            onChange={(e) => setNewSeriesName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleCreateSeries()}
          />
          <div className="world-btn-row">
            <button className="kb-action-btn primary" onClick={handleCreateSeries}>Create</button>
            <button className="kb-action-btn" onClick={() => { setShowNewSeries(false); setNewSeriesName(""); }}>Cancel</button>
          </div>
        </div>
      )}

      {!activeSeries && !showNewSeries && (
        <div className="kb-empty">Assign this script to a series to share locations (kitchens, houses, sets) across every script in the series.</div>
      )}

      {activeSeries && (
        <>
          <div className="world-loc-head">
            <span className="kb-field-label">LOCATIONS ({locations.length})</span>
            <button className="kb-add-btn" title="Add a world location" onClick={() => setDraft({ ...EMPTY_DRAFT })}>+</button>
          </div>

          {locations.length === 0 && !draft && (
            <div className="kb-empty">No shared locations yet. Add one (e.g. “Maddox Family Kitchen”).</div>
          )}

          {locations.map((loc) => (
            <div key={loc.id} className="kb-asset-entry">
              {loc.referenceImageDataUrl ? (
                <img className="kb-asset-thumb wide" src={loc.referenceImageDataUrl} alt={loc.name} />
              ) : (
                <div className="kb-asset-thumb wide kb-thumb-empty">no image</div>
              )}
              <div className="kb-asset-body">
                <div className="kb-entry-name">{loc.name}</div>
                <div className="kb-entry-preview">
                  {loc.category} · {loc.aliases.join(", ") || "—"}
                </div>
                {loc.description && (
                  <div className="kb-entry-preview">{loc.description.slice(0, 120)}{loc.description.length > 120 ? "…" : ""}</div>
                )}
                <div className="kb-entry-actions">
                  <button onClick={() => startEdit(loc)}>Edit</button>
                  <button onClick={() => handleDelete(loc)}>Del</button>
                </div>
              </div>
            </div>
          ))}

          {draft && (
            <div className="world-editor">
              <div className="kb-field-label">{draft.id ? "EDIT LOCATION" : "NEW LOCATION"}</div>
              <input
                className="kb-input-sm"
                placeholder="Name (e.g. Maddox Family Kitchen)"
                value={draft.name}
                onChange={(e) => setDraft({ ...draft, name: e.target.value })}
              />
              <input
                className="kb-input-sm"
                placeholder="Aliases — scene-heading words, comma-separated (KITCHEN, FAMILY KITCHEN)"
                value={draft.aliases}
                onChange={(e) => setDraft({ ...draft, aliases: e.target.value })}
              />
              <select
                className="kb-input-sm"
                value={draft.category}
                onChange={(e) => setDraft({ ...draft, category: e.target.value as WorldLocationCategory })}
              >
                <option value="interior">Interior</option>
                <option value="exterior">Exterior</option>
                <option value="other">Other</option>
              </select>
              <textarea
                className="kb-textarea-sm"
                rows={3}
                placeholder="Visual description (used for image generation & continuity)"
                value={draft.description}
                onChange={(e) => setDraft({ ...draft, description: e.target.value })}
              />
              <label className="world-image-label">
                Reference image
                <input type="file" accept="image/*" onChange={handleImageFile} />
              </label>
              {draft.referenceImageDataUrl && (
                <img className="world-editor-preview" src={draft.referenceImageDataUrl} alt="reference" />
              )}
              <div className="world-btn-row">
                <button className="kb-action-btn primary" onClick={handleSaveDraft} disabled={!draft.name.trim()}>Save</button>
                <button className="kb-action-btn" onClick={() => setDraft(null)}>Cancel</button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
