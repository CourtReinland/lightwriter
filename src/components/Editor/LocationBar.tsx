import type { WorldLocation, SceneAtCursor } from "../../services/worldStateService";
import "./LocationBar.css";

interface LocationBarProps {
  scene: SceneAtCursor;
  seriesName: string;
  boundLocation: WorldLocation | null;
  matches: WorldLocation[];
  onBind: (locationId: string) => void;
  onUnbind: () => void;
  onQuickAdd: (token: string) => void;
}

export default function LocationBar({
  scene,
  seriesName,
  boundLocation,
  matches,
  onBind,
  onUnbind,
  onQuickAdd,
}: LocationBarProps) {
  const token = scene.token;
  const others = matches.filter((m) => !boundLocation || m.id !== boundLocation.id);

  return (
    <div className="loc-bar" title={`Scene ${scene.index + 1}: ${scene.heading}`}>
      <span className="loc-bar-pin">◆</span>
      <span className="loc-bar-token">{token || "SCENE"}</span>

      {boundLocation ? (
        <>
          <span className="loc-bar-arrow">→</span>
          <span className="loc-bar-bound">{boundLocation.name}</span>
          <button className="loc-bar-chip ghost" onClick={onUnbind}>unlink</button>
          {others.map((m) => (
            <button key={m.id} className="loc-bar-chip" onClick={() => onBind(m.id)}>{m.name}</button>
          ))}
        </>
      ) : matches.length ? (
        <>
          <span className="loc-bar-label">link to</span>
          {matches.map((m) => (
            <button key={m.id} className="loc-bar-chip" onClick={() => onBind(m.id)}>{m.name}</button>
          ))}
          {token && (
            <button className="loc-bar-chip add" onClick={() => onQuickAdd(token)}>+ Add “{token}”</button>
          )}
        </>
      ) : (
        <>
          <span className="loc-bar-label">no match in {seriesName}</span>
          <button className="loc-bar-chip add" onClick={() => onQuickAdd(token)}>+ Add “{token}” to series</button>
        </>
      )}
    </div>
  );
}
