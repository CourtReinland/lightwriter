import { useMemo, useState, type ChangeEvent } from "react";
import {
  WorldStateService,
  type SeriesArc,
  type SeriesCliffhanger,
} from "../../services/worldStateService";
import { StorageService, type Project } from "../../services/storageService";
import SeriesGraph from "./SeriesGraph";
import "./SeriesView.css";

interface SeriesViewProps {
  project: Project;
  /** Assign/clear the CURRENT project's series (kept in App state). */
  onAssignSeries: (seriesId: string | undefined) => void;
  /** Notify App that series data changed (so AI weaving + gutter recompute). */
  onChange: () => void;
}

interface ArcDraft {
  id?: string;
  kind: "plot" | "character";
  name: string;
  characterName: string;
  description: string;
  startEpisode: number;
  endEpisode: number;
}

const ARC_COLORS = { plot: "#3b82f6", character: "#e0a83e" };

export default function SeriesView({ project, onAssignSeries, onChange }: SeriesViewProps) {
  const [version, setVersion] = useState(0);
  const bump = () => {
    setVersion((v) => v + 1);
    onChange();
  };

  const allSeries = useMemo(() => WorldStateService.listSeries(), [version]);
  const [selectedSeriesId, setSelectedSeriesId] = useState<string>(project.seriesId || "");
  const seriesId = selectedSeriesId || project.seriesId || "";
  const series = useMemo(() => (seriesId ? WorldStateService.getSeries(seriesId) : null), [seriesId, version]);

  const [newSeriesName, setNewSeriesName] = useState("");
  const [arcDraft, setArcDraft] = useState<ArcDraft | null>(null);

  const episodeIds = series?.episodeOrder ?? [];
  const episodes = useMemo(
    () => episodeIds.map((id) => ({ id, name: StorageService.getProject(id)?.name ?? "(missing project)" })),
    [episodeIds, version],
  );
  const episodeCount = episodes.length;
  const arcs = useMemo(() => (seriesId ? WorldStateService.listArcs(seriesId) : []), [seriesId, version]);
  const cliffhangers = useMemo(() => (seriesId ? WorldStateService.listCliffhangers(seriesId) : []), [seriesId, version]);

  // Projects not already in this series, eligible to add as episodes.
  const addableProjects = useMemo(
    () => StorageService.listProjects().filter((p) => !episodeIds.includes(p.id)),
    [episodeIds, version],
  );

  const handleCreateSeries = () => {
    const name = newSeriesName.trim();
    if (!name) return;
    const s = WorldStateService.createSeries(name);
    setNewSeriesName("");
    setSelectedSeriesId(s.id);
    onAssignSeries(s.id); // add the current script as episode 1
    bump();
  };

  const epLabel = (i: number) => `Ep ${i + 1}`;

  // Episodes -----------------------------------------------------------------
  const moveEpisode = (index: number, dir: -1 | 1) => {
    const target = index + dir;
    if (target < 0 || target >= episodeIds.length) return;
    const next = [...episodeIds];
    [next[index], next[target]] = [next[target], next[index]];
    WorldStateService.setEpisodeOrder(seriesId, next);
    bump();
  };

  const addEpisodeProject = (pid: string) => {
    if (!pid) return;
    if (pid === project.id) {
      onAssignSeries(seriesId);
    } else {
      const p = StorageService.getProject(pid);
      if (p) {
        p.seriesId = seriesId;
        StorageService.saveProject(p);
      }
      WorldStateService.addEpisode(seriesId, pid);
    }
    bump();
  };

  const removeEpisodeProject = (pid: string) => {
    WorldStateService.removeEpisode(seriesId, pid);
    if (pid === project.id) {
      onAssignSeries(undefined);
    } else {
      const p = StorageService.getProject(pid);
      if (p && p.seriesId === seriesId) {
        p.seriesId = undefined;
        StorageService.saveProject(p);
      }
    }
    bump();
  };

  // Arcs ---------------------------------------------------------------------
  const startNewArc = () =>
    setArcDraft({ kind: "plot", name: "", characterName: "", description: "", startEpisode: 0, endEpisode: Math.max(0, episodeCount - 1) });

  const startEditArc = (a: SeriesArc) =>
    setArcDraft({
      id: a.id,
      kind: a.kind,
      name: a.name,
      characterName: a.characterName || "",
      description: a.description,
      startEpisode: a.startEpisode,
      endEpisode: a.endEpisode,
    });

  const saveArc = () => {
    if (!arcDraft || !arcDraft.name.trim()) return;
    const fields = {
      kind: arcDraft.kind,
      name: arcDraft.name.trim(),
      description: arcDraft.description.trim(),
      characterName: arcDraft.kind === "character" ? arcDraft.characterName.trim() || undefined : undefined,
      startEpisode: Math.min(arcDraft.startEpisode, arcDraft.endEpisode),
      endEpisode: Math.max(arcDraft.startEpisode, arcDraft.endEpisode),
      color: ARC_COLORS[arcDraft.kind],
    };
    if (arcDraft.id) WorldStateService.updateArc(arcDraft.id, fields);
    else WorldStateService.addArc(seriesId, fields);
    setArcDraft(null);
    bump();
  };

  const deleteArc = (a: SeriesArc) => {
    if (!window.confirm(`Delete arc "${a.name}"?`)) return;
    WorldStateService.deleteArc(a.id);
    if (arcDraft?.id === a.id) setArcDraft(null);
    bump();
  };

  // Cliffhangers -------------------------------------------------------------
  const cliffForGap = (fromEpisode: number): SeriesCliffhanger | undefined =>
    cliffhangers.find((c) => c.fromEpisode === fromEpisode);

  const setCliff = (fromEpisode: number, description: string) => {
    if (description.trim()) WorldStateService.upsertCliffhanger(seriesId, fromEpisode, description.trim());
    else WorldStateService.removeCliffhanger(seriesId, fromEpisode);
    bump();
  };

  // ---- Render --------------------------------------------------------------
  if (!series) {
    return (
      <div className="series-view">
        <div className="series-empty">
          <h2>Series Manager</h2>
          <p>Group scripts into a series so the AI writer knows each episode's place, the live plot/character arcs, and its cliffhanger duties.</p>
          {allSeries.length > 0 && (
            <div className="series-row">
              <label>Open an existing series</label>
              <select
                value=""
                onChange={(e) => {
                  if (e.target.value) setSelectedSeriesId(e.target.value);
                }}
              >
                <option value="">— Select —</option>
                {allSeries.map((s) => (
                  <option key={s.id} value={s.id}>{s.name}</option>
                ))}
              </select>
            </div>
          )}
          <div className="series-row">
            <label>Create a new series (adds this script as Episode 1)</label>
            <div className="series-inline">
              <input
                placeholder="Series name (e.g. The Maddox Chronicles)"
                value={newSeriesName}
                onChange={(e) => setNewSeriesName(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleCreateSeries()}
              />
              <button className="series-btn primary" onClick={handleCreateSeries}>Create</button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="series-view">
      <div className="series-header">
        <div>
          <h2>{series.name}</h2>
          <span className="series-sub">{episodeCount} episode{episodeCount === 1 ? "" : "s"} · {arcs.length} arc{arcs.length === 1 ? "" : "s"}</span>
        </div>
        {allSeries.length > 1 && (
          <select className="series-switch" value={seriesId} onChange={(e) => setSelectedSeriesId(e.target.value)}>
            {allSeries.map((s) => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </select>
        )}
      </div>

      {episodes.length > 0 && (
        <SeriesGraph
          episodes={episodes.map((e) => ({ id: e.id, name: e.name }))}
          arcs={arcs}
          cliffhangers={cliffhangers}
          currentProjectId={project.id}
          onArcClick={(id) => {
            const a = arcs.find((x) => x.id === id);
            if (a) startEditArc(a);
          }}
          onCliffhangerClick={() => {}}
        />
      )}

      <div className="series-grid">
        {/* Episodes */}
        <section className="series-card">
          <h3>Episodes</h3>
          {episodes.length === 0 && <p className="series-muted">No episodes yet. Add scripts below.</p>}
          <ol className="series-ep-list">
            {episodes.map((ep, i) => (
              <li key={ep.id} className={`series-ep ${ep.id === project.id ? "current" : ""}`}>
                <span className="series-ep-num">{epLabel(i)}</span>
                <span className="series-ep-name">{ep.name}{ep.id === project.id ? " (open)" : ""}</span>
                <span className="series-ep-actions">
                  <button onClick={() => moveEpisode(i, -1)} disabled={i === 0} title="Move up">↑</button>
                  <button onClick={() => moveEpisode(i, 1)} disabled={i === episodes.length - 1} title="Move down">↓</button>
                  <button onClick={() => removeEpisodeProject(ep.id)} title="Remove from series">✕</button>
                </span>
              </li>
            ))}
          </ol>
          {addableProjects.length > 0 && (
            <div className="series-add-ep">
              <select
                value=""
                onChange={(e: ChangeEvent<HTMLSelectElement>) => addEpisodeProject(e.target.value)}
              >
                <option value="">+ Add a script as an episode…</option>
                {addableProjects.map((p) => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
            </div>
          )}
        </section>

        {/* Arcs */}
        <section className="series-card">
          <div className="series-card-head">
            <h3>Arcs</h3>
            <button className="series-btn" onClick={startNewArc} disabled={!!arcDraft}>+ Arc</button>
          </div>
          {arcs.length === 0 && !arcDraft && (
            <p className="series-muted">No arcs yet. Add a plot arc ("the Gone Ones hide the delusion") or a character arc ("Aiden struggles with his anger") and span it across episodes.</p>
          )}
          <ul className="series-arc-list">
            {arcs.map((a) => (
              <li key={a.id} className="series-arc" style={{ borderLeftColor: a.color || ARC_COLORS[a.kind] }}>
                <div className="series-arc-top">
                  <span className="series-arc-name">{a.name}</span>
                  <span className="series-arc-span">{a.kind === "character" ? "◷" : "▲"} {a.startEpisode === a.endEpisode ? epLabel(a.startEpisode) : `${epLabel(a.startEpisode)}–${epLabel(a.endEpisode)}`}</span>
                </div>
                {a.kind === "character" && a.characterName && <div className="series-arc-meta">{a.characterName}</div>}
                <div className="series-arc-desc">{a.description}</div>
                <div className="series-arc-actions">
                  <button onClick={() => startEditArc(a)}>Edit</button>
                  <button onClick={() => deleteArc(a)}>Del</button>
                </div>
              </li>
            ))}
          </ul>

          {arcDraft && (
            <div className="series-arc-editor">
              <div className="series-inline">
                <select value={arcDraft.kind} onChange={(e) => setArcDraft({ ...arcDraft, kind: e.target.value as "plot" | "character" })}>
                  <option value="plot">Plot arc</option>
                  <option value="character">Character arc</option>
                </select>
                <input placeholder="Arc name" value={arcDraft.name} onChange={(e) => setArcDraft({ ...arcDraft, name: e.target.value })} />
              </div>
              {arcDraft.kind === "character" && (
                <input placeholder="Character name (e.g. Aiden)" value={arcDraft.characterName} onChange={(e) => setArcDraft({ ...arcDraft, characterName: e.target.value })} />
              )}
              <textarea
                rows={3}
                placeholder="What changes / what's at stake across these episodes — the AI pulls this while writing."
                value={arcDraft.description}
                onChange={(e) => setArcDraft({ ...arcDraft, description: e.target.value })}
              />
              <div className="series-inline">
                <label>From</label>
                <select value={arcDraft.startEpisode} onChange={(e) => setArcDraft({ ...arcDraft, startEpisode: Number(e.target.value) })}>
                  {episodes.map((_, i) => <option key={i} value={i}>{epLabel(i)}</option>)}
                </select>
                <label>to</label>
                <select value={arcDraft.endEpisode} onChange={(e) => setArcDraft({ ...arcDraft, endEpisode: Number(e.target.value) })}>
                  {episodes.map((_, i) => <option key={i} value={i}>{epLabel(i)}</option>)}
                </select>
              </div>
              <div className="series-inline">
                <button className="series-btn primary" onClick={saveArc} disabled={!arcDraft.name.trim()}>Save arc</button>
                <button className="series-btn" onClick={() => setArcDraft(null)}>Cancel</button>
              </div>
            </div>
          )}
        </section>

        {/* Cliffhangers */}
        <section className="series-card">
          <h3>Cliffhangers</h3>
          {episodeCount < 2 ? (
            <p className="series-muted">Add a second episode to place a cliffhanger between episodes.</p>
          ) : (
            <ul className="series-cliff-list">
              {episodes.slice(0, -1).map((ep, i) => {
                const c = cliffForGap(i);
                return (
                  <li key={ep.id} className={`series-cliff ${c ? "set" : ""}`}>
                    <span className="series-cliff-gap">▲ {epLabel(i)} → {epLabel(i + 1)}</span>
                    <input
                      placeholder="Cliffhanger that ends this episode and opens the next…"
                      defaultValue={c?.description || ""}
                      onBlur={(e) => setCliff(i, e.target.value)}
                    />
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}
