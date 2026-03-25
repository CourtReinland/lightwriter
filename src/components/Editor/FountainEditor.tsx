import { useRef, useEffect, useCallback } from "react";
import { EditorView, keymap, lineNumbers, highlightActiveLine, highlightActiveLineGutter } from "@codemirror/view";
import { EditorState } from "@codemirror/state";
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { searchKeymap, highlightSelectionMatches } from "@codemirror/search";
import { fountainLanguage } from "../../codemirror/fountain-language";
import { fountainEditorTheme, fountainHighlightStyle } from "../../codemirror/fountain-theme";
import { overlayExtension, setOverlayBeats } from "../../codemirror/overlay-decorations";
import { screenplayFormatting } from "../../codemirror/screenplay-formatting";
import { ALL_FRAMEWORKS, computeBeatRanges } from "../../frameworks";
import type { ComputedBeat } from "../../frameworks";
import { detectElementType, stripForcePrefix, type ElementType } from "./ElementBar";
import "./FountainEditor.css";

/**
 * Element cycle order for TAB key:
 * Scene → Action → Character → Dialogue → Parenthetical → Transition → Shot → Scene...
 */
const ELEMENT_CYCLE: ElementType[] = [
  "scene", "action", "character", "dialogue", "parenthetical", "transition", "shot",
];

/**
 * Track the last TAB-selected element type so we cycle correctly
 * even when content-based detection would loop (e.g., ALL CAPS character → dialogue → character).
 */
let lastTabElement: ElementType | null = null;
let lastTabLineFrom = -1;

function getNextElement(current: ElementType): ElementType {
  const idx = ELEMENT_CYCLE.indexOf(current);
  return ELEMENT_CYCLE[(idx + 1) % ELEMENT_CYCLE.length];
}

function getPrevElement(current: ElementType): ElementType {
  const idx = ELEMENT_CYCLE.indexOf(current);
  return ELEMENT_CYCLE[(idx - 1 + ELEMENT_CYCLE.length) % ELEMENT_CYCLE.length];
}

/**
 * Convert the current line to the given element type using Fountain conventions.
 */
function convertLineToType(view: EditorView, type: ElementType): boolean {
  const pos = view.state.selection.main.head;
  const line = view.state.doc.lineAt(pos);
  const trimmed = line.text.trim();

  // If line is empty, insert appropriate template prefix
  if (!trimmed) {
    let insert = "";
    switch (type) {
      case "scene": insert = "INT. "; break;
      case "action": insert = ""; break;
      case "character": insert = "@"; break;
      case "dialogue": insert = ""; break;
      case "parenthetical": insert = "("; break;
      case "transition": insert = "> "; break;
      case "shot": insert = "!!"; break;
    }
    if (insert) {
      view.dispatch({
        changes: { from: line.from, to: line.to, insert },
        selection: { anchor: line.from + insert.length },
      });
    }
    return true;
  }

  // Line has content — convert it
  const { bare } = stripForcePrefix(trimmed);
  let newText: string;

  switch (type) {
    case "character":
      newText = `@${bare.toUpperCase()}`;
      break;
    case "shot":
      newText = `!!${bare.toUpperCase()}`;
      break;
    case "action":
      if (bare === bare.toUpperCase() && /[A-Z]/.test(bare)) {
        newText = `!${bare}`;
      } else {
        newText = bare;
      }
      break;
    case "scene":
      if (/^(INT|EXT|EST|INT\.\/EXT|I\/E)[.\s]/i.test(bare)) {
        newText = bare.toUpperCase();
      } else {
        newText = `.${bare.toUpperCase()}`;
      }
      break;
    case "transition":
      newText = `> ${bare.toUpperCase()}`;
      break;
    case "dialogue":
      newText = bare;
      break;
    case "parenthetical":
      newText = bare.startsWith("(") ? bare : `(${bare}`;
      if (!newText.endsWith(")")) newText = `${newText})`;
      break;
    default:
      newText = bare;
  }

  if (newText !== line.text) {
    view.dispatch({
      changes: { from: line.from, to: line.to, insert: newText },
      selection: { anchor: line.from + newText.length },
    });
  }
  return true;
}

interface FountainEditorProps {
  content: string;
  onChange: (content: string) => void;
  activeFrameworks: string[];
  targetPages: number;
  onSelectionChange?: (selectedText: string, contextText: string) => void;
  onElementChange?: (element: ElementType) => void;
  viewRef?: React.MutableRefObject<EditorView | undefined>;
}

