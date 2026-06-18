import { describe, it, expect } from "vitest";
import { buildFillGapsRewritePrompt, buildMetricRewritePrompt, normalizeReportCard } from "./scriptReportCardService";

const report = normalizeReportCard({});
const shortScript = Array.from({ length: 100 }, (_, i) => `Line ${i}`).join("\n"); // ~2 pages
const longScript = Array.from({ length: 23 * 56 }, (_, i) => `Line ${i}`).join("\n"); // ~23 pages

describe("expansion directive", () => {
  it("Complete-To-Target-Pages demands a quantified major expansion when under target", () => {
    const p = buildFillGapsRewritePrompt({
      script: shortScript, knowledgeBase: null, styleProfile: null,
      targetPages: 23, reportCard: report, mode: "target_pages",
    });
    expect(p.user).toContain("EXPANSION REQUIREMENT");
    expect(p.user).toContain("23 page");
    expect(p.user).toMatch(/MUST grow the draft/i);
    // The old under-deliver escape hatch must be gone.
    expect(p.user).not.toContain("partial expansion");
    expect(p.maxTokens).toBeGreaterThanOrEqual(16000);
  });

  it("omits the expansion directive when the draft is already at target", () => {
    const p = buildFillGapsRewritePrompt({
      script: longScript, knowledgeBase: null, styleProfile: null,
      targetPages: 23, reportCard: report, mode: "target_pages",
    });
    expect(p.user).not.toContain("EXPANSION REQUIREMENT");
  });

  it("metric rewrite also injects the expansion requirement when under target", () => {
    const p = buildMetricRewritePrompt({
      script: shortScript, knowledgeBase: null, styleProfile: null,
      targetPages: 23, reportCard: report,
      metricId: "dan-harmon-story-circle", metricName: "Dan Harmon Story Circle",
    });
    expect(p.user).toContain("EXPANSION REQUIREMENT");
    expect(p.user).toContain("23 page");
  });
});
