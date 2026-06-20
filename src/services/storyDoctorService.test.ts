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

  it("never regresses below the starting draft if rewrites get worse", async () => {
    const metricId = "save-the-cat";
    const mockComplete = async () => JSON.stringify({ rewrittenScript: "WORSE\n\nINT. Y - DAY\n\nB.", changeSummary: [], warnings: [] });
    const mockScore = async () => reportWithScore(metricId, 10); // always worse than start 40

    const res = await runStoryDoctor(
      { script: "ORIGINAL", metricId, metricName: "Save the Cat", targetPages: 10, reportCard: reportWithScore(metricId, 40), knowledgeBase: null, styleProfile: null },
      undefined,
      mockComplete,
      mockScore,
    );

    expect(res.finalScore).toBe(40);
    expect(res.rewrittenScript).toBe("ORIGINAL"); // kept the better original
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
});
