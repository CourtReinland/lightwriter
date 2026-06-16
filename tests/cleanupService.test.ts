import { describe, expect, it } from "vitest";
import {
  buildCleanupPrompt,
  rewriteScriptWithCleanup,
  collapseDuplicateShotLines,
} from "../src/services/cleanupService";
import { extractShotScenes } from "../src/services/shotDirectionService";
import type { TextAiProviderSettings } from "../src/services/textAiSettingsService";

const SCRIPT = `Title: Test

INT. ROOM - DAY

MARA enters.
`;

const settings: TextAiProviderSettings = { provider: "grok", apiKey: "test-key", model: "grok-3-mini-fast", updatedAt: 0 };

describe("collapseDuplicateShotLines", () => {
  it("removes an exact-duplicate consecutive shot line", () => {
    const input = "!!WS THE ROOM\n!!WS THE ROOM\nMARA enters.";
    expect(collapseDuplicateShotLines(input)).toBe("!!WS THE ROOM\nMARA enters.");
  });

  it("keeps distinct consecutive shots and shots separated by action", () => {
    const distinct = "!!WS THE ROOM\n!!CU MARA'S FACE";
    expect(collapseDuplicateShotLines(distinct)).toBe(distinct);

    const separated = "!!WS THE ROOM\nMARA enters.\n!!WS THE ROOM";
    expect(collapseDuplicateShotLines(separated)).toBe(separated);
  });
});

describe("cleanup prompt", () => {
  it("instructs grammar/spelling fixes and duplication removal without changing story", () => {
    const { scenes } = extractShotScenes(SCRIPT);
    const prompt = buildCleanupPrompt({ scene: scenes[0], knowledgeBase: null });

    expect(prompt.system).toContain("Spelling, grammar, punctuation");
    expect(prompt.system).toContain("Unnecessary duplications");
    expect(prompt.system).toContain("Change the story");
    expect(prompt.system).toContain("Rewrite for style, expand, compress, or add new content");
  });
});

describe("cleanup whole-script pass", () => {
  it("applies the deterministic duplicate-shot collapse on top of the AI cleanup", async () => {
    const result = await rewriteScriptWithCleanup(
      SCRIPT,
      settings,
      null,
      undefined,
      async () => "!!WS THE ROOM\n!!WS THE ROOM\nMARA enters.",
    );

    // The AI returned a duplicate shot line; the deterministic collapse must remove it.
    const shotLines = result.split("\n").filter((l) => l.trim() === "!!WS THE ROOM");
    expect(shotLines).toHaveLength(1);
    expect(result).toContain("MARA enters.");
  });
});
