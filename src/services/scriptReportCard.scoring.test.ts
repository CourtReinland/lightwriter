import { describe, it, expect } from "vitest";
import { normalizeReportCard, buildScriptReportCardPrompt, aggregateReportCards, runScriptReportCard } from "./scriptReportCardService";

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

describe("scorer stabilization (median-of-N sampling)", () => {
  const mkCard = (beats: number[], craft: number) =>
    normalizeReportCard({
      frameworkScores: [
        { frameworkId: "dan-harmon-story-circle", frameworkName: "Dan Harmon Story Circle", score: 0, summary: "s", beatScores: beats.map((score) => ({ score })) },
      ],
      styleScore: { score: craft },
      characterScore: { score: craft },
      pacingScore: { score: craft },
    } as never);

  it("medians each beat across samples so one outlier pass can't swing the framework", () => {
    // Two steady samples and one low outlier. Per-beat medians ignore the outlier.
    const agg = aggregateReportCards([
      mkCard([80, 40, 60], 80),
      mkCard([82, 38, 62], 80),
      mkCard([40, 42, 30], 80), // outlier — alone it would score the framework ~37
    ]);
    const dh = agg.frameworkScores.find((f) => f.frameworkId === "dan-harmon-story-circle");
    expect(dh?.beatScores.map((b) => b.score)).toEqual([80, 40, 60]); // per-beat medians
    expect(dh?.score).toBe(60); // round(mean(80,40,60)) — outlier suppressed, not averaged in
    expect(agg.overallScore).toBe(66); // deterministic rollup: round(0.7*60 + 0.3*80)
  });

  it("takes the majority vote on whether a beat is missing", () => {
    const withMissing = (missing: boolean) => normalizeReportCard({
      frameworkScores: [
        { frameworkId: "dan-harmon-story-circle", frameworkName: "Dan Harmon Story Circle", score: 0, summary: "s", beatScores: [{ score: 20, missing }] },
      ],
    } as never);
    const agg = aggregateReportCards([withMissing(true), withMissing(true), withMissing(false)]);
    const beat = agg.frameworkScores.find((f) => f.frameworkId === "dan-harmon-story-circle")?.beatScores[0];
    expect(beat?.missing).toBe(true); // 2 of 3 said missing
  });

  it("runs N samples concurrently and medians them; one call when samples=1", async () => {
    const sample = (beat: number) => JSON.stringify({
      frameworkScores: [{ frameworkId: "dan-harmon-story-circle", frameworkName: "Dan Harmon Story Circle", beatScores: [{ score: beat }, { score: beat }] }],
    });
    const responses = [sample(50), sample(52), sample(30)]; // last is a low outlier
    let calls = 0;
    const completeOverride = async () => responses[calls++];

    const card = await runScriptReportCard(
      { script: "INT. X - DAY\n\nAction.", knowledgeBase: null, styleProfile: null, targetPages: 5 },
      { samples: 3, completeOverride },
    );
    expect(calls).toBe(3);
    const dh = card.frameworkScores.find((f) => f.frameworkId === "dan-harmon-story-circle");
    expect(dh?.score).toBe(50); // median(50,52,30)=50 per beat -> framework 50, not dragged to ~44

    let singleCalls = 0;
    await runScriptReportCard(
      { script: "INT. X - DAY\n\nAction.", knowledgeBase: null, styleProfile: null, targetPages: 5 },
      { samples: 1, completeOverride: async () => { singleCalls++; return sample(70); } },
    );
    expect(singleCalls).toBe(1);
  });

  it("survives flaky samples — aggregates the ones that succeed", async () => {
    const ok = JSON.stringify({ frameworkScores: [{ frameworkId: "dan-harmon-story-circle", frameworkName: "Dan Harmon Story Circle", beatScores: [{ score: 60 }] }] });
    let calls = 0;
    const completeOverride = async () => {
      const i = calls++;
      if (i === 1) throw new Error("network blip");
      return ok;
    };
    const card = await runScriptReportCard(
      { script: "INT. X - DAY\n\nAction.", knowledgeBase: null, styleProfile: null, targetPages: 5 },
      { samples: 3, completeOverride },
    );
    expect(card.frameworkScores.find((f) => f.frameworkId === "dan-harmon-story-circle")?.score).toBe(60);
  });
});
