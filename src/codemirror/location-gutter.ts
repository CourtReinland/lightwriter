import { gutter, GutterMarker } from "@codemirror/view";
import { StateField, StateEffect, RangeSet, RangeSetBuilder, type Extension } from "@codemirror/state";

// A left-margin gutter marker (◆) on scene-heading lines that resolve to a
// portable World-State location, so the writer can see at a glance which scenes
// are linked to a series location. Driven reactively: App computes a map of
// 1-based line number -> location name and dispatches setLocationGutter; mirrors
// the overlay-decorations StateField/effect pattern.

export const setLocationGutter = StateEffect.define<Map<number, string>>();

class LocationMarker extends GutterMarker {
  constructor(readonly name: string) {
    super();
  }
  eq(other: LocationMarker): boolean {
    return other.name === this.name;
  }
  toDOM(): HTMLElement {
    const el = document.createElement("span");
    el.className = "cm-loc-marker";
    el.textContent = "◆"; // ◆
    if (this.name) el.title = `Series scene: ${this.name}`;
    return el;
  }
}

const SPACER = new LocationMarker("");

const markerField = StateField.define<RangeSet<GutterMarker>>({
  create() {
    return RangeSet.empty;
  },
  update(set, tr) {
    for (const effect of tr.effects) {
      if (effect.is(setLocationGutter)) {
        const entries = [...effect.value.entries()].sort((a, b) => a[0] - b[0]);
        const builder = new RangeSetBuilder<GutterMarker>();
        for (const [lineNo, name] of entries) {
          if (lineNo >= 1 && lineNo <= tr.state.doc.lines) {
            const from = tr.state.doc.line(lineNo).from;
            builder.add(from, from, new LocationMarker(name));
          }
        }
        return builder.finish();
      }
    }
    if (tr.docChanged) return set.map(tr.changes);
    return set;
  },
});

export const locationGutter: Extension = [
  markerField,
  gutter({
    class: "cm-location-gutter",
    markers: (view) => view.state.field(markerField),
    initialSpacer: () => SPACER,
  }),
];
