import { describe, it, expect } from "vitest";
import { computeLineDiff, collapseUnchanged, diffStats } from "./lineDiff";

describe("computeLineDiff", () => {
  it("marks added lines", () => {
    const diff = computeLineDiff("a\nb", "a\nNEW\nb");
    expect(diff).toEqual([
      { type: "same", text: "a" },
      { type: "add", text: "NEW" },
      { type: "same", text: "b" },
    ]);
    expect(diffStats(diff)).toEqual({ added: 1, removed: 0 });
  });

  it("marks removed lines", () => {
    const diff = computeLineDiff("a\nGONE\nb", "a\nb");
    expect(diff).toEqual([
      { type: "same", text: "a" },
      { type: "del", text: "GONE" },
      { type: "same", text: "b" },
    ]);
    expect(diffStats(diff)).toEqual({ added: 0, removed: 1 });
  });

  it("marks a changed line as del + add", () => {
    const diff = computeLineDiff("hello world", "hello there");
    expect(diffStats(diff)).toEqual({ added: 1, removed: 1 });
  });

  it("reports no changes for identical text", () => {
    const diff = computeLineDiff("a\nb\nc", "a\nb\nc");
    expect(diffStats(diff)).toEqual({ added: 0, removed: 0 });
  });
});

describe("collapseUnchanged", () => {
  it("collapses long unchanged runs but keeps context around changes", () => {
    const before = Array.from({ length: 20 }, (_, i) => `line${i}`).join("\n");
    const after = before + "\nADDED";
    const rows = collapseUnchanged(computeLineDiff(before, after));
    // Should contain a gap row and the added line.
    expect(rows.some((r) => r.type === "gap" && (r.hiddenCount ?? 0) > 0)).toBe(true);
    expect(rows.some((r) => r.type === "add" && r.text === "ADDED")).toBe(true);
  });

  it("keeps all lines when nothing is collapsible", () => {
    const rows = collapseUnchanged(computeLineDiff("a\nb", "a\nX\nb"));
    expect(rows.some((r) => r.type === "gap")).toBe(false);
    expect(rows.find((r) => r.type === "add")?.text).toBe("X");
  });
});
