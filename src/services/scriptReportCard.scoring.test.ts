import { describe, it, expect } from "vitest";
import { normalizeReportCard, buildScriptReportCardPrompt } from "./scriptReportCardService";

describe("stabilized scoring", () => {
  it("derives the framework score from the per-beat average, not the holistic guess", () => {
    const card = normalizeReportCard({
      frameworkScores: [
        {
          frameworkId: "dan-harmon-story-circle",
          frameworkName: "Dan Harmon Story Circle",
          score: 90, // holistic value should be ignored
          summary: "x",
          beatScores: [{ score: 80 }, { score: 40 }, { score: 60 }],
        },
      ] as never,
    });
    const dh = card.frameworkScores.find((f) => f.frameworkId === "dan-harmon-story-circle");
    expect(dh?.score).toBe(60); // average(80,40,60)
  });

  it("falls back to the holistic score when no beats are supplied", () => {
    const card = normalizeReportCard({
      frameworkScores: [
        { frameworkId: "save-the-cat", frameworkName: "Save the Cat", score: 47, summary: "x", beatScores: [] },
      ] as never,
    });
    const stc = card.frameworkScores.find((f) => f.frameworkId === "save-the-cat");
    expect(stc?.score).toBe(47);
  });

  it("scores at temperature 0 for determinism", () => {
    const p = buildScriptReportCardPrompt({ script: "INT. X - DAY\n\nAction.", knowledgeBase: null, styleProfile: null, targetPages: 5 });
    expect(p.temperature).toBe(0);
  });
});
