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
import "./FountainEditor.css";

interface FountainEditorProps {
  content: string;
  onChange: (content: string) => void;
  activeFrameworks: string[];
  targetPages: number;
  onSelectionChange?: (selectedText: string, contextText: string) => void;
  viewRef?: React.MutableRefObject<EditorView | undefined>;
}

export default function FountainEditor({
  content,
  onChange,
  activeFrameworks,
  targetPages,
  onSelectionChange,
  viewRef: externalViewRef,
}: FountainEditorProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView>(null as unknown as EditorView);
  const onChangeRef = useRef(onChange);
  const onSelectionRef = useRef(onSelectionChange);
  onChangeRef.current = onChange;
  onSelectionRef.current = onSelectionChange;

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
        keymap.of([...defaultKeymap, ...historyKeymap, ...searchKeymap]),
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
