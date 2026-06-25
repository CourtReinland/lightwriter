import { describe, it, expect } from "vitest";
import {
  appendOpen,
  appendEdit,
  appendAiCommit,
  pruneSnapshots,
  MAX_SNAPSHOTS,
  type VersionSnapshot,
} from "./versionHistoryService";

let seq = 0;
const id = () => `id_${++seq}`;

describe("versionHistory snapshot logic", () => {
  it("starts history with a single open snapshot", () => {
    const h = appendOpen("ORIGINAL", "Imported", 1, id());
    expect(h).toHaveLength(1);
    expect(h[0].type).toBe("open");
    expect(h[0].label).toBe("Imported");
    expect(h[0].content).toBe("ORIGINAL");
  });

  it("appends a new edit when the tail is an open snapshot", () => {
    const open = appendOpen("ORIGINAL", "Opened", 1, id());
    const next = appendEdit(open, "ORIGINAL typing", false, 2, id());
    expect(next).not.toBeNull();
    expect(next!).toHaveLength(2);
    expect(next![1].type).toBe("edit");
    expect(next![1].content).toBe("ORIGINAL typing");
  });

  it("collapses consecutive typing into the same edit entry", () => {
    const open = appendOpen("A", "Opened", 1, id());
    const e1 = appendEdit(open, "AB", false, 2, id())!;
    const e2 = appendEdit(e1, "ABC", false, 3, id())!;
    const e3 = appendEdit(e2, "ABCD", false, 4, id())!;
    // open + one collapsed edit (NOT one entry per keystroke)
    expect(e3).toHaveLength(2);
    expect(e3[1].content).toBe("ABCD");
    expect(e3[1].id).toBe(e1[1].id); // same edit entry, updated in place
  });

  it("no-ops when content matches the tail (dedup)", () => {
    const open = appendOpen("A", "Opened", 1, id());
    const e1 = appendEdit(open, "AB", false, 2, id())!;
    const same = appendEdit(e1, "AB", false, 3, id());
    expect(same).toBeNull();
  });

  it("seals an AI commit as a new immutable entry", () => {
    const open = appendOpen("A", "Opened", 1, id());
    const e1 = appendEdit(open, "A typed", false, 2, id())!;
    const ai = appendAiCommit(e1, "A typed + scenes", "Scene descriptions", 3, id());
    expect(ai).toHaveLength(3);
    expect(ai[2].type).toBe("ai");
    expect(ai[2].label).toBe("Scene descriptions");
    expect(ai[2].content).toBe("A typed + scenes");
  });

  it("starts a fresh edit after an AI commit (does not mutate the AI snapshot)", () => {
    const open = appendOpen("A", "Opened", 1, id());
    const ai = appendAiCommit(open, "A+ai", "Clean up", 2, id());
    const afterTyping = appendEdit(ai, "A+ai+typed", false, 3, id())!;
    expect(afterTyping).toHaveLength(3);
    expect(afterTyping[1].type).toBe("ai"); // AI snapshot preserved untouched
    expect(afterTyping[1].content).toBe("A+ai");
    expect(afterTyping[2].type).toBe("edit");
    expect(afterTyping[2].content).toBe("A+ai+typed");
  });

  it("the dedup no-op fires for the autosave right after an AI commit", () => {
    // Simulates: recordAiCommit(text) then the debounced autosave recordEdit(text).
    const open = appendOpen("A", "Opened", 1, id());
    const ai = appendAiCommit(open, "TEXT", "Fix shot lines", 2, id());
    const autosave = appendEdit(ai, "TEXT", false, 3, id());
    expect(autosave).toBeNull();
  });

  it("forceNew appends a fresh edit instead of collapsing (restore-then-edit)", () => {
    const open = appendOpen("A", "Opened", 1, id());
    const e1 = appendEdit(open, "latest edit", false, 2, id())!;
    // After restoring an older version, the next edit must NOT overwrite e1.
    const forced = appendEdit(e1, "edited from restored state", true, 3, id())!;
    expect(forced).toHaveLength(3);
    expect(forced[1].content).toBe("latest edit"); // preserved
    expect(forced[2].content).toBe("edited from restored state");
  });

  it("prunes to MAX_SNAPSHOTS while always keeping the first entry", () => {
    let h: VersionSnapshot[] = appendOpen("ORIGIN", "Opened", 0, id());
    for (let i = 0; i < MAX_SNAPSHOTS + 20; i++) {
      h = appendAiCommit(h, `c${i}`, `commit ${i}`, i + 1, id());
    }
    expect(h.length).toBe(MAX_SNAPSHOTS);
    expect(h[0].content).toBe("ORIGIN"); // the open snapshot is never pruned
    expect(h[h.length - 1].content).toBe(`c${MAX_SNAPSHOTS + 19}`);
  });

  it("pruneSnapshots is a no-op below the cap", () => {
    const h = appendAiCommit(appendOpen("a", "Opened", 1, id()), "b", "x", 2, id());
    expect(pruneSnapshots(h)).toBe(h);
  });
});
