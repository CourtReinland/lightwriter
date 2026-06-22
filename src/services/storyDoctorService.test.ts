import { describe, it, expect } from "vitest";
import { runStoryDoctor, isFrameworkMetric } from "./storyDoctorService";
import { normalizeReportCard, type ScriptReportCard } from "./scriptReportCardService";

function reportWithScore(metricId: string, score: number): ScriptReportCard {
  const base = normalizeReportCard({});
  base.frameworkScores = base.frameworkScores.map((f) => (f.frameworkId === metricId ? { ...f, score } : f));
  return base;
}

describe("isFrameworkMetric", () => {
  it("recognizes framework ids vs craft metrics", () => {
    expect(isFrameworkMetric("dan-harmon-story-circle")).toBe(true);
    expect(isFrameworkMetric("save-the-cat")).toBe(true);
    expect(isFrameworkMetric("style")).toBe(false);
    expect(isFrameworkMetric("pacing")).toBe(false);
  });
});

describe("runStoryDoctor", () => {
  it("iterates, keeps the best draft, and reports the score trajectory", async () => {
    const metricId = "dan-harmon-story-circle";
    const scores = [50, 80];
    let pass = 0;
    let scoreCall = 0;
    const mockComplete = async () => {
      pass++;
      return JSON.stringify({ rewrittenScript: `REVISED v${pass}\n\nINT. X - DAY\n\nAction.`, changeSummary: [`cut dupes v${pass}`], warnings: [] });
    };
    const mockScore = async () => reportWithScore(metricId, scores[scoreCall++] ?? 80);

    const res = await runStoryDoctor(
      { script: "ORIGINAL", metricId, metricName: "Dan Harmon Story Circle", targetPages: 23, reportCard: reportWithScore(metricId, 32), knowledgeBase: null, styleProfile: null },
      undefined,
      mockComplete,
      mockScore,
    );

    expect(res.startScore).toBe(32);
    expect(res.finalScore).toBe(80);
    expect(res.trajectory).toEqual([32, 50, 80]);
    expect(res.rewrittenScript).toContain("v2"); // best-scoring draft is kept
    expect(res.changeSummary[0]).toMatch(/Story Doctor.*32 -> 80/);
  });

  it("stops once the target score is reached", async () => {
    const metricId = "save-the-cat";
    const mockComplete = async () => JSON.stringify({ rewrittenScript: "REVISED\n\nINT. X - DAY\n\nA.", changeSummary: [], warnings: [] });
    const mockScore = async () => reportWithScore(metricId, 85);

    const res = await runStoryDoctor(
      { script: "ORIGINAL", metricId, metricName: "Save the Cat", targetPages: 10, reportCard: reportWithScore(metricId, 40), knowledgeBase: null, styleProfile: null },
      undefined,
      mockComplete,
      mockScore,
    );

    expect(res.finalScore).toBe(85);
    expect(res.iterations).toBe(1);
  });

  it("does not stop at 79 but does stop once it clears the 80 target", async () => {
    const metricId = "dan-harmon-story-circle";
    const scores = [79, 81];
    let scoreCall = 0;
    const mockComplete = async () => JSON.stringify({ rewrittenScript: `REVISED ${scoreCall}\n\nINT. X - DAY\n\nA.`, changeSummary: [], warnings: [] });
    const mockScore = async () => reportWithScore(metricId, scores[scoreCall++] ?? 81);

    const res = await runStoryDoctor(
      { script: "ORIGINAL", metricId, metricName: "Dan Harmon Story Circle", targetPages: 23, reportCard: reportWithScore(metricId, 40), knowledgeBase: null, styleProfile: null },
      undefined,
      mockComplete,
      mockScore,
    );

    expect(res.trajectory).toEqual([40, 79, 81]); // ran past 79
    expect(res.finalScore).toBe(81);
    expect(res.iterations).toBeGreaterThanOrEqual(2);
  });

  it("surfaces the strongest rewrite attempt (with a warning) when no pass beats the start", async () => {
    const metricId = "save-the-cat";
    const mockComplete = async () => JSON.stringify({ rewrittenScript: "WORSE\n\nINT. Y - DAY\n\nB.", changeSummary: ["restructured"], warnings: [] });
    const mockScore = async () => reportWithScore(metricId, 10); // always worse than start 40

    const res = await runStoryDoctor(
      { script: "ORIGINAL", metricId, metricName: "Save the Cat", targetPages: 10, reportCard: reportWithScore(metricId, 40), knowledgeBase: null, styleProfile: null },
      undefined,
      mockComplete,
      mockScore,
    );

    // Returns a real revision to review rather than the untouched original...
    expect(res.rewrittenScript).toContain("WORSE");
    expect(res.rewrittenScript).not.toBe("ORIGINAL");
    expect(res.finalScore).toBe(10); // honestly reports the attempt's score
    // ...and warns clearly that it did not beat the starting draft.
    expect(res.warnings.join(" ")).toMatch(/No pass beat your current/i);
  });

  it("prefers the deduped restructured draft on a tie", async () => {
    const metricId = "dan-harmon-story-circle";
    const mockComplete = async () => JSON.stringify({ rewrittenScript: "DEDUPED\n\nINT. X - DAY\n\nClean.", changeSummary: ["removed duplicates"], warnings: [] });
    const mockScore = async () => reportWithScore(metricId, 73); // exactly ties the start

    const res = await runStoryDoctor(
      { script: "ORIGINAL BLOATED", metricId, metricName: "Dan Harmon Story Circle", targetPages: 23, reportCard: reportWithScore(metricId, 73), knowledgeBase: null, styleProfile: null },
      undefined,
      mockComplete,
      mockScore,
    );

    expect(res.finalScore).toBe(73);
    expect(res.rewrittenScript).toContain("DEDUPED"); // cleaner draft kept despite the tie
  });

  it("expands the rewritten draft toward the page target with new scenes", async () => {
    const metricId = "dan-harmon-story-circle";
    const bigScene = "INT. NEW BEAT SCENE - DAY\n" + Array.from({ length: 300 }, (_, i) => `Action line ${i}.`).join("\n");
    // The same model handles both jobs; discriminate by the engine's system prompt.
    const mockComplete = async (system: string) =>
      /expansion engine/i.test(system)
        ? JSON.stringify({ scenes: [{ insert_after: "START", beat: "Take", fountain: bigScene }] })
        : JSON.stringify({ rewrittenScript: "INT. OPENING - DAY\n\nAliyah enters.", changeSummary: ["restructured"], warnings: [] });
    const mockScore = async () => reportWithScore(metricId, 70); // beats the start, so a real rewrite is kept

    const res = await runStoryDoctor(
      { script: "INT. OLD - DAY\n\nShort.", metricId, metricName: "Dan Harmon Story Circle", targetPages: 5, reportCard: reportWithScore(metricId, 40), knowledgeBase: null, styleProfile: null },
      undefined,
      mockComplete,
      mockScore,
    );

    // The loop's tiny restructured draft was grown to the page target.
    expect(res.rewrittenScript.split("\n").length).toBeGreaterThan(100);
    expect(res.rewrittenScript).toContain("INT. NEW BEAT SCENE - DAY");
    expect(res.changeSummary.join(" ")).toMatch(/Added scene/i);
  });
});
