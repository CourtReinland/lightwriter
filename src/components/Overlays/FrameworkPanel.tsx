import { ALL_FRAMEWORKS } from "../../frameworks";
import "./FrameworkPanel.css";

interface FrameworkPanelProps {
  activeFrameworks: string[];
  onToggle: (frameworkId: string) => void;
  targetPages: number;
}

export default function FrameworkPanel({
  activeFrameworks,
  onToggle,
  targetPages,
}: FrameworkPanelProps) {
  return (
    <div className="framework-panel">
      <div className="framework-panel-header">
        <span className="panel-label">Overlays</span>
        <span className="panel-target">{targetPages}pp</span>
      </div>
      <div className="framework-toggles">
        {ALL_FRAMEWORKS.map((fw) => {
          const isActive = activeFrameworks.includes(fw.id);
          return (
            <button
              key={fw.id}
              className={`framework-toggle ${isActive ? "active" : ""}`}
              onClick={() => onToggle(fw.id)}
              title={`${fw.name} — ${fw.beats.length} beats`}
            >
              <span
                className="toggle-dot"
                style={{ backgroundColor: isActive ? fw.color : "#555" }}
              />
              <span className="toggle-name">{fw.name}</span>
              <span className="toggle-count">{fw.beats.length}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
