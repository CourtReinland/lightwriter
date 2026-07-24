import { useEffect, useMemo, useState, type ChangeEvent } from "react";
import { WorldStateService } from "../../services/worldStateService";
import { getLastBibleSync, isBibleSyncEnabled, onBibleSyncStatus } from "../../services/bibleSyncService";
import type { Project } from "../../services/storageService";

// Series assignment for the current script. The shared, series-scoped SCENES and
// CHARACTERS (with reference images) live in the KB "Scenes" and "Characters"
// sections — this just opts the script into a series so those records apply.

interface WorldSectionProps {
  project: Project;
  onAssignSeries: (seriesId: string | undefined) => void;
}

export default function WorldSection({ project, onAssignSeries }: WorldSectionProps) {
  const [version, setVersion] = useState(0);
  const refresh = () => setVersion((v) => v + 1);

  const seriesList = useMemo(() => WorldStateService.listSeries(), [version]);
  const activeSeriesId = project.seriesId;
  const activeSeries = useMemo(
    () => (activeSeriesId ? WorldStateService.getSeries(activeSeriesId) : null),
    [activeSeriesId, version],
  );

  const [showNewSeries, setShowNewSeries] = useState(false);
  const [newSeriesName, setNewSeriesName] = useState("");

  // Subtle "bible synced" note: re-render whenever the bible sync service
  // finishes an import/export for the active series.
  const [syncTick, setSyncTick] = useState(0);
  useEffect(() => onBibleSyncStatus(() => setSyncTick((t) => t + 1)), []);
  const lastBibleSync = useMemo(
    () => (activeSeriesId && isBibleSyncEnabled() ? getLastBibleSync(activeSeriesId) : null),
    [activeSeriesId, syncTick],
  );

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

      {activeSeries ? (
        <div className="kb-empty">
          In <strong>{activeSeries.name}</strong>. Add shared scenes, characters &amp; objects in the <strong>Scenes</strong>, <strong>Characters</strong> and <strong>Objects</strong> sections below, or click a scene heading / character name in the editor.
          {lastBibleSync !== null && (
            <div style={{ opacity: 0.7, marginTop: "0.35rem" }}>
              Series bible synced {new Date(lastBibleSync).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })} (shared with ScriptToScreen)
            </div>
          )}
        </div>
      ) : (
        !showNewSeries && (
          <div className="kb-empty">Assign this script to a series to share scenes (kitchens, houses, sets) and characters across every script in the series.</div>
        )
      )}
    </div>
  );
}
