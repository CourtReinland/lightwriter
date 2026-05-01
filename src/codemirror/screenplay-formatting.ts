/**
 * CodeMirror extension that applies screenplay formatting (indentation/margins)
 * to lines based on their element type.
 *
 * Uses a multi-pass approach to correctly classify lines:
 *  Pass 1: Classify each line in isolation (candidates)
 *  Pass 2: Validate character candidates using context:
 *    - Must be preceded by blank line
 *    - Must be followed by non-empty line (dialogue/parenthetical)
 *    - NOT followed by blank, scene heading, or transition
 *  Pass 3: Assign dialogue/parenthetical to lines following confirmed characters
 *
 * Fountain forced-action: lines starting with ! are always action.
 */
import {
  type Extension,
  RangeSetBuilder,
} from "@codemirror/state";
import { Decoration, type DecorationSet, EditorView, ViewPlugin, type ViewUpdate } from "@codemirror/view";

type LineType =
  | "scene"
  | "action"
  | "character"
  | "dialogue"
  | "parenthetical"
  | "transition"
  | "centered"
  | "section"
  | "titlepage"
  | "shot"
  | "empty";

const LINE_CLASS_MAP: Record<string, string> = {
  scene: "cm-fmt-scene",
  character: "cm-fmt-character",
  dialogue: "cm-fmt-dialogue",
  parenthetical: "cm-fmt-parenthetical",
  transition: "cm-fmt-transition",
  centered: "cm-fmt-centered",
  section: "cm-fmt-section",
  titlepage: "cm-fmt-titlepage",
  shot: "cm-fmt-shot",
};

