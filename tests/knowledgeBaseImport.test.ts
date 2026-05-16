import { describe, expect, it } from "vitest";
import { KnowledgeBaseService, parsePlotThreadsFromTableText, type KnowledgeBase } from "../src/services/knowledgeBase";
import { inferStyleSampleKind } from "../src/services/styleProfile";

const emptyKb: KnowledgeBase = {
  projectId: "p1",
  characters: [],
  scenes: [],
  worldRules: [],
  plotThreads: [],
  toneStyle: { genre: "", mood: "", pacingNotes: "", targetStyle: "", styleNotes: "" },
  customNotes: [],
  updatedAt: 1,
};

describe("plot thread table import", () => {
  it("maps spreadsheet headers into KB plot threads", () => {
    const text = [
      "Thread\tStatus\tDescription\tNotes",
      "Missing locket\tForeshadowed\tA pendant keeps appearing before the reveal.\tPay off in act three.",
      "Sister betrayal\tresolved\tAliyah discovers the lie.",
    ].join("\n");

    const threads = parsePlotThreadsFromTableText(text);

    expect(threads).toEqual([
      {
        title: "Missing locket",
        status: "foreshadowed",
        description: "A pendant keeps appearing before the reveal. Notes: Pay off in act three.",
      },
      {
        title: "Sister betrayal",
        status: "resolved",
        description: "Aliyah discovers the lie.",
      },
    ]);
  });

  it("supports title/description rows without explicit headers", () => {
    const threads = parsePlotThreadsFromTableText("Dragon egg\tThe egg must hatch before dawn.\nEscape debt\tunresolved\tDebt collector follows them.");

    expect(threads[0]).toMatchObject({ title: "Dragon egg", status: "unresolved", description: "The egg must hatch before dawn." });
    expect(threads[1]).toMatchObject({ title: "Escape debt", status: "unresolved", description: "Debt collector follows them." });
  });

  it("merges imported threads without duplicating existing titles", () => {
    const kb = KnowledgeBaseService.mergePlotThreads(emptyKb, [
      { title: "Missing locket", status: "unresolved", description: "Already there." },
      { title: "New prophecy", status: "foreshadowed", description: "Seen in spreadsheet." },
    ]);
    const merged = KnowledgeBaseService.mergePlotThreads(kb, [
      { title: "missing locket", status: "resolved", description: "Duplicate should not overwrite." },
      { title: "Final choice", status: "unresolved", description: "New row." },
    ]);

    expect(merged.plotThreads.map((thread) => thread.title)).toEqual(["Missing locket", "New prophecy", "Final choice"]);
    expect(merged.plotThreads[0].description).toBe("Already there.");
  });
});

describe("style profile spreadsheet samples", () => {
  it("classifies Excel files as style sample input kinds", () => {
    expect(inferStyleSampleKind("voice-grid.xlsx")).toBe("xlsx");
    expect(inferStyleSampleKind("legacy-style.xls")).toBe("xls");
  });
});

