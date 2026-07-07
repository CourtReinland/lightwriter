import { useEffect, useMemo, useRef, useState } from "react";
import type { Project } from "../../services/storageService";
import { WorldStateService } from "../../services/worldStateService";
import {
  GreenRoomStore,
  characterReply,
  draftDossier,
  type CharacterDossier,
} from "../../services/greenRoomService";
import { VoiceCorpusStore } from "../../services/voiceCorpusStore";
import { buildCharacterLineIndex, buildSeriesAliasMap } from "../../services/characterLineIndex";
import useRecordImageUrl from "../Series/useRecordImageUrl";
import "./GreenRoom.css";

interface GreenRoomViewProps {
  project: Project;
}

const DOSSIER_FIELDS: Array<{ key: keyof Pick<CharacterDossier, "lifeStory" | "want" | "secret" | "selfLie" | "voiceNotes">; label: string; rows: number; hint: string }> = [
  { key: "lifeStory", label: "Life story", rows: 4, hint: "Backstory the show stands on — where they come from, what shaped them." },
  { key: "want", label: "Want", rows: 2, hint: "Surface want + the deeper want underneath it." },
  { key: "secret", label: "Secret", rows: 2, hint: "What they hide, and from whom. Plays as subtext." },
  { key: "selfLie", label: "The lie they tell themselves", rows: 2, hint: "They don't know it's a lie." },
  { key: "voiceNotes", label: "How they talk", rows: 2, hint: "Rhythm, vocabulary, tics — seeded from their real lines." },
];

