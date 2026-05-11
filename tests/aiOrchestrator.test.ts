import { describe, expect, it } from "vitest";
import { buildPrompt, type OrchestratorContext } from "../src/services/aiOrchestrator";
import type { KnowledgeBase } from "../src/services/knowledgeBase";
import type { StyleProfile } from "../src/services/styleProfile";

const baseCtx: Omit<OrchestratorContext, "mode"> = {
  selectedText: "AIDEN turns his head and coughs.",
  surroundingContext: "INT. ROOM - NIGHT\n\nAIDEN waits by the window.",
  fullScript: "INT. ROOM - NIGHT\n\nAIDEN waits by the window.",
  cursorLine: 3,
  cursorBeats: [],
  knowledgeBase: null,
  styleProfile: null,
};

describe("buildPrompt add_shots mode", () => {
  it("instructs the model to add forced Fountain shot lines with MS/WS/CU syntax", () => {
    const prompt = buildPrompt({ ...baseCtx, mode: "add_shots" });

    expect(prompt.system).toContain("MS = Medium Shot");
    expect(prompt.system).toContain("WS = Wide Shot");
    expect(prompt.system).toContain("CU = Close Up");
    expect(prompt.system).toContain("!!SHOT CHARACTER NAME ACTION IN CONTEXT");
    expect(prompt.system).toContain("!!MS AIDEN TURNS HIS HEAD AND COUGHS");
    expect(prompt.user).toContain("Selected text:");
    expect(prompt.temperature).toBe(0.55);
  });
});

describe("buildPrompt style context", () => {
  it("injects writer style contract, target style, extra style notes, and target pages", () => {
    const styleProfile: StyleProfile = {
      projectId: "p1",
      avgSentenceLength: 8,
      sentenceLengthVariance: "high",
      vocabularyComplexity: "moderate",
      predominantTone: "tender and strange",
      pov: "screenplay objective",
      tense: "present",
      dialogueToActionRatio: "balanced",
      sampleExcerpts: ["Aiden smiles like he is apologizing to the room."],
      rawAnalysis: "Short emotional action lines with gentle comic deflection.",
      updatedAt: 1,
      styleContract: "Use clipped, emotionally loaded action lines and indirect dialogue.",
      doRules: ["Let jokes carry sadness"],
      avoidRules: ["Do not become generic studio banter"],
    };
    const kb: KnowledgeBase = {
      projectId: "p1",
      characters: [],
      scenes: [],
      worldRules: [],
      plotThreads: [],
      toneStyle: {
        genre: "coming-of-age fantasy",
        mood: "wistful",
        pacingNotes: "Let scenes breathe before emotional turns.",
        targetStyle: "Pixar emotional clarity with Kubrick-like restraint",
        styleNotes: "Keep the writer's own quiet melancholy first.",
      },
      customNotes: [],
      updatedAt: 1,
    };

    const prompt = buildPrompt({
      ...baseCtx,
      mode: "expand_scene",
      knowledgeBase: kb,
      styleProfile,
      targetPages: 42,
    });

    expect(prompt.system).toContain("=== STYLE CONTRACT ===");
    expect(prompt.system).toContain("Use clipped, emotionally loaded action lines");
    expect(prompt.system).toContain("Target/director style directive: Pixar emotional clarity with Kubrick-like restraint");
    expect(prompt.system).toContain("Keep the writer's own quiet melancholy first");
    expect(prompt.system).toContain("Target screenplay length: 42 pages");
    expect(prompt.system).toContain("TONE & STYLE");
  });
});