/** Is this line ALL CAPS text that could be a character name? */
function looksLikeCharacter(trimmed: string): boolean {
  if (/^@/.test(trimmed)) return true;
  if (!/^[A-Z]/.test(trimmed)) return false;
  if (trimmed !== trimmed.toUpperCase()) return false;
  if (!/[A-Z]/.test(trimmed)) return false;
  // Must match character pattern: LETTERS, digits, spaces, dots, hyphens, apostrophes
  // with optional (V.O.), (CONT'D), ^ for dual dialogue
  return /^[A-Z][A-Z0-9 ._\-']*((\s*\(.*\))?)\s*\^?\s*$/.test(trimmed);
}

/**
 * Classify a single line without any context.
 *
 * Following Beat's forced-element conventions:
 *   !!  → Shot (camera direction)
 *   !   → Forced Action
 *   @   → Forced Character
 *   .   → Forced Scene Heading
 *   >   → Forced Transition (or >text< for centered)
 */
function classifyLineRaw(trimmed: string): LineType {
  if (!trimmed) return "empty";

  // !! prefix → Shot (must check BEFORE single ! check)
  if (/^!!/.test(trimmed)) return "shot";

  // ! prefix → Forced Action (single bang only, not !!)
  if (/^!/.test(trimmed)) return "action";

  // @ prefix → Forced Character
  if (/^@/.test(trimmed)) return "character";

  // Scene headings
  if (/^\.((?!\.)\S)|^(INT|EXT|EST|INT\.\/EXT|I\/E)[.\s]/i.test(trimmed)) return "scene";

  // Centered: >text<
  if (/^>.*<\s*$/.test(trimmed)) return "centered";

  // Transitions: > text (not centered)
  if (/^>/.test(trimmed)) return "transition";

  // TO: transitions
  if (/^[A-Z ]+TO:\s*$/.test(trimmed)) return "transition";

  // Section headings
  if (/^#{1,3}\s/.test(trimmed)) return "section";

  // Title page keys
  if (/^(Title|Credit|Author|Authors|Source|Draft date|Date|Contact|Copyright|Notes|Revision)\s*:/i.test(trimmed)) {
    return "titlepage";
  }

  return "action";
}

/**
 * Full document classification with context-aware character/dialogue detection.
 */
function classifyDocument(lineTexts: string[]): LineType[] {
  const n = lineTexts.length;

  // Pass 1: classify each line without context
  const types: LineType[] = lineTexts.map((t) => classifyLineRaw(t.trim()));

  // Pass 2: find and confirm character names
  // A character name is an ALL CAPS line that:
  //  - has type "action" from pass 1 (not scene/transition/shot/forced-action/etc)
  //  - is preceded by an empty line (or is at document start)
  //  - is followed by a non-empty line that isn't a scene/transition/section
  // Note: @-forced characters are already classified in pass 1
  for (let i = 0; i < n; i++) {
    if (types[i] !== "action") continue;

    const trimmed = lineTexts[i].trim();
    // Skip forced-action lines (! prefix) — they can never be characters
    if (/^!/.test(trimmed)) continue;
    if (!looksLikeCharacter(trimmed)) continue;

    // Must be preceded by blank line (or start of document)
    const prevIsBlank = i === 0 || types[i - 1] === "empty";
    if (!prevIsBlank) continue;

    // Must be followed by a non-empty line (the dialogue)
    const nextIdx = i + 1;
    if (nextIdx >= n) continue;
    const nextType = types[nextIdx];
    const nextTrimmed = lineTexts[nextIdx].trim();

    // Next line must have content and not be a structural element
    if (
      !nextTrimmed ||
      nextType === "empty" ||
      nextType === "scene" ||
      nextType === "transition" ||
      nextType === "section" ||
      nextType === "centered"
    ) {
      continue; // Not a character — it's just an ALL CAPS action/shot line
    }

    // Confirmed character
    types[i] = "character";
  }

  // Pass 3: mark dialogue and parenthetical lines following confirmed characters
  let inDialogue = false;
  for (let i = 0; i < n; i++) {
    if (types[i] === "character") {
      inDialogue = true;
      continue;
    }

    if (types[i] === "empty") {
      inDialogue = false;
      continue;
    }

    // Structural elements and shots break out of dialogue
    if (
      types[i] === "scene" ||
      types[i] === "transition" ||
      types[i] === "section" ||
      types[i] === "centered" ||
      types[i] === "shot"
    ) {
      inDialogue = false;
      continue;
    }

    if (inDialogue && types[i] === "action") {
      const trimmed = lineTexts[i].trim();
      if (/^\(.*\)\s*$/.test(trimmed)) {
        types[i] = "parenthetical";
      } else {
        types[i] = "dialogue";
      }
    }
  }

  return types;
}

const LINES_PER_PAGE = 56;

function buildFormattingDecorations(view: EditorView): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();
  const doc = view.state.doc;

  // Collect all line texts
  const lineTexts: string[] = [];
  for (let i = 1; i <= doc.lines; i++) {
    lineTexts.push(doc.line(i).text);
  }

  const types = classifyDocument(lineTexts);

  for (let i = 0; i < types.length; i++) {
    const cssClass = LINE_CLASS_MAP[types[i]];
    if (cssClass) {
      const line = doc.line(i + 1);
      builder.add(line.from, line.from, Decoration.line({ class: cssClass }));
    }
  }

  return builder.finish();
}

/**
 * Build page break line decorations using CSS classes instead of block widgets.
 * This avoids viewport calculation bugs that block widgets can cause.
 * The page number is rendered via a CSS `content` attr.
 */
function buildPageBreakDecorations(view: EditorView): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();
  const doc = view.state.doc;
  const totalLines = doc.lines;

  for (let lineNum = LINES_PER_PAGE; lineNum <= totalLines; lineNum += LINES_PER_PAGE) {
    const pageNum = Math.floor(lineNum / LINES_PER_PAGE) + 1;
    const line = doc.line(lineNum);
    builder.add(
      line.from,
      line.from,
      Decoration.line({
        class: "cm-page-break-line",
        attributes: { "data-page": String(pageNum) },
      }),
    );
  }

  return builder.finish();
}

/**
 * Auto-capitalize scene headings and shot lines as the user types.
 * Uses requestAnimationFrame to avoid dispatching during a ViewPlugin update.
 */
let autoCapsPending = false;

export interface AutoCapsSnapshot {
  lineNumber: number;
}

export interface AutoCapsLineState {
  lineNumber: number;
  from: number;
  to: number;
  text: string;
  cursorPos: number;
}

function isSceneOrShotLine(trimmed: string): boolean {
  return /^\.((?!\.)\S)|^(INT|EXT|EST|INT\.\/EXT|I\/E)[.\s]/i.test(trimmed) || /^!!/.test(trimmed);
}

