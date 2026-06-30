import { describe, expect, it } from "vitest";
import {
  buildScriptReportCardPrompt,
  buildMetricRewritePrompt,
  buildFillGapsRewritePrompt,
  normalizeReportCard,
  parseRewriteResponse,
  parseReportCardResponse,
  validateRewriteScript,
  summarizeRewriteDiff,
  compareReportCards,
  type ScriptReportCard,
} from "../src/services/scriptReportCardService";
import { ALL_FRAMEWORKS } from "../src/frameworks";
import type { KnowledgeBase } from "../src/services/knowledgeBase";
import type { StyleProfile } from "../src/services/styleProfile";

const kb: KnowledgeBase = {
  projectId: "p1",
  characters: [{ id: "c1", name: "ALIYAH", description: "protective sister", traits: ["protective"], voiceNotes: "spare, suspicious", relationships: [] }],
  scenes: [],
  worldRules: [],
  plotThreads: [],
  toneStyle: {
    genre: "middle-grade fantasy",
    mood: "wonder and dread",
    pacingNotes: "Slow mystery build, then warm emotional payoff.",
    targetStyle: "Pixar emotional clarity with Kubrick-like restraint",
    styleNotes: "Keep dialogue spare and character-specific.",
  },
  customNotes: [],
  updatedAt: 1,
};

const styleProfile: StyleProfile = {
  projectId: "p1",
  avgSentenceLength: 7,
  sentenceLengthVariance: "medium",
  vocabularyComplexity: "plain but lyrical",
  predominantTone: "tender, uncanny",
  pov: "objective screenplay",
  tense: "present",
  dialogueToActionRatio: "balanced",
  sampleExcerpts: ["Aiden smiles like he's apologizing to the air."],
  rawAnalysis: "Quiet emotional action lines.",
  updatedAt: 1,
  styleContract: "Use short, image-led action lines and subtext-heavy dialogue.",
  doRules: ["Let silence carry feeling"],
  avoidRules: ["Do not over-explain theme"],
};

const reportCard: ScriptReportCard = {
  overallScore: 61,
  frameworkScores: [{
    frameworkId: "save-the-cat",
    frameworkName: "Save the Cat",
    score: 42,
    summary: "The midpoint and bad-guys-close-in sections are thin.",
    beatScores: [
      { beatName: "Midpoint", expectedPageRange: "pages 45-45", detectedEvidence: "", score: 20, missing: true, suggestions: ["Add a false victory around the book's first major magic reveal."] },
    ],
  }],
  styleScore: { score: 82, matchedTraits: ["short action lines"], drift: [], suggestions: [] },
  characterScore: { score: 70, summary: "Aliyah voice is clear", suggestions: ["Give Aiden a stronger want."] },
  pacingScore: { score: 50, summary: "Act 2 is underdeveloped", suggestions: ["Add reversals before the climax."] },
  topFixes: ["Add a true midpoint reversal"],
  recommendedNextAction: "Improve against Save the Cat.",
};

describe("script report card prompt", () => {
  it("builds a whole-script report prompt with all frameworks, style, KB, and target pages", () => {
    const prompt = buildScriptReportCardPrompt({
      script: "INT. LIBRARY - NIGHT\n\nALIYAH finds a glowing book.",
      knowledgeBase: kb,
      styleProfile,
      targetPages: 90,
    });

    expect(prompt.system).toContain("Return ONLY valid JSON");
    expect(prompt.user).toContain("Save the Cat");
    expect(prompt.user).toContain("Hero's Journey");
    expect(prompt.user).toContain("Propp");
    expect(prompt.user).toContain("Aristotle");
    expect(prompt.user).toContain("Dan Harmon");
    expect(prompt.user).toContain("Target pages: 90");
    expect(prompt.user).toContain("STYLE CONTRACT");
    expect(prompt.user).toContain("Use short, image-led action lines");
    expect(prompt.user).toContain("Pixar emotional clarity");
    expect(prompt.maxTokens).toBeGreaterThan(3000);
  });
});

