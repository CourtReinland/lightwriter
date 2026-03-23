import { EditorView } from "@codemirror/view";
import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { tags } from "@lezer/highlight";

/**
 * Screenplay formatting following industry conventions:
 * - Page width: ~60 characters (Courier 12pt)
 * - Scene headings: left margin, uppercase, bold
 * - Action: left margin, full width
 * - Character: centered (indent ~37ch from left = ~22ch padding)
 * - Dialogue: narrower column, indented ~10ch from left, ~10ch from right
 * - Parenthetical: between character and dialogue indent, ~16ch
 * - Transition: right-aligned
 *
 * Beat uses: character-indent: 20ch, dialogue-indent: 10ch, parenthetical-indent: 16ch
 */

export const fountainEditorTheme = EditorView.theme({
  "&": {
    fontSize: "13px",
    fontFamily: "'Courier Prime', 'Courier New', Courier, monospace",
    backgroundColor: "#fefefe",
    color: "#1a1a1a",
    height: "100%",
  },
  ".cm-content": {
    padding: "24px 0",
    maxWidth: "680px",
    margin: "0 auto",
    caretColor: "#333",
  },
  ".cm-cursor": {
    borderLeftColor: "#333",
    borderLeftWidth: "2px",
  },
  ".cm-gutters": {
    backgroundColor: "#f8f8f8",
    color: "#aaa",
    border: "none",
    minWidth: "40px",
  },
  ".cm-activeLineGutter": {
    backgroundColor: "#f0f0f0",
  },
  ".cm-activeLine": {
    backgroundColor: "#f9f9f9",
  },
  ".cm-selectionBackground": {
    backgroundColor: "#d7e8fc !important",
  },
  "&.cm-focused .cm-selectionBackground": {
    backgroundColor: "#b8d4f0 !important",
  },
  ".cm-line": {
    padding: "0 16px",
  },
});

export const fountainHighlightStyle = syntaxHighlighting(
  HighlightStyle.define([
    // Scene headings: bold, blue, uppercase
    { tag: tags.keyword, color: "#2563eb", fontWeight: "bold" },
    // Character names: purple, bold, centered via padding
    {
      tag: tags.variableName,
      color: "#7c3aed",
      fontWeight: "bold",
    },
    // Dialogue: dark gray
    { tag: tags.string, color: "#374151" },
    // Parentheticals: gray italic
    { tag: tags.bracket, color: "#6b7280", fontStyle: "italic" },
    // Transitions: purple, right-aligned
    { tag: tags.processingInstruction, color: "#9333ea" },
    // Sections: green, bold
    { tag: tags.heading, color: "#059669", fontWeight: "bold", fontSize: "1.1em" },
    // Notes & boneyard: light gray, italic
    { tag: tags.comment, color: "#9ca3af", fontStyle: "italic" },
    // Synopsis: amber, italic
    { tag: tags.meta, color: "#d97706", fontStyle: "italic" },
    // Page breaks
    { tag: tags.contentSeparator, color: "#d1d5db" },
    // Title page keys
    { tag: tags.labelName, color: "#b45309" },
    // Bold/italic inline
    { tag: tags.strong, fontWeight: "bold" },
    { tag: tags.emphasis, fontStyle: "italic" },
  ]),
);