export function getAutoCapsChange(
  snapshot: AutoCapsSnapshot,
  current: AutoCapsLineState,
): { from: number; to: number; insert: string; selectionAnchor: number } | null {
  if (snapshot.lineNumber !== current.lineNumber) return null;
  if (current.cursorPos !== current.to) return null;
  if (!isSceneOrShotLine(current.text.trim())) return null;

  const upper = current.text.toUpperCase();
  if (upper === current.text) return null;

  return {
    from: current.from,
    to: current.to,
    insert: upper,
    selectionAnchor: current.from + upper.length,
  };
}

function autoCapsOnChange(update: ViewUpdate) {
  if (!update.docChanged || autoCapsPending) return;

  const view = update.view;
  const doc = view.state.doc;
  const pos = view.state.selection.main.head;
  const lineObj = doc.lineAt(pos);
  const trimmed = lineObj.text.trim();

  // Only auto-caps if cursor is at the end of the line (user is actively typing)
  if (pos !== lineObj.to) return;
  if (!isSceneOrShotLine(trimmed)) return;
  if (lineObj.text.toUpperCase() === lineObj.text) return;

  const snapshot: AutoCapsSnapshot = { lineNumber: lineObj.number };

  // Defer the dispatch to avoid dispatching inside a ViewPlugin update. Re-check the
  // original line number before touching the document; otherwise a quick arrow/click
  // between the change and this RAF can uppercase the wrong line and move the cursor.
  autoCapsPending = true;
  requestAnimationFrame(() => {
    autoCapsPending = false;
    if (snapshot.lineNumber > view.state.doc.lines) return;

    const currentPos = view.state.selection.main.head;
    const currentLine = view.state.doc.line(snapshot.lineNumber);
    const change = getAutoCapsChange(snapshot, {
      lineNumber: currentLine.number,
      from: currentLine.from,
      to: currentLine.to,
      text: currentLine.text,
      cursorPos: currentPos,
    });

    if (change) {
      view.dispatch({
        changes: { from: change.from, to: change.to, insert: change.insert },
        selection: { anchor: change.selectionAnchor },
      });
    }
  });
}

const formattingPlugin = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;

    constructor(view: EditorView) {
      this.decorations = buildFormattingDecorations(view);
    }

    update(update: ViewUpdate) {
      if (update.docChanged || update.viewportChanged) {
        this.decorations = buildFormattingDecorations(update.view);
      }
      // Auto-caps for scene/shot lines
      autoCapsOnChange(update);
    }
  },
  {
    decorations: (v) => v.decorations,
  },
);

const pageBreakPlugin = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;

    constructor(view: EditorView) {
      this.decorations = buildPageBreakDecorations(view);
    }

    update(update: ViewUpdate) {
      if (update.docChanged || update.viewportChanged) {
        this.decorations = buildPageBreakDecorations(update.view);
      }
    }
  },
  {
    decorations: (v) => v.decorations,
  },
);

const formattingTheme = EditorView.baseTheme({
  ".cm-fmt-character": {
    paddingLeft: "220px !important",
  },
  ".cm-fmt-dialogue": {
    paddingLeft: "110px !important",
    paddingRight: "220px !important",
  },
  ".cm-fmt-parenthetical": {
    paddingLeft: "170px !important",
    paddingRight: "260px !important",
  },
  ".cm-fmt-transition": {
    textAlign: "right",
    paddingRight: "16px !important",
  },
  ".cm-fmt-centered": {
    textAlign: "center",
  },
  ".cm-fmt-shot": {
    /* Shot: same left margin as action (flush left), uppercase handled by text content */
  },
  /* Page break: visual marker only. Do not add margin/padding/height here —
     CodeMirror's cursor motion relies on its measured line heights, and vertical
     CSS on line decorations can make arrow-key movement skip or land oddly. */
  ".cm-page-break-line": {
    borderBottom: "1px dashed #ccc",
    position: "relative",
  },
  ".cm-page-break-line::after": {
    content: "attr(data-page)",
    position: "absolute",
    right: "16px",
    bottom: "-1px",
    transform: "translateY(50%)",
    fontSize: "9px",
    color: "#aaa",
    fontFamily: "'Courier Prime', monospace",
    background: "#fefefe",
    padding: "0 4px",
    pointerEvents: "none",
  },
});

export const screenplayFormatting: Extension = [formattingPlugin, pageBreakPlugin, formattingTheme];