describe("script report card parsing", () => {
  it("parses fenced JSON and normalizes framework, beat, and style scores", () => {
    const response = [
      "Here is the report:",
      "",
      "```json",
      JSON.stringify({
        overallScore: 81,
        frameworkScores: [{
          frameworkId: "save-the-cat",
          frameworkName: "Save the Cat",
          score: 72,
          summary: "Strong setup, weak midpoint.",
          // Full canonical beat ladder (the scorer now canonicalizes by name and
          // averages over ALL of a framework's beats), every beat at 43.
          beatScores: ALL_FRAMEWORKS.find((f) => f.id === "save-the-cat")!.beats.map((b) => ({
            beatName: b.name, score: 43, detectedEvidence: b.name === "Midpoint" ? "book opens" : "", missing: false, suggestions: ["Raise the stakes."],
          })),
        }],
        styleScore: { score: 88, matchedTraits: ["short action lines"], drift: ["generic jokes"], suggestions: ["tighten dialogue"] },
        characterScore: { score: 76, summary: "Aliyah is clear", suggestions: [] },
        pacingScore: { score: 69, summary: "Act 2 thin", suggestions: ["add reversals"] },
        topFixes: ["Strengthen midpoint"],
        recommendedNextAction: "Improve against Save the Cat midpoint.",
      }),
      "```",
    ].join("\n");
    const parsed = parseReportCardResponse(response, "save-the-cat");

    // overallScore is now a deterministic rollup (0.7*best-framework + 0.3*craft-avg),
    // not the model's holistic 81. Best framework = Save the Cat beat-avg 43; craft avg
    // = round((88+76+69)/3)=78 -> round(0.7*43 + 0.3*78) = 54.
    expect(parsed.overallScore).toBe(54);
    const saveTheCat = parsed.frameworkScores.find((score) => score.frameworkId === "save-the-cat");
    // Framework score is now derived from the beat-score average (a single beat
    // at 43 here), not the model's separate holistic guess (72).
    expect(saveTheCat?.score).toBe(43);
    expect(saveTheCat?.beatScores[0].score).toBe(43);
    expect(parsed.styleScore.score).toBe(88);
    expect(parsed.topFixes).toContain("Strengthen midpoint");
  });

  it("fills missing framework rows so the UI always has a complete report card", () => {
    const partial: ScriptReportCard = {
      overallScore: 0,
      frameworkScores: [],
      styleScore: { score: 0, matchedTraits: [], drift: [], suggestions: [] },
      characterScore: { score: 0, summary: "", suggestions: [] },
      pacingScore: { score: 0, summary: "", suggestions: [] },
      topFixes: [],
      recommendedNextAction: "",
    };

    const normalized = normalizeReportCard(partial);

    expect(normalized.frameworkScores.map((f) => f.frameworkId)).toEqual([
      "heros-journey",
      "save-the-cat",
      "propps-functions",
      "three-act",
      "dan-harmon-story-circle",
    ]);
    expect(normalized.overallScore).toBe(0);
  });
});

