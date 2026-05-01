import { describe, expect, it } from "vitest";
import { buildPrompt, type OrchestratorContext } from "../src/services/aiOrchestrator";

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
