import { describe, expect, it } from "vitest";
import { ALL_FRAMEWORKS, computeBeatRanges } from "../src/frameworks";

describe("story framework registry", () => {
  it("registers Dan Harmon's Story Circle for overlay and beat-aware AI prompts", () => {
    const framework = ALL_FRAMEWORKS.find((item) => item.id === "dan-harmon-story-circle");

    expect(framework).toBeDefined();
    expect(framework?.name).toBe("Dan Harmon Story Circle");
    expect(framework?.beats.map((beat) => beat.name)).toEqual([
      "You",
      "Need",
      "Go",
      "Search",
      "Find",
      "Take",
      "Return",
      "Change",
    ]);
    expect(framework?.beats.every((beat) => beat.description.length > 20)).toBe(true);
    expect(framework?.beats.every((beat) => beat.examples.length >= 2)).toBe(true);
  });

  it("computes line ranges for all eight Story Circle beats", () => {
    const framework = ALL_FRAMEWORKS.find((item) => item.id === "dan-harmon-story-circle");
    expect(framework).toBeDefined();

    const ranges = computeBeatRanges(framework!, 30, 600);

    expect(ranges).toHaveLength(8);
    expect(ranges[0]).toMatchObject({ name: "You", startLine: 0 });
    expect(ranges[7]).toMatchObject({ name: "Change", endLine: 600 });
    expect(ranges.every((beat) => beat.frameworkId === "dan-harmon-story-circle")).toBe(true);
  });
});
