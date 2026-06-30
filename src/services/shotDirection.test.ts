import { describe, it, expect } from "vitest";
import { rewriteScriptWithShotDirections } from "./shotDirectionService";
import type { TextAiProviderSettings } from "./textAiSettingsService";

const settings: TextAiProviderSettings = { provider: "grok", apiKey: "test-key", model: "grok-4", updatedAt: 0 };

describe("rewriteScriptWithShotDirections — formatting repair", () => {
  it("re-seats a character cue the model jammed below a shot line (no blank)", async () => {
    const content = "INT. KITCHEN - DAY\n\nMara waits.\n\nMARA\nYou came back.\n";
    // The model returns the scene with a shot line directly above the cue and no
    // blank line — which makes the cue render as left-justified action.
    const malformed = "INT. KITCHEN - DAY\n\nMara waits.\n\n!!MS ON MARA\nMARA\nYou came back.\n";

    const out = await rewriteScriptWithShotDirections(content, settings, null, undefined, async () => malformed);

    const lines = out.split("\n");
    const cueIdx = lines.findIndex((l) => l.trim() === "MARA");
    expect(cueIdx).toBeGreaterThan(0);
    expect(lines[cueIdx - 1].trim()).toBe(""); // blank line restored before the cue
    expect(lines[cueIdx + 1].trim()).toBe("You came back."); // dialogue pulled back under the cue
    expect(out).toContain("!!MS ON MARA"); // the added shot is preserved
  });

  it("keeps the shot but never leaves the cue without a preceding blank line", async () => {
    const content = "EXT. ROOFTOP - NIGHT\n\nAIDEN\nWe made it.\n";
    const malformed = "EXT. ROOFTOP - NIGHT\n\n!!WS THE CITY SKYLINE\n!!CU ON AIDEN\nAIDEN\nWe made it.\n";

    const out = await rewriteScriptWithShotDirections(content, settings, null, undefined, async () => malformed);
    const lines = out.split("\n");
    const cueIdx = lines.findIndex((l) => l.trim() === "AIDEN");
    expect(cueIdx).toBeGreaterThan(0);
    expect(lines[cueIdx - 1].trim()).toBe("");
    expect(lines[cueIdx + 1].trim()).toBe("We made it.");
  });
});
