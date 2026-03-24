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

function getNextElement(current: ElementType): ElementType {
  const idx = ELEMENT_CYCLE.indexOf(current);
  return ELEMENT_CYCLE[(idx + 1) % ELEMENT_CYCLE.length];
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
            key: "Tab",
            run: (view) => {
              const pos = view.state.selection.main.head;
              const line = view.state.doc.lineAt(pos);
              const current = detectElementType(line.text);
              const next = getNextElement(current);
              convertLineToType(view, next);
              onElementRef.current?.(next);
              return true;
            },
          },
          {
            key: "Shift-Tab",
            run: (view) => {
              const pos = view.state.selection.main.head;
              const line = view.state.doc.lineAt(pos);
              const current = detectElementType(line.text);
              const idx = ELEMENT_CYCLE.indexOf(current);
              const prev = ELEMENT_CYCLE[(idx - 1 + ELEMENT_CYCLE.length) % ELEMENT_CYCLE.length];
              convertLineToType(view, prev);
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
            const sel = update.state.selection.main;
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
