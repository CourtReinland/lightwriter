import { describe, it, expect, beforeEach } from "vitest";
import { normalizeReportCard, buildScriptReportCardPrompt, aggregateReportCards, runScriptReportCard } from "./scriptReportCardService";
import { ALL_FRAMEWORKS } from "../frameworks";

function installLocalStorage() {
  const store = new Map<string, string>();
  (globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
    clear: () => store.clear(),
  };
}

const DH = "dan-harmon-story-circle";
const fwBeats = (id: string) => ALL_FRAMEWORKS.find((f) => f.id === id)!.beats;
const fwName = (id: string) => ALL_FRAMEWORKS.find((f) => f.id === id)!.name;

// A framework score block whose canonical beats each take a score from `pattern`
// (cycled). Beats carry their real canonical names so the by-name canonicalizer
// matches them.
function fwBlock(id: string, pattern: number[], missing?: boolean) {
  return {
    frameworkId: id,
    frameworkName: fwName(id),
    score: 0,
    summary: "s",
    beatScores: fwBeats(id).map((b, i) => ({ beatName: b.name, score: pattern[i % pattern.length], missing })),
  };
}

describe("stabilized scoring", () => {
  it("derives the framework score from the per-beat average of canonical beats", () => {
    const card = normalizeReportCard({ frameworkScores: [fwBlock(DH, [60])] } as never);
    expect(card.frameworkScores.find((f) => f.frameworkId === DH)?.score).toBe(60); // all beats 60 -> 60
  });

  it("falls back to the holistic score when no beats are supplied", () => {
    const card = normalizeReportCard({
      frameworkScores: [{ frameworkId: "save-the-cat", frameworkName: "Save the Cat", score: 47, summary: "x", beatScores: [] }],
    } as never);
    expect(card.frameworkScores.find((f) => f.frameworkId === "save-the-cat")?.score).toBe(47);
  });

  it("keeps only the beats the model returned, in canonical order (omitted beats are dropped, not zero-filled)", () => {
    const beats = fwBeats(DH);
    const first = beats[0].name;
    const second = beats[1].name;
    // Supply two beats OUT of canonical order; the rest are omitted.
    const card = normalizeReportCard({
      frameworkScores: [{ frameworkId: DH, frameworkName: fwName(DH), score: 0, summary: "s", beatScores: [{ beatName: second, score: 60 }, { beatName: first, score: 80 }] }],
    } as never);
    const dh = card.frameworkScores.find((f) => f.frameworkId === DH)!;
    expect(dh.beatScores.map((b) => b.beatName)).toEqual([first, second]); // re-sorted to canonical order
    expect(dh.beatScores.length).toBe(2); // omitted beats dropped, not zero-filled
    expect(dh.score).toBe(70); // mean(80, 60) — not dragged down by phantom zeros
  });

  it("medians a partially-omitted beat over only the samples that returned it (no zero-fill drag)", () => {
    const beats = fwBeats(DH);
    const full = (score: number) => normalizeReportCard({
      frameworkScores: [{ frameworkId: DH, frameworkName: fwName(DH), score: 0, summary: "s", beatScores: beats.map((b) => ({ beatName: b.name, score })) }],
    } as never);
    // A sample that OMITS the second beat entirely (returns all but beats[1]).
    const omitsSecond = normalizeReportCard({
      frameworkScores: [{ frameworkId: DH, frameworkName: fwName(DH), score: 0, summary: "s", beatScores: beats.filter((_, i) => i !== 1).map((b) => ({ beatName: b.name, score: 80 })) }],
    } as never);
    const agg = aggregateReportCards([full(80), full(80), omitsSecond]);
    const dh = agg.frameworkScores.find((f) => f.frameworkId === DH)!;
    // beats[1] was returned by 2 of 3 samples (both 80) -> median 80, NOT dragged to 0 by the omission.
    expect(dh.beatScores.find((b) => b.beatName === beats[1].name)?.score).toBe(80);
    expect(dh.score).toBe(80);
  });

  it("scores at temperature 0 for determinism", () => {
    const p = buildScriptReportCardPrompt({ script: "INT. X - DAY\n\nAction.", knowledgeBase: null, styleProfile: null, targetPages: 5 });
    expect(p.temperature).toBe(0);
  });

  it("computes overallScore as a deterministic rollup, not the model's holistic guess", () => {
    const card = normalizeReportCard({
      overallScore: 65, // must be IGNORED
      frameworkScores: [fwBlock(DH, [85]), fwBlock("propps-functions", [30])],
      styleScore: { score: 80 },
      characterScore: { score: 80 },
      pacingScore: { score: 80 },
    } as never);
    // best framework 85, craft avg 80 -> round(0.7*85 + 0.3*80) = 84
    expect(card.overallScore).toBe(84);
  });

  it("includes the two-axis rubric with the anti-inflation clause and forces exact beats", () => {
    const p = buildScriptReportCardPrompt({ script: "INT. X - DAY\n\nAction.", knowledgeBase: null, styleProfile: null, targetPages: 5 });
    expect(p.user).toMatch(/BEAT SCORING RUBRIC/);
    expect(p.user).toMatch(/do NOT award 78\+ for mere presence/i);
    expect(p.user).toMatch(/EXACTLY the beats listed/i);
  });

  it("only prompts the requested framework subset when scoped", () => {
    const dhDef = ALL_FRAMEWORKS.find((f) => f.id === DH)!;
    const p = buildScriptReportCardPrompt({ script: "INT. X - DAY\n\nAction.", knowledgeBase: null, styleProfile: null, targetPages: 5, frameworks: [dhDef] });
    expect(p.user).toMatch(/Dan Harmon/);
    expect(p.user).not.toMatch(/Propp/); // other frameworks excluded
  });
});

