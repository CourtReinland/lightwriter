import { describe, it, expect } from "vitest";
import { computeInlineDiff } from "./inlineDiffService";

describe("computeInlineDiff", () => {
  it("is empty for identical text", () => {
    const d = computeInlineDiff("A\nB\nC", "A\nB\nC");
    expect(d.empty).toBe(true);
    expect(d.deletions).toEqual([]);
    expect(d.insertions).toEqual([]);
  });

  it("marks a deleted line's text range (offsets into the before-text)", () => {
    const before = "A\nB\nC";
    const d = computeInlineDiff(before, "A\nC");
    // "B" is at offset 2..3
    expect(d.deletions).toEqual([{ from: 2, to: 3 }]);
    expect(before.slice(d.deletions[0].from, d.deletions[0].to)).toBe("B");
    expect(d.insertions).toEqual([]);
    expect(d.empty).toBe(false);
  });

  it("records an inserted line at the offset where it belongs", () => {
    const before = "A\nC";
    const d = computeInlineDiff(before, "A\nB\nC");
    // Insert "B" before line "C" (offset 2 in the before-text).
    expect(d.deletions).toEqual([]);
    expect(d.insertions).toEqual([{ at: 2, text: "B" }]);
  });

  it("handles a replacement as a deletion + an insertion in the same region", () => {
    const before = "A\nOLD\nC";
    const d = computeInlineDiff(before, "A\nNEW\nC");
    // "OLD" (offset 2..5) struck; "NEW" inserted at the following boundary (offset 6, start of "C").
    expect(d.deletions).toEqual([{ from: 2, to: 5 }]);
    expect(before.slice(2, 5)).toBe("OLD");
    expect(d.insertions.length).toBe(1);
    expect(d.insertions[0].text).toBe("NEW");
  });

  it("appends inserted text at end-of-document", () => {
    const before = "A\nB";
    const d = computeInlineDiff(before, "A\nB\nC");
    expect(d.insertions).toEqual([{ at: before.length, text: "C" }]);
  });
});
