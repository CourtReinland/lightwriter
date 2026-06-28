import { useEffect, useRef, useState } from "react";
import "./SeriesPrompt.css";

interface SeriesPromptProps {
  /** Default series name (the script/file name). */
  defaultName: string;
  existingSeries: { id: string; name: string }[];
  onCreate: (name: string) => void;
  onUseExisting: (seriesId: string) => void;
  onSkip: () => void;
}

// Shown when an opened project isn't in a series yet. Characters, scenes, and
// their images live in the series database, so every script names a series
// (defaulting to the script's own name) — or joins an existing one.
export default function SeriesPrompt({ defaultName, existingSeries, onCreate, onUseExisting, onSkip }: SeriesPromptProps) {
  const [name, setName] = useState(defaultName);
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => { ref.current?.focus(); ref.current?.select(); }, []);

  return (
    <div className="dialog-backdrop" onClick={onSkip}>
      <div className="series-prompt-dialog" onClick={(e) => e.stopPropagation()}>
        <div className="series-prompt-title">Name this series</div>
        <p className="series-prompt-sub">
          Scripts belong to a series so characters, scenes, and their reference images carry across episodes. Name the series for this script — you can change it later in KB → Series.
        </p>
        <input
          ref={ref}
          className="series-prompt-input"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Series name"
          onKeyDown={(e) => { if (e.key === "Enter" && name.trim()) onCreate(name.trim()); }}
        />
        {existingSeries.length > 0 && (
          <label className="series-prompt-existing">
            …or add this script to an existing series
            <select value="" onChange={(e) => { if (e.target.value) onUseExisting(e.target.value); }}>
              <option value="">Pick a series…</option>
              {existingSeries.map((s) => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>
          </label>
        )}
        <div className="series-prompt-actions">
          <button className="series-prompt-btn primary" disabled={!name.trim()} onClick={() => onCreate(name.trim())}>Create series</button>
          <button className="series-prompt-btn" onClick={onSkip}>Not now</button>
        </div>
      </div>
    </div>
  );
}
