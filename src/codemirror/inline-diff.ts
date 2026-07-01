import { StateField, StateEffect, type Extension, type Range } from "@codemirror/state";
import { Decoration, type DecorationSet, EditorView, WidgetType } from "@codemirror/view";
import type { InlineDiff } from "../services/inlineDiffService";

// A React-driven "pending diff" overlay. The editor document stays UNMUTATED
// (it keeps showing the original text); this just draws the pending rewrite over
// it — deletions struck through in place, additions shown as highlighted widgets
// — until the user Accepts (commit replaces the doc + clears) or Rejects (clear).
// Because the doc isn't touched, autosave/version-history don't fire during
// preview. Mirrors the overlay-decorations StateField/StateEffect pattern.

export const setPendingDiff = StateEffect.define<InlineDiff | null>();

const deletionMark = Decoration.mark({ class: "cm-diff-del" });

class AddWidget extends WidgetType {
  constructor(readonly text: string) {
    super();
  }
  eq(other: AddWidget): boolean {
    return other.text === this.text;
  }
  toDOM(): HTMLElement {
    const el = document.createElement("span");
    el.className = "cm-diff-add";
    el.textContent = this.text;
    return el;
  }
  ignoreEvent(): boolean {
    return true;
  }
}

function buildDiffDecorations(diff: InlineDiff, docLength: number): DecorationSet {
  const ranges: Range<Decoration>[] = [];
  for (const del of diff.deletions) {
    const from = Math.max(0, Math.min(del.from, docLength));
    const to = Math.max(from, Math.min(del.to, docLength));
    if (to > from) ranges.push(deletionMark.range(from, to));
  }
  for (const ins of diff.insertions) {
    const at = Math.max(0, Math.min(ins.at, docLength));
    ranges.push(Decoration.widget({ widget: new AddWidget(ins.text), side: 1 }).range(at));
  }
  // sort=true lets CodeMirror order marks/widgets correctly (avoids the
  // RangeSetBuilder "must be added sorted" pitfall).
  return Decoration.set(ranges, true);
}

const diffField = StateField.define<DecorationSet>({
  create() {
    return Decoration.none;
  },
  update(decorations, tr) {
    for (const effect of tr.effects) {
      if (effect.is(setPendingDiff)) {
        return effect.value ? buildDiffDecorations(effect.value, tr.state.doc.length) : Decoration.none;
      }
    }
    // Keep the overlay aligned if the user types while a diff is shown.
    if (tr.docChanged) return decorations.map(tr.changes);
    return decorations;
  },
  provide(field) {
    return EditorView.decorations.from(field);
  },
});

const diffTheme = EditorView.baseTheme({
  ".cm-diff-del": {
    textDecoration: "line-through",
    textDecorationColor: "#d1665a",
    color: "#c77a70",
    background: "rgba(209, 102, 90, 0.12)",
  },
  ".cm-diff-add": {
    display: "inline",
    whiteSpace: "pre-wrap",
    background: "rgba(90, 180, 120, 0.22)",
    color: "#153",
    borderRadius: "2px",
    boxShadow: "inset 2px 0 0 #4a9d6b",
  },
});

export const inlineDiffExtension: Extension = [diffField, diffTheme];
