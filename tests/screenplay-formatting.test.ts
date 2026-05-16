import { describe, expect, it } from "vitest";
import { getAutoCapsChange } from "../src/codemirror/screenplay-formatting";

describe("getAutoCapsChange", () => {
  it("does not change a different line if the cursor moves before deferred auto-caps runs", () => {
    const change = getAutoCapsChange(
      { lineNumber: 1 },
      {
        lineNumber: 2,
        from: 18,
        to: 36,
        text: "aiden looks around",
        cursorPos: 36,
      },
    );

    expect(change).toBeNull();
  });

  it("uppercases the original scene line when the cursor is still at that line end", () => {
    const change = getAutoCapsChange(
      { lineNumber: 1 },
      {
        lineNumber: 1,
        from: 0,
        to: 16,
        text: "int. diner - day",
        cursorPos: 16,
      },
    );

    expect(change).toEqual({
      from: 0,
      to: 16,
      insert: "INT. DINER - DAY",
      selectionAnchor: 16,
    });
  });
});