// The Green Room: talk to your characters between takes. Each character is a
// persistent agent — dossier psychology + their real produced lines + rolling
// memory of everything you've shown them.
export default function GreenRoomView({ project }: GreenRoomViewProps) {
  const seriesId = project.seriesId || "";
  const [version, setVersion] = useState(0);
  const bump = () => setVersion((v) => v + 1);

  const characters = useMemo(() => (seriesId ? WorldStateService.listCharacters(seriesId) : []), [seriesId, version]);
  // Characters can also exist only in the corpus (speaking roles never added to the KB).
  const corpusNames = useMemo(() => {
    if (!seriesId) return [] as string[];
    const scripts = VoiceCorpusStore.listScripts(seriesId);
    if (!scripts.length) return [] as string[];
    const index = buildCharacterLineIndex(scripts, buildSeriesAliasMap(seriesId));
    return Object.values(index)
      .filter((e) => e.lines.length >= 8) // speaking roles, not one-off waiters
      .map((e) => e.name);
  }, [seriesId, version]);

  const cast = useMemo(() => {
    const seen = new Map<string, CastMember>();
    // Carry the record's image source (inline data url OR on-disk file path) so
    // disk-backed portraits resolve too — the inline blob no longer lives here.
    for (const c of characters) seen.set(c.name.toLowerCase(), { name: c.name, referenceImageDataUrl: c.referenceImageDataUrl, referenceFilePath: c.referenceFilePath });
    for (const n of corpusNames) {
      const key = n.toLowerCase();
      if (!seen.has(key)) seen.set(key, { name: n });
    }
    return Array.from(seen.values()).sort((a, b) => a.name.localeCompare(b.name));
  }, [characters, corpusNames]);

  const [selected, setSelected] = useState<string>("");
  const active = selected || cast[0]?.name || "";
  const activeMember = cast.find((c) => c.name === active) || null;

  const dossier = useMemo(
    () => (seriesId && active ? GreenRoomStore.getDossier(seriesId, active) : null),
    [seriesId, active, version],
  );
  const chat = useMemo(
    () => (seriesId && active ? GreenRoomStore.getChat(seriesId, active) : []),
    [seriesId, active, version],
  );

  const [message, setMessage] = useState("");
  const [pendingMsg, setPendingMsg] = useState("");
  const [thinking, setThinking] = useState(false);
  const [drafting, setDrafting] = useState(false);
  const [error, setError] = useState("");
  const [showDossier, setShowDossier] = useState(false);
  const chatEnd = useRef<HTMLDivElement>(null);

  useEffect(() => {
    chatEnd.current?.scrollIntoView({ behavior: "smooth" });
  }, [chat.length, thinking]);

  if (!seriesId) {
    return (
      <div className="greenroom-view">
        <div className="greenroom-empty">
          <h2>Green Room</h2>
          <p>Assign this script to a series first (Series tab). Your characters live at series level — same Aiden, every episode.</p>
        </div>
      </div>
    );
  }

  if (cast.length === 0) {
    return (
      <div className="greenroom-view">
        <div className="greenroom-empty">
          <h2>Green Room</h2>
          <p>No characters yet. Add characters to the series (KB tab), or import your produced scripts in the Series tab's Author Voice card — speaking roles walk in on their own.</p>
        </div>
      </div>
    );
  }

  const send = async () => {
    const text = message.trim();
    if (!text || thinking || !active) return;
    setMessage("");
    setError("");
    setPendingMsg(text); // shown immediately; characterReply persists both turns on success
    setThinking(true);
    try {
      await characterReply(seriesId, active, text);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setMessage(text); // give the author their words back to retry
    } finally {
      setPendingMsg("");
      setThinking(false);
      bump();
    }
  };

  const handleDraftDossier = async () => {
    setError("");
    setDrafting(true);
    try {
      await draftDossier(seriesId, active);
      setShowDossier(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setDrafting(false);
      bump();
    }
  };

  const initials = (name: string) => name.split(/\s+/).map((w) => w[0]).join("").slice(0, 2).toUpperCase();

  return (
    <div className="greenroom-view">
      {/* Cast rail */}
      <aside className="greenroom-cast">
        <h3>The Cast</h3>
        {cast.map((c) => (
          <button
            key={c.name}
            className={`greenroom-castbtn ${c.name === active ? "active" : ""}`}
            onClick={() => {
              setSelected(c.name);
              setShowDossier(false);
              setError("");
            }}
          >
            <CastAvatar member={c} className="greenroom-avatar" fallback={initials(c.name)} />
            <span className="greenroom-castname">{c.name}</span>
          </button>
        ))}
      </aside>

      {/* Character room */}
      <section className="greenroom-main">
        <header className="greenroom-header">
          <CastAvatar member={activeMember} className="greenroom-avatar lg" fallback={initials(active)} alt={active} />

          <div className="greenroom-title">
            <h2>{active}</h2>
            <span className="greenroom-sub">
              {dossier && (dossier.want || dossier.secret) ? "dossier on file" : "no dossier yet"}
              {dossier?.memory ? " · remembers your talks" : ""}
            </span>
          </div>
          <div className="greenroom-actions">
            <button className="series-btn" onClick={() => setShowDossier((s) => !s)}>
              {showDossier ? "Hide dossier" : "Dossier"}
            </button>
            <button className="series-btn" onClick={handleDraftDossier} disabled={drafting}>
              {drafting ? "Drafting…" : "Draft dossier with AI"}
            </button>
            {chat.length > 0 && (
              <button
                className="series-btn"
                onClick={() => {
                  if (window.confirm(`Clear your conversation with ${active}? (Their distilled memory stays.)`)) {
                    GreenRoomStore.clearChat(seriesId, active);
                    bump();
                  }
                }}
              >
                Clear chat
              </button>
            )}
          </div>
        </header>

        {showDossier && (
          <div className="greenroom-dossier">
            {DOSSIER_FIELDS.map((f) => (
              <label key={f.key}>
                <span title={f.hint}>{f.label}</span>
                <textarea
                  rows={f.rows}
                  placeholder={f.hint}
                  defaultValue={dossier?.[f.key] || ""}
                  onBlur={(e) => {
                    const d = GreenRoomStore.ensureDossier(seriesId, active);
                    (d[f.key] as string) = e.target.value;
                    GreenRoomStore.saveDossier(d);
                    bump();
                  }}
                />
              </label>
            ))}
            {dossier?.memory && (
              <label>
                <span title="Distilled automatically from long conversations">Memory of your talks</span>
                <textarea
                  rows={3}
                  defaultValue={dossier.memory}
                  onBlur={(e) => {
                    const d = GreenRoomStore.ensureDossier(seriesId, active);
                    d.memory = e.target.value;
                    GreenRoomStore.saveDossier(d);
                    bump();
                  }}
                />
              </label>
            )}
          </div>
        )}

        <div className="greenroom-chat">
          {chat.length === 0 && !thinking && (
            <p className="greenroom-hint">
              Talk to {active}. Ask what they'd do in a scene, pitch them a line (they'll refuse ones that aren't them),
              show them things — they remember across sessions.
            </p>
          )}
          {chat.map((m, i) => (
            <div key={i} className={`greenroom-msg ${m.role}`}>
              <span className="greenroom-msg-who">{m.role === "author" ? "You" : active}</span>
              <p>{m.text}</p>
            </div>
          ))}
          {pendingMsg && (
            <div className="greenroom-msg author">
              <span className="greenroom-msg-who">You</span>
              <p>{pendingMsg}</p>
            </div>
          )}
          {thinking && (
            <div className="greenroom-msg character">
              <span className="greenroom-msg-who">{active}</span>
              <p className="greenroom-thinking">…</p>
            </div>
          )}
          <div ref={chatEnd} />
        </div>

        {error && <p className="voice-error">{error}</p>}

        <div className="greenroom-input">
          <textarea
            rows={2}
            placeholder={`Say something to ${active}… (Enter to send, Shift+Enter for a new line)`}
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void send();
              }
            }}
            disabled={thinking}
          />
          <button className="series-btn primary" onClick={() => void send()} disabled={thinking || !message.trim()}>
            {thinking ? "…" : "Send"}
          </button>
        </div>
      </section>
    </div>
  );
}

interface CastMember {
  name: string;
  referenceImageDataUrl?: string;
  referenceFilePath?: string;
}

// Renders a character avatar, resolving disk-backed portraits (referenceFilePath)
// as well as inline data urls. Falls back to initials when there is no image.
function CastAvatar({ member, className, fallback, alt }: { member: CastMember | null; className: string; fallback: string; alt?: string }) {
  const imageUrl = useRecordImageUrl(member);
  if (imageUrl) return <img className={className} src={imageUrl} alt={alt ?? member?.name ?? ""} />;
  return <span className={`${className} fallback`}>{fallback}</span>;
}