describe("scorer stabilization (name-aligned median-of-N)", () => {
  const dhCard = (pattern: number[], craft = 80) =>
    normalizeReportCard({
      frameworkScores: [fwBlock(DH, pattern)],
      styleScore: { score: craft },
      characterScore: { score: craft },
      pacingScore: { score: craft },
    } as never);

  it("medians each beat across samples so one outlier pass can't swing the framework", () => {
    const agg = aggregateReportCards([dhCard([80]), dhCard([82]), dhCard([30])]); // last is a low outlier
    const dh = agg.frameworkScores.find((f) => f.frameworkId === DH);
    expect(dh?.score).toBe(80); // per-beat median(80,82,30)=80 -> framework 80, outlier suppressed
    expect(agg.overallScore).toBe(80); // round(0.7*80 + 0.3*80) = 80
  });

  it("aligns beats by NAME even when a sample reorders them (the 42->19 bug)", () => {
    const beats = fwBeats(DH);
    const steady = dhCard([80]);
    const reversed = normalizeReportCard({
      frameworkScores: [{
        frameworkId: DH, frameworkName: fwName(DH), score: 0, summary: "s",
        beatScores: [...beats].reverse().map((b) => ({ beatName: b.name, score: 20 })),
      }],
    } as never);
    const agg = aggregateReportCards([steady, steady, reversed]);
    // Each beat: median(80, 80, 20) = 80 regardless of the reversed sample's order.
    expect(agg.frameworkScores.find((f) => f.frameworkId === DH)?.score).toBe(80);
  });

  it("falls back to the median framework score (never 0) when no sample returned beats", () => {
    const holistic = (score: number) => normalizeReportCard({
      frameworkScores: [{ frameworkId: "propps-functions", frameworkName: "Propp's Functions", score, summary: "s", beatScores: [] }],
    } as never);
    const agg = aggregateReportCards([holistic(30), holistic(34), holistic(32)]);
    expect(agg.frameworkScores.find((f) => f.frameworkId === "propps-functions")?.score).toBe(32);
  });

  it("runs N samples concurrently; one call when samples=1", async () => {
    const sample = JSON.stringify({ frameworkScores: [fwBlock(DH, [50])] });
    let calls = 0;
    await runScriptReportCard(
      { script: "INT. X - DAY\n\nAction.", knowledgeBase: null, styleProfile: null, targetPages: 5 },
      { samples: 3, completeOverride: async () => { calls++; return sample; } },
    );
    expect(calls).toBe(3);

    let singleCalls = 0;
    await runScriptReportCard(
      { script: "INT. X - DAY\n\nAction.", knowledgeBase: null, styleProfile: null, targetPages: 5 },
      { samples: 1, completeOverride: async () => { singleCalls++; return sample; } },
    );
    expect(singleCalls).toBe(1);
  });
});

describe("report card cache (same text -> same score, persists)", () => {
  beforeEach(() => installLocalStorage());

  it("returns the identical cached card on a re-run without re-calling the model", async () => {
    const sample = JSON.stringify({ frameworkScores: [fwBlock(DH, [70])] });
    let calls = 0;
    const input = { script: "INT. X - DAY\n\nAction.", knowledgeBase: null, styleProfile: null, targetPages: 5 };
    const opts = { samples: 3, completeOverride: async () => { calls++; return sample; }, cache: { projectId: "p1" } };

    const first = await runScriptReportCard(input, opts);
    const afterFirst = calls;
    const second = await runScriptReportCard(input, opts);

    expect(calls).toBe(afterFirst); // cache hit — no further model calls
    expect(second).toEqual(first); // byte-identical card
  });

  it("force bypasses the cache and recomputes", async () => {
    const sample = JSON.stringify({ frameworkScores: [fwBlock(DH, [70])] });
    let calls = 0;
    const input = { script: "INT. X - DAY\n\nAction.", knowledgeBase: null, styleProfile: null, targetPages: 5 };
    const base = { samples: 3, completeOverride: async () => { calls++; return sample; } };

    await runScriptReportCard(input, { ...base, cache: { projectId: "p1" } });
    const afterFirst = calls;
    await runScriptReportCard(input, { ...base, cache: { projectId: "p1", force: true } });
    expect(calls).toBeGreaterThan(afterFirst); // forced recompute
  });
});
