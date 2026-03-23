import { StateField, StateEffect, type Extension, RangeSetBuilder } from "@codemirror/state";
import { Decoration, type DecorationSet, EditorView, WidgetType } from "@codemirror/view";
import type { ComputedBeat } from "../frameworks/utils";

export const setOverlayBeats = StateEffect.define<ComputedBeat[]>();

class BeatPillWidget extends WidgetType {
  constructor(readonly beat: ComputedBeat) {
    super();
  }

  toDOM(): HTMLElement {
    const wrapper = document.createElement("span");
    wrapper.className = "cm-beat-pill-wrapper";
    wrapper.style.cssText = `
      position: relative;
      display: inline-block;
      vertical-align: middle;
      margin-left: 4px;
    `;

    // The pill label
    const pill = document.createElement("span");
    pill.className = "cm-beat-pill";
    pill.style.cssText = `
      background: ${this.beat.color}22;
      border-left: 3px solid ${this.beat.color};
      color: ${this.beat.color};
      padding: 1px 8px;
      font-size: 10px;
      font-family: 'Courier Prime', monospace;
      border-radius: 0 3px 3px 0;
      white-space: nowrap;
      cursor: default;
    `;
    pill.textContent = this.beat.name;
    wrapper.appendChild(pill);

    // Rich tooltip on hover
    const tooltip = document.createElement("div");
    tooltip.className = "cm-beat-tooltip";
    tooltip.style.cssText = `
      display: none;
      position: absolute;
      left: 0;
      top: 100%;
      margin-top: 6px;
      z-index: 1000;
      background: #1a1a1a;
      border: 1px solid #444;
      border-radius: 6px;
      padding: 12px 14px;
      width: 320px;
      max-width: 90vw;
      font-family: 'Courier Prime', monospace;
      box-shadow: 0 8px 24px rgba(0,0,0,0.4);
      pointer-events: none;
    `;

    // Header: beat name + page range
    const header = document.createElement("div");
    header.style.cssText = `
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 8px;
    `;
    const title = document.createElement("span");
    title.style.cssText = `font-size: 12px; font-weight: bold; color: ${this.beat.color};`;
    title.textContent = this.beat.name;
    const pages = document.createElement("span");
    pages.style.cssText = `font-size: 9px; color: #888; background: #252525; padding: 2px 6px; border-radius: 3px;`;
    pages.textContent = `pp ${this.beat.startPage}–${this.beat.endPage}`;
    header.appendChild(title);
    header.appendChild(pages);
    tooltip.appendChild(header);

    // Description
    const desc = document.createElement("p");
    desc.style.cssText = `font-size: 11px; color: #bbb; line-height: 1.5; margin: 0 0 10px 0;`;
    desc.textContent = this.beat.description;
    tooltip.appendChild(desc);

    // Examples
    if (this.beat.examples && this.beat.examples.length > 0) {
      const exLabel = document.createElement("div");
      exLabel.style.cssText = `font-size: 9px; color: #666; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 4px;`;
      exLabel.textContent = "Examples";
      tooltip.appendChild(exLabel);

      const list = document.createElement("ul");
      list.style.cssText = `margin: 0; padding: 0 0 0 14px; font-size: 10px; color: #999; line-height: 1.6;`;
      for (const ex of this.beat.examples) {
        const li = document.createElement("li");
        li.style.cssText = `margin-bottom: 2px;`;
        li.textContent = ex;
        list.appendChild(li);
      }
      tooltip.appendChild(list);
    }

    // Framework name
    const framework = document.createElement("div");
    framework.style.cssText = `
      margin-top: 8px;
      padding-top: 6px;
      border-top: 1px solid #333;
      font-size: 9px;
      color: #555;
      text-transform: uppercase;
      letter-spacing: 0.5px;
    `;
    framework.textContent = this.beat.frameworkId.replace(/-/g, " ");
    tooltip.appendChild(framework);

    wrapper.appendChild(tooltip);

    // Show/hide on hover
    wrapper.addEventListener("mouseenter", () => {
      tooltip.style.display = "block";
    });
    wrapper.addEventListener("mouseleave", () => {
      tooltip.style.display = "none";
    });

    return wrapper;
  }

  ignoreEvent(): boolean {
    return false; // Allow mouse events for hover tooltips
  }
}

function buildDecorations(beats: ComputedBeat[], doc: { lines: number; line: (n: number) => { from: number; to: number } }): DecorationSet {
  if (beats.length === 0) return Decoration.none;

  const totalLines = doc.lines;

  // Collect line styles: merge multiple frameworks on the same line
  const lineStyles = new Map<number, string[]>(); // lineFrom -> [style strings]
  const widgets: { pos: number; widget: BeatPillWidget }[] = [];

  for (const beat of beats) {
    const startLine = Math.max(1, Math.min(beat.startLine + 1, totalLines));
    const endLine = Math.max(startLine, Math.min(beat.endLine + 1, totalLines));

    for (let line = startLine; line <= endLine && line <= totalLines; line++) {
      const lineFrom = doc.line(line).from;
      if (!lineStyles.has(lineFrom)) lineStyles.set(lineFrom, []);
      lineStyles.get(lineFrom)!.push(`${beat.color}40`);
    }

    // Widget pill at start of beat
    if (startLine <= totalLines) {
      const lineInfo = doc.line(startLine);
      widgets.push({ pos: lineInfo.to, widget: new BeatPillWidget(beat) });
    }
  }

  // Build decorations sorted by position
  const builder = new RangeSetBuilder<Decoration>();

  // Collect all positions and types
  const entries: { pos: number; type: "line" | "widget"; lineFrom?: number; style?: string; widget?: BeatPillWidget }[] = [];

  for (const [lineFrom, colors] of lineStyles) {
    // Merge: use first color for box-shadow, slight background tint
    const shadows = colors.map((c, i) => `inset ${3 + i * 3}px 0 0 ${c}`).join(", ");
    entries.push({
      pos: lineFrom,
      type: "line",
      lineFrom,
      style: `box-shadow: ${shadows}; background: ${colors[0].replace("40", "08")};`,
    });
  }

  for (const w of widgets) {
    entries.push({ pos: w.pos, type: "widget", widget: w.widget });
  }

  // Sort: line decorations first (they use from=from), then widgets
  // Line decorations: sorted by pos. Widgets: sorted by pos, after lines at same pos.
  entries.sort((a, b) => {
    if (a.pos !== b.pos) return a.pos - b.pos;
    // Line decorations before widgets at same position
    if (a.type === "line" && b.type === "widget") return -1;
    if (a.type === "widget" && b.type === "line") return 1;
    return 0;
  });

  for (const entry of entries) {
    if (entry.type === "line") {
      builder.add(
        entry.pos,
        entry.pos,
        Decoration.line({ attributes: { style: entry.style! } }),
      );
    } else {
      builder.add(
        entry.pos,
        entry.pos,
        Decoration.widget({ widget: entry.widget!, side: 1 }),
      );
    }
  }

  return builder.finish();
}

const overlayField = StateField.define<DecorationSet>({
  create() {
    return Decoration.none;
  },

  update(decorations, tr) {
    for (const effect of tr.effects) {
      if (effect.is(setOverlayBeats)) {
        return buildDecorations(effect.value, tr.state.doc);
      }
    }

    if (tr.docChanged) {
      return decorations.map(tr.changes);
    }
    return decorations;
  },

  provide(field) {
    return EditorView.decorations.from(field);
  },
});

export const overlayExtension: Extension = [overlayField];
