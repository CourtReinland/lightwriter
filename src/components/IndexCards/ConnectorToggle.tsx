import { useState } from "react";
import "./ConnectorToggle.css";

type Connector = "AND" | "BUT" | "THEREFORE";

interface ConnectorToggleProps {
  index: number;
  value: Connector;
  onChange: (index: number, value: Connector) => void;
}

const CONNECTORS: { word: Connector; color: string }[] = [
  { word: "AND", color: "#ef4444" },
  { word: "BUT", color: "#22c55e" },
  { word: "THEREFORE", color: "#22c55e" },
];

export default function ConnectorToggle({ index, value, onChange }: ConnectorToggleProps) {
  return (
    <div className="connector-toggle">
      <div className="connector-line" />
      <div className="connector-buttons">
        {CONNECTORS.map((c) => (
          <button
            key={c.word}
            className={`connector-btn ${value === c.word ? "active" : ""}`}
            style={{
              color: value === c.word ? c.color : "#999",
              borderColor: value === c.word ? c.color : "transparent",
            }}
            onClick={() => onChange(index, c.word)}
          >
            {c.word}
          </button>
        ))}
      </div>
      <div className="connector-line" />
    </div>
  );
}

export type { Connector };
