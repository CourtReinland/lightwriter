import { useMemo, useState } from "react";
import { CharacterJournalStore } from "../../services/characterJournalStore";
import { WorldStateService } from "../../services/worldStateService";
import { StorageService } from "../../services/storageService";
import "./Voice.css";

interface JournalsCardProps {
  seriesId: string;
  currentProjectId: string;
}

// Series card: per-episode, per-character "thought journals" — the author's
// in-character account of that character's day during the episode. Writing
// passes read them as private interiority (never quoted on screen).
export default function JournalsCard({ seriesId, currentProjectId }: JournalsCardProps) {
  const [version, setVersion] = useState(0);
  const bump = () => setVersion((v) => v + 1);

  const series = useMemo(() => WorldStateService.getSeries(seriesId), [seriesId, version]);
  const episodes = useMemo(
    () =>
      (series?.episodeOrder || []).map((id, i) => ({
        id,
        label: `Ep ${i + 1} — ${StorageService.getProject(id)?.name ?? "(missing)"}`,
      })),
    [series, version],
  );
  const characters = useMemo(() => WorldStateService.listCharacters(seriesId), [seriesId, version]);

  const defaultEpisode = episodes.some((e) => e.id === currentProjectId)
    ? currentProjectId
    : episodes[0]?.id || "";
  const [episodeId, setEpisodeId] = useState(defaultEpisode);
  const [customName, setCustomName] = useState("");
  const [extraNames, setExtraNames] = useState<string[]>([]);

  const journals = useMemo(
    () => (episodeId ? CharacterJournalStore.list(seriesId).filter((j) => j.projectId === episodeId) : []),
    [seriesId, episodeId, version],
  );

  // World characters + any journal-only names for this episode + names added this session.
  const names = useMemo(() => {
    const set = new Map<string, string>();
    for (const c of characters) set.set(c.name.toLowerCase(), c.name);
    for (const j of journals) set.set(j.characterName.toLowerCase(), j.characterName);
    for (const n of extraNames) set.set(n.toLowerCase(), n);
    return Array.from(set.values());
  }, [characters, journals, extraNames]);

  const journalFor = (name: string) =>
    journals.find((j) => j.characterName.toLowerCase() === name.toLowerCase())?.text || "";

  if (episodes.length === 0) {
    return (
      <section className="series-card">
        <h3>Thought Journals</h3>
        <p className="series-muted">Add episodes to the series first — journals are written per character, per episode.</p>
      </section>
    );
  }

  return (
    <section className="series-card voice-card">
      <div className="series-card-head">
        <h3>Thought Journals</h3>
      </div>
      <p className="series-muted">
        Write each character's private account of their day this episode — mood, wants, what's eating them.
        The AI writers condition dialogue on these but never quote them.
      </p>

      <select className="voice-journal-episode" value={episodeId} onChange={(e) => setEpisodeId(e.target.value)}>
        {episodes.map((e) => (
          <option key={e.id} value={e.id}>{e.label}</option>
        ))}
      </select>

      <div className="voice-journal-list">
        {names.map((name) => {
          const text = journalFor(name);
          return (
            <details key={name} className="voice-journal" open={!!text}>
              <summary>
                {name}
                {text ? <span className="voice-journal-badge">{text.split(/\s+/).filter(Boolean).length}w</span> : <span className="voice-journal-badge empty">empty</span>}
              </summary>
              <textarea
                rows={5}
                placeholder={`${name}'s day, in their own head — first person. "Woke up thinking about the pie…"`}
                defaultValue={text}
                onBlur={(e) => {
                  CharacterJournalStore.upsert(seriesId, name, episodeId, e.target.value);
                  bump();
                }}
              />
            </details>
          );
        })}
      </div>

      <div className="series-inline">
        <input
          placeholder="Add a character by name…"
          value={customName}
          onChange={(e) => setCustomName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && customName.trim()) {
              setExtraNames((prev) => [...prev, customName.trim()]);
              setCustomName("");
            }
          }}
        />
        <button
          className="series-btn"
          disabled={!customName.trim()}
          onClick={() => {
            setExtraNames((prev) => [...prev, customName.trim()]);
            setCustomName("");
          }}
        >
          Add
        </button>
      </div>
    </section>
  );
}