export default function FountainEditor({
  content,
  onChange,
  activeFrameworks,
  targetPages,
  onSelectionChange,
  onElementChange,
  viewRef: externalViewRef,
}: FountainEditorProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView>(null as unknown as EditorView);
  const onChangeRef = useRef(onChange);
  const onSelectionRef = useRef(onSelectionChange);
  const onElementRef = useRef(onElementChange);
  onChangeRef.current = onChange;
  onSelectionRef.current = onSelectionChange;
  onElementRef.current = onElementChange;

  const createView = useCallback(() => {
    if (!containerRef.current) return;

    const state = EditorState.create({
      doc: content,
      extensions: [
        lineNumbers(),
        highlightActiveLine(),
        highlightActiveLineGutter(),
        history(),
        highlightSelectionMatches(),
        fountainLanguage,
        fountainEditorTheme,
        fountainHighlightStyle,
        screenplayFormatting,
        overlayExtension,
        keymap.of([
          {
            key: "Enter",
            run: (view) => {
              const pos = view.state.selection.main.head;
              const line = view.state.doc.lineAt(pos);
              const trimmed = line.text.trim();
              const type = detectElementType(line.text);

              // Auto-uppercase character names on Enter
              // If the line is a character (@ prefix or ALL CAPS), ensure it's uppercase
              if (type === "character" && trimmed) {
                const { bare } = stripForcePrefix(trimmed);
                const upper = bare.toUpperCase();
                const prefix = trimmed.startsWith("@") ? "@" : "";
                const newText = prefix + upper;
                if (newText !== line.text) {
                  view.dispatch({
                    changes: { from: line.from, to: line.to, insert: newText },
                  });
                }
              }

              // After character line → insert blank line + position for dialogue
              if (type === "character" && trimmed) {
                view.dispatch({
                  changes: { from: line.to, insert: "\n" },
                  selection: { anchor: line.to + 1 },
                });
                // Reset TAB tracking to dialogue for the new line
                lastTabElement = "dialogue";
                lastTabLineFrom = line.to + 1;
                onElementRef.current?.("dialogue");
                return true;
              }

              // After dialogue line → insert blank line (which ends dialogue block) for action
              if (type === "dialogue" && trimmed) {
                // If cursor is at end of line, transition to action
                if (pos === line.to) {
                  view.dispatch({
                    changes: { from: line.to, insert: "\n\n" },
                    selection: { anchor: line.to + 2 },
                  });
                  lastTabElement = "action";
                  lastTabLineFrom = line.to + 2;
                  onElementRef.current?.("action");
                  return true;
                }
              }

              // Default Enter behavior: just insert newline
              return false; // Let CodeMirror handle it
            },
          },
          {
            key: "Tab",
            run: (view) => {
              const pos = view.state.selection.main.head;
              const line = view.state.doc.lineAt(pos);
              // Use tracked element if on same line, else detect from content
              const current = (lastTabElement && lastTabLineFrom === line.from)
                ? lastTabElement
                : detectElementType(line.text);
              const next = getNextElement(current);
              convertLineToType(view, next);
              lastTabElement = next;
              lastTabLineFrom = line.from;
              onElementRef.current?.(next);
              return true;
            },
          },
          {
            key: "Shift-Tab",
            run: (view) => {
              const pos = view.state.selection.main.head;
              const line = view.state.doc.lineAt(pos);
              const current = (lastTabElement && lastTabLineFrom === line.from)
                ? lastTabElement
                : detectElementType(line.text);
              const prev = getPrevElement(current);
              convertLineToType(view, prev);
              lastTabElement = prev;
              lastTabLineFrom = line.from;
              onElementRef.current?.(prev);
              return true;
            },
          },
          ...defaultKeymap,
          ...historyKeymap,
          ...searchKeymap,
        ]),
        EditorView.updateListener.of((update) => {
          if (update.docChanged) {
            onChangeRef.current(update.state.doc.toString());
          }
          if (update.selectionSet || update.docChanged) {
            // Reset TAB tracking when user moves to a different line
            const sel = update.state.selection.main;
            const curLine = update.state.doc.lineAt(sel.head);
            if (lastTabLineFrom !== curLine.from) {
              lastTabElement = null;
              lastTabLineFrom = -1;
            }
            if (sel.from !== sel.to) {
              const selectedText = update.state.doc.sliceString(sel.from, sel.to);
              // Get surrounding context (200 chars before and after)
              const ctxFrom = Math.max(0, sel.from - 200);
              const ctxTo = Math.min(update.state.doc.length, sel.to + 200);
              const contextText = update.state.doc.sliceString(ctxFrom, ctxTo);
              onSelectionRef.current?.(selectedText, contextText);
            } else {
              onSelectionRef.current?.("", "");
            }
          }
        }),
        EditorView.lineWrapping,
      ],
    });

    const view = new EditorView({
      state,
      parent: containerRef.current,
    });

    viewRef.current = view;
    if (externalViewRef) externalViewRef.current = view;
    return view;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const view = createView();
    return () => view?.destroy();
  }, [createView]);

  // Update overlays when frameworks or target pages change
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;

    const totalLines = view.state.doc.lines;
    const beats: ComputedBeat[] = [];

    for (const fw of ALL_FRAMEWORKS) {
      if (activeFrameworks.includes(fw.id)) {
        beats.push(...computeBeatRanges(fw, targetPages, totalLines));
      }
    }

    view.dispatch({
      effects: setOverlayBeats.of(beats),
    });
  }, [activeFrameworks, targetPages, content]);

  return <div ref={containerRef} className="fountain-editor" />;
}