describe("script rewrite execution prompts", () => {
  it("builds a metric rewrite prompt that asks for a full revised Fountain script and preserves voice", () => {
    const prompt = buildMetricRewritePrompt({
      script: "INT. LIBRARY - NIGHT\n\nALIYAH finds a glowing book.",
      knowledgeBase: kb,
      styleProfile,
      targetPages: 90,
      reportCard,
      metricId: "save-the-cat",
      metricName: "Save the Cat",
    });

    expect(prompt.system).toContain("Return ONLY valid JSON");
    expect(prompt.user).toContain("SELECTED REWRITE METRIC: Save the Cat");
    expect(prompt.user).toContain("Return the complete revised script");
    expect(prompt.user).toContain("rewrittenScript");
    expect(prompt.user).toContain("STYLE CONTRACT");
    expect(prompt.user).toContain("Add a false victory");
    // G3: targeting a framework injects its beat ladder as an explicit structural guardrail.
    expect(prompt.user).toContain("TARGET STRUCTURE");
    expect(prompt.user).toContain("refine the draft toward Save the Cat");
    expect(prompt.user).toContain("Opening Image");
  });

  it("builds a fill-gaps prompt focused on missing beats and target page completion", () => {
    const prompt = buildFillGapsRewritePrompt({
      script: "INT. LIBRARY - NIGHT\n\nALIYAH finds a glowing book.",
      knowledgeBase: kb,
      styleProfile,
      targetPages: 120,
      reportCard,
      mode: "target_pages",
    });

    expect(prompt.user).toContain("FILL GAPS / COMPLETE TO TARGET PAGES");
    expect(prompt.user).toContain("Target pages: 120");
    expect(prompt.user).toContain("missing beats");
    expect(prompt.user).toContain("rewrittenScript");
    // No target framework supplied -> broad gap fill, no single-framework structure block.
    expect(prompt.user).not.toContain("TARGET STRUCTURE");
  });

  it("focuses fill-gaps on a single framework's beat ladder when targetFrameworkId is supplied", () => {
    const prompt = buildFillGapsRewritePrompt({
      script: "INT. LIBRARY - NIGHT\n\nALIYAH finds a glowing book.",
      knowledgeBase: kb,
      styleProfile,
      targetPages: 120,
      reportCard,
      mode: "missing_beats",
      targetFrameworkId: "heros-journey",
    });

    expect(prompt.user).toContain("TARGET STRUCTURE");
    expect(prompt.user).toContain("refine the draft toward Hero's Journey");
    expect(prompt.user).toContain("do not reshape the draft to satisfy other frameworks");
  });

  it("parses rewrite JSON and strips fenced output", () => {
    const parsed = parseRewriteResponse("```json\n{\"rewrittenScript\":\"INT. LIBRARY - NIGHT\\n\\nALIYAH opens the book.\",\"changeSummary\":[\"Added midpoint\"],\"warnings\":[]}\n```");

    expect(parsed.rewrittenScript).toContain("ALIYAH opens the book");
    expect(parsed.changeSummary).toEqual(["Added midpoint"]);
    expect(parsed.warnings).toEqual([]);
  });

  it("repairs common provider field names before failing the rewrite contract", () => {
    const parsed = parseRewriteResponse(JSON.stringify({
      revisedScript: "INT. LIBRARY - NIGHT\n\nALIYAH opens the glowing book.",
      summary: ["Used revisedScript fallback."],
    }));

    expect(parsed.rewrittenScript).toContain("glowing book");
    expect(parsed.changeSummary).toEqual(["Used revisedScript fallback."]);
    expect(parsed.warnings.join(" ")).toContain("revisedScript");
  });

  it("recovers plain screenplay text and warns that JSON was repaired", () => {
    const parsed = parseRewriteResponse("INT. LIBRARY - NIGHT\n\nALIYAH\nWe found it.\n\nEXT. ROOFTOP - DAWN\n\nShe runs.");

    expect(parsed.rewrittenScript).toContain("EXT. ROOFTOP");
    expect(parsed.changeSummary.join(" ")).toContain("plain screenplay");
    expect(parsed.warnings.join(" ")).toContain("not valid JSON");
  });

  it("rejects provider notes that do not look like screenplay", () => {
    expect(() => parseRewriteResponse("I improved the midpoint and recommend adding a scene later.")).toThrow(/did not include a recoverable screenplay/i);
  });

  it("validates whether a rewrite can be applied to the editor", () => {
    expect(validateRewriteScript("INT. LIBRARY - NIGHT\n\nALIYAH opens the book.").canApply).toBe(true);
    const invalid = validateRewriteScript("Here are my notes: add a midpoint and improve pacing.");
    expect(invalid.canApply).toBe(false);
    expect(invalid.issues.join(" ")).toContain("screenplay");
  });
});

describe("rewrite review helpers", () => {
  it("summarizes line, character, and scene-heading deltas for review before accept/revert", () => {
    const summary = summarizeRewriteDiff(
      "INT. LIBRARY - NIGHT\n\nALIYAH finds a book.",
      "INT. LIBRARY - NIGHT\n\nALIYAH opens a glowing book.\n\nEXT. ROOFTOP - DAWN\n\nShe runs.",
    );

    expect(summary.beforeLines).toBe(3);
    expect(summary.afterLines).toBe(7);
    expect(summary.lineDelta).toBe(4);
    expect(summary.sceneHeadingDelta).toBe(1);
    expect(summary.changedLineCount).toBeGreaterThan(0);
  });

  it("compares before and after report cards with score deltas and top improved metric", () => {
    const after: ScriptReportCard = {
      ...reportCard,
      overallScore: 76,
      frameworkScores: reportCard.frameworkScores.map((framework) => ({ ...framework, score: framework.score + 20 })),
      pacingScore: { ...reportCard.pacingScore, score: 65 },
    };

    const comparison = compareReportCards(reportCard, after);

    expect(comparison.overallDelta).toBe(15);
    expect(comparison.metricDeltas.find((m) => m.id === "save-the-cat")?.delta).toBe(20);
    expect(comparison.metricDeltas.find((m) => m.id === "pacing")?.delta).toBe(15);
    expect(comparison.topImprovement?.id).toBe("save-the-cat");
  });
});
