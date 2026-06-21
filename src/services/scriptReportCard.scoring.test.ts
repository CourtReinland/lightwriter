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

  it("computes overallScore as a deterministic rollup, not the model's holistic guess", () => {
    const card = normalizeReportCard({
      overallScore: 65, // model holistic value — must be IGNORED
      frameworkScores: [
        { frameworkId: "dan-harmon-story-circle", frameworkName: "Dan Harmon Story Circle", score: 0, summary: "x", beatScores: [{ score: 85 }, { score: 85 }, { score: 85 }] }, // avg 85
        { frameworkId: "propps-functions", frameworkName: "Propp's Functions", score: 0, summary: "x", beatScores: [{ score: 30 }] }, // weak — must NOT drag overall down
      ],
      styleScore: { score: 80 },
      characterScore: { score: 80 },
      pacingScore: { score: 80 },
    } as never);
    // best framework 85, craft avg 80 -> round(0.7*85 + 0.3*80) = 84
    expect(card.overallScore).toBe(84);
  });

  it("flips the 80 gate only for genuinely strong drafts", () => {
    const mediocre = normalizeReportCard({
      frameworkScores: [{ frameworkId: "dan-harmon-story-circle", frameworkName: "Dan Harmon Story Circle", score: 0, summary: "x", beatScores: [{ score: 68 }] }],
      styleScore: { score: 60 }, characterScore: { score: 60 }, pacingScore: { score: 60 },
    } as never);
    expect(mediocre.overallScore).toBeLessThan(80); // round(0.7*68+0.3*60)=66

    const strong = normalizeReportCard({
      frameworkScores: [{ frameworkId: "dan-harmon-story-circle", frameworkName: "Dan Harmon Story Circle", score: 0, summary: "x", beatScores: [{ score: 88 }] }],
      styleScore: { score: 80 }, characterScore: { score: 80 }, pacingScore: { score: 80 },
    } as never);
    expect(strong.overallScore).toBeGreaterThanOrEqual(80); // round(0.7*88+0.3*80)=86
  });

  it("includes the two-axis rubric with the anti-inflation clause", () => {
    const p = buildScriptReportCardPrompt({ script: "INT. X - DAY\n\nAction.", knowledgeBase: null, styleProfile: null, targetPages: 5 });
    expect(p.user).toMatch(/BEAT SCORING RUBRIC/);
    expect(p.user).toMatch(/do NOT award 78\+ for mere presence/i);
  });
});
