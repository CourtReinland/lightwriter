import "./ElementBar.css";

export type ElementType =
  | "scene"
  | "action"
  | "character"
  | "dialogue"
  | "parenthetical"
  | "transition"
  | "shot";

interface ElementBarProps {
  currentElement: ElementType;
  onInsertElement: (type: ElementType) => void;
}

const ELEMENTS: { type: ElementType; label: string; shortcut: string; hint: string }[] = [
  { type: "scene", label: "Scene", shortcut: "1", hint: "INT./EXT. LOCATION - TIME" },
  { type: "action", label: "Action", shortcut: "2", hint: "Description of what happens" },
  { type: "character", label: "Character", shortcut: "3", hint: "@CHARACTER NAME" },
  { type: "dialogue", label: "Dialogue", shortcut: "4", hint: "Spoken words" },
  { type: "parenthetical", label: "Paren", shortcut: "5", hint: "(how it's said)" },
  { type: "transition", label: "Trans", shortcut: "6", hint: "> CUT TO:" },
  { type: "shot", label: "Shot", shortcut: "7", hint: "!!CAMERA DIRECTION" },
];

export default function ElementBar({ currentElement, onInsertElement }: ElementBarProps) {
  return (
    <div className="element-bar">
      {ELEMENTS.map((el) => (
        <button
          key={el.type}
          className={`element-btn ${currentElement === el.type ? "active" : ""}`}
          onClick={() => onInsertElement(el.type)}
          title={`${el.hint} (${el.shortcut})`}
        >
          <span className="element-label">{el.label}</span>
        </button>
      ))}
    </div>
  );
}

/**
 * Get the Fountain prefix/template for an element type on an empty line.
 */
export function getElementTemplate(type: ElementType): string | null {
  switch (type) {
    case "scene":
      return "\nINT. ";
    case "action":
      return "\n";
    case "character":
      return "\n@";
    case "dialogue":
      return "";
    case "parenthetical":
      return "(";
    case "transition":
      return "\n> ";
    case "shot":
      return "\n!!";
  }
}

/**
 * Strip any forced-element prefix from a line, returning the bare text
 * and what prefix was found.
 */
export function stripForcePrefix(text: string): { bare: string; prefix: string } {
  const trimmed = text.trim();
  // Order matters: !! before !, check longest prefixes first
  if (trimmed.startsWith("!!")) return { bare: trimmed.slice(2).trim(), prefix: "!!" };
  if (trimmed.startsWith("@"))  return { bare: trimmed.slice(1).trim(), prefix: "@" };
  if (trimmed.startsWith("!"))  return { bare: trimmed.slice(1).trim(), prefix: "!" };
  if (/^>\s*/.test(trimmed) && !trimmed.endsWith("<")) {
    return { bare: trimmed.replace(/^>\s*/, ""), prefix: ">" };
  }
  if (/^\.((?!\.)\S)/.test(trimmed)) return { bare: trimmed.slice(1), prefix: "." };
  return { bare: trimmed, prefix: "" };
}

/**
 * Detect the current element type based on line content.
 * Follows Beat's forced-element conventions.
 */
export function detectElementType(lineText: string): ElementType {
  const trimmed = lineText.trim();
  if (!trimmed) return "action";

  // Forced elements (prefix-based) — check in priority order
  if (/^!!/.test(trimmed)) return "shot";
  if (/^@/.test(trimmed)) return "character";
  if (/^!/.test(trimmed)) return "action";
  if (/^\.((?!\.)\S)|^(INT|EXT|EST|INT\.\/EXT|I\/E)[.\s]/i.test(trimmed)) return "scene";
  if (/^>.*<\s*$/.test(trimmed)) return "action"; // Centered — treat as action in bar
  if (/^>/.test(trimmed)) return "transition";
  if (/^\s*\(.*\)\s*$/.test(trimmed)) return "parenthetical";

  // ALL CAPS → could be character (the formatting plugin confirms with context)
  if (/^[A-Z][A-Z0-9 ._\-']*(\s*\(.*\))?\s*\^?\s*$/.test(trimmed) && /[A-Z]/.test(trimmed)) {
    return "character";
  }

  return "action";
}
