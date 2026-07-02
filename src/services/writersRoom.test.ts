import { describe, it, expect } from "vitest";
import { runWritersRoom, assignSeats, type SceneCard } from "./writersRoomService";
import type { ScriptReportCard } from "./scriptReportCardService";
import { normalizeReportCard, metricScoreFromCard } from "./scriptReportCardService";
import type { TextAiProvider } from "./textAiSettingsService";

const SCRIPT = [
  "INT. KITCHEN - DAY",
  "",
  "Mara waits by the window, coat on.",
  "",
  "MARA",
  "We should go.",
  "",
  "INT. HALL - NIGHT",
  "",
  "Jonas blocks the door.",
  "",
  "JONAS",
  "Not yet.",
  "",
].join("\n");

const report: ScriptReportCard = normalizeReportCard({
  overallScore: 33,
  frameworkScores: [{
    frameworkId: "dan-harmon",
    frameworkName: "Dan Harmon Story Circle",
    score: 31,
    summary: "Rushed",
    beatScores: [{ beatName: "You", score: 18, missing: true, suggestions: [], expectedPageRange: "1-2" }],
  }],
  topFixes: ["Dramatize the You beat"],
} as unknown as Partial<ScriptReportCard>);

const cardsJson = JSON.stringify({
  cards: [
    { beat: "You", slugline: "INT. KITCHEN - DAY", source: "keep", intent: "establish", conflict: "waiting", turn: "decision", characters: ["MARA"], pages: 1 },
    { beat: "Need", slugline: "INT. HALL - NIGHT", source: "rework", intent: "obstacle", conflict: "Jonas blocks", turn: "standoff", characters: ["MARA", "JONAS"], pages: 1 },
    { beat: "Go", slugline: "EXT. STREET - NIGHT", source: "new", intent: "departure", conflict: "cold feet", turn: "they go", characters: ["MARA", "JONAS"], pages: 1 },
  ],
});

function makeComplete(log: { provider: string; kind: string }[]) {
  return async (provider: TextAiProvider, system: string, user: string): Promise<string> => {
    const sys = system.toLowerCase();
    if (sys.includes("showrunner of a working writers' room")) {
      log.push({ provider, kind: "memo" });
      return JSON.stringify({ theme: "Leaving is a choice", problems: ["rushed You beat"], sacredScenes: ["INT. KITCHEN - DAY"], direction: "Slow the open, earn the exit." });
    }
    if (sys.includes("staff writer pitching")) {
      log.push({ provider, kind: "pitch" });
      return cardsJson;
    }
    if (sys.includes("assembling the story board")) {
      log.push({ provider, kind: "merge" });
      return cardsJson;
    }
    if (sys.includes("revising the story board")) {
      log.push({ provider, kind: "revise" });
      return cardsJson;
    }
    if (sys.includes("drafting one scene")) {
      log.push({ provider, kind: "draft" });
      const slug = user.match(/Slugline: (.+)/)?.[1] ?? "INT. SOMEWHERE - DAY";
      return `${slug}\n\nMara squares her shoulders in the doorway.\n\nMARA\nTonight we go.\n`;
    }
    if (sys.includes("punch-up specialist")) {
      log.push({ provider, kind: "punch" });
      const draft = user.match(/THE DRAFT:\n---\n([\s\S]*?)\n---/)?.[1] ?? "";
      return JSON.stringify({ rewrittenScript: draft.replace("Tonight we go.", "Tonight. No more waiting."), changeSummary: ["tightened dialogue"], warnings: [] });
    }
    if (sys.includes("studio coverage")) {
      log.push({ provider, kind: "coverage" });
      return JSON.stringify({ flagged: [], summary: "Holds." });
    }
    log.push({ provider, kind: "other" });
    return "{}";
  };
}

describe("assignSeats", () => {
  it("gives Claude the judge seat when available and keeps the drafter distinct", () => {
    const seats = assignSeats(["grok", "claude", "openai"] as TextAiProvider[]);
    expect(seats.drafter).toBe("grok");
    expect(seats.judge).toBe("claude");
    expect(seats.coverage).toBe("openai");
  });

  it("degrades gracefully with a single engine", () => {
    const seats = assignSeats(["grok"] as TextAiProvider[]);
    expect(seats.drafter).toBe("grok");
    expect(seats.judge).toBe("grok");
    expect(seats.coverage).toBe("grok");
  });
});

describe("runWritersRoom", () => {
  const input = {
    script: SCRIPT,
    frameworkId: "dan-harmon",
    frameworkName: "Dan Harmon Story Circle",
    targetPages: 10,
    reportCard: report,
    knowledgeBase: null,
    styleProfile: null,
    allowedCast: ["MARA", "JONAS"],
    engines: ["grok", "claude"] as TextAiProvider[],
  };

  it("runs memo → pitches → merge → outline loop → draft → punch-up → table read", async () => {
    const log: { provider: string; kind: string }[] = [];
    const result = await runWritersRoom(input, undefined, {
      complete: makeComplete(log),
      scoreOutline: async () => ({ score: 90, notes: [] }),
      scoreScript: async () => report,
    });

    // Seats: grok drafts, claude judges (memo/merge/punch).
    expect(log.find((l) => l.kind === "memo")?.provider).toBe("claude");
    expect(log.filter((l) => l.kind === "pitch").map((l) => l.provider).sort()).toEqual(["claude", "grok"]);
    expect(log.filter((l) => l.kind === "draft").every((l) => l.provider === "grok")).toBe(true);
    expect(log.filter((l) => l.kind === "punch")).toHaveLength(2);
    expect(log.find((l) => l.kind === "coverage")?.provider).toBe("claude");

    // "keep" card copies the original scene text verbatim into the draft.
    expect(result.finalScript).toContain("Mara waits by the window, coat on.");
    // rework + new cards were drafted (and then punched up).
    expect(result.finalScript).toContain("Tonight. No more waiting.");
    expect(result.board).toHaveLength(3);
    expect(result.outlineScores).toEqual([90]);
    expect(result.memo.theme).toBe("Leaving is a choice");
    expect(result.finalScore).toBe(metricScoreFromCard(report, "dan-harmon"));
  });

  it("iterates the board when the outline scores low, then stops at the target", async () => {
    const log: { provider: string; kind: string }[] = [];
    const scores = [60, 88];
    let call = 0;
    const result = await runWritersRoom(input, undefined, {
      complete: makeComplete(log),
      scoreOutline: async () => ({ score: scores[call], notes: scores[call++] < 85 ? ["Go beat lands late"] : [] }),
      scoreScript: async () => report,
    });
    expect(result.outlineScores).toEqual([60, 88]);
    expect(log.filter((l) => l.kind === "revise")).toHaveLength(1);
  });

  it("keeps the previous draft when a punch-up comes back truncated", async () => {
    const log: { provider: string; kind: string }[] = [];
    const base = makeComplete(log);
    const result = await runWritersRoom(input, undefined, {
      complete: async (p, sys, user) => {
        if (sys.toLowerCase().includes("punch-up specialist")) {
          log.push({ provider: p, kind: "punch" });
          return JSON.stringify({ rewrittenScript: "INT. NOWHERE - DAY\n\nFragment.", changeSummary: [], warnings: [] });
        }
        return base(p, sys, user);
      },
      scoreOutline: async () => ({ score: 90, notes: [] }),
      scoreScript: async () => report,
    });
    expect(result.finalScript).toContain("Mara waits by the window, coat on.");
    expect(result.warnings.some((w) => w.includes("truncated"))).toBe(true);
  });

  it("flags invented characters that slip through", async () => {
    const log: { provider: string; kind: string }[] = [];
    const base = makeComplete(log);
    const result = await runWritersRoom(input, undefined, {
      complete: async (p, sys, user) => {
        if (sys.toLowerCase().includes("drafting one scene")) {
          return "EXT. STREET - NIGHT\n\nRUTH\nWho are you people?\n";
        }
        return base(p, sys, user);
      },
      scoreOutline: async () => ({ score: 90, notes: [] }),
      scoreScript: async () => report,
    });
    expect(result.warnings.some((w) => w.includes("RUTH"))).toBe(true);
  });

  it("throws when no engine produces a pitch", async () => {
    await expect(runWritersRoom(input, undefined, {
      complete: async (_p, sys) => {
        if (sys.toLowerCase().includes("staff writer pitching")) throw new Error("down");
        return JSON.stringify({ theme: "x", problems: [], sacredScenes: [], direction: "y" });
      },
      scoreOutline: async () => ({ score: 90, notes: [] }),
      scoreScript: async () => report,
    })).rejects.toThrow(/beat sheet/);
  });

  it("board coercion drops junk and clamps pages", async () => {
    const log: { provider: string; kind: string }[] = [];
    const base = makeComplete(log);
    const junkCards = JSON.stringify({ cards: [
      { beat: "You", slugline: "INT. KITCHEN - DAY", source: "keep", intent: "a", conflict: "b", turn: "c", characters: ["MARA"], pages: 99 },
      { beat: "Need", slugline: "", source: "new" },
      { notACard: true },
    ] });
    const result = await runWritersRoom({ ...input, engines: ["grok"] as TextAiProvider[] }, undefined, {
      complete: async (p, sys, user) => {
        const lower = sys.toLowerCase();
        if (lower.includes("staff writer pitching")) return junkCards;
        return base(p, sys, user);
      },
      scoreOutline: async () => ({ score: 90, notes: [] }),
      scoreScript: async () => report,
    });
    expect(result.board).toHaveLength(1);
    expect(result.board[0].pages).toBeLessThanOrEqual(6);
  });
});

// Type-only usage to keep the SceneCard export exercised.
const _card: SceneCard = { beat: "You", slugline: "INT. A - DAY", source: "new", intent: "", conflict: "", turn: "", characters: [], pages: 1 };
void _card;

describe("review regressions: scene resolution", () => {
  it("a kept scene does NOT drag in the next scene's slugline", async () => {
    const log: { provider: string; kind: string }[] = [];
    const result = await runWritersRoom(
      { ...({ script: SCRIPT, frameworkId: "dan-harmon", frameworkName: "Dan Harmon Story Circle", targetPages: 10, reportCard: report, knowledgeBase: null, styleProfile: null, allowedCast: ["MARA", "JONAS"] }), engines: ["grok"] as TextAiProvider[] },
      undefined,
      {
        complete: async (p, sys, user) => {
          const base = makeComplete(log);
          if (sys.toLowerCase().includes("staff writer pitching")) {
            return JSON.stringify({ cards: [
              { beat: "You", slugline: "INT. KITCHEN - DAY", source: "keep", intent: "a", conflict: "b", turn: "c", characters: ["MARA"], pages: 1 },
            ] });
          }
          return base(p, sys, user);
        },
        scoreOutline: async () => ({ score: 90, notes: [] }),
        scoreScript: async () => report,
      },
    );
    // The kept kitchen scene must end before INT. HALL — no duplicate/phantom headings.
    const occurrences = result.finalScript.split("INT. HALL - NIGHT").length - 1;
    expect(occurrences).toBe(0);
    expect(result.finalScript).toContain("Mara waits by the window, coat on.");
  });

  it("repeated sluglines resolve by occurrence (k-th card gets the k-th scene)", async () => {
    const repeatScript = [
      "INT. KITCHEN - DAY", "", "First kitchen visit.", "",
      "INT. HALL - NIGHT", "", "Hall beat.", "",
      "INT. KITCHEN - DAY", "", "Second kitchen visit, colder now.", "",
    ].join("\n");
    const log: { provider: string; kind: string }[] = [];
    const result = await runWritersRoom(
      { script: repeatScript, frameworkId: "dan-harmon", frameworkName: "Dan Harmon Story Circle", targetPages: 10, reportCard: report, knowledgeBase: null, styleProfile: null, allowedCast: ["MARA"], engines: ["grok"] as TextAiProvider[] },
      undefined,
      {
        complete: async (p, sys, user) => {
          const base = makeComplete(log);
          if (sys.toLowerCase().includes("staff writer pitching")) {
            return JSON.stringify({ cards: [
              { beat: "You", slugline: "INT. KITCHEN - DAY", source: "keep", intent: "a", conflict: "b", turn: "c", characters: [], pages: 1 },
              { beat: "Return", slugline: "INT. KITCHEN - DAY", source: "keep", intent: "a", conflict: "b", turn: "c", characters: [], pages: 1 },
            ] });
          }
          return base(p, sys, user);
        },
        scoreOutline: async () => ({ score: 90, notes: [] }),
        scoreScript: async () => report,
      },
    );
    expect(result.finalScript).toContain("First kitchen visit.");
    expect(result.finalScript).toContain("Second kitchen visit, colder now.");
  });

  it("an unmatched keep card warns and drafts fresh instead of failing silently", async () => {
    const log: { provider: string; kind: string }[] = [];
    const result = await runWritersRoom(
      { script: SCRIPT, frameworkId: "dan-harmon", frameworkName: "Dan Harmon Story Circle", targetPages: 10, reportCard: report, knowledgeBase: null, styleProfile: null, allowedCast: ["MARA"], engines: ["grok"] as TextAiProvider[] },
      undefined,
      {
        complete: async (p, sys, user) => {
          const base = makeComplete(log);
          if (sys.toLowerCase().includes("staff writer pitching")) {
            return JSON.stringify({ cards: [
              { beat: "You", slugline: "INT. GREENHOUSE - DUSK", source: "keep", intent: "a", conflict: "b", turn: "c", characters: [], pages: 1 },
            ] });
          }
          return base(p, sys, user);
        },
        scoreOutline: async () => ({ score: 90, notes: [] }),
        scoreScript: async () => report,
      },
    );
    expect(result.warnings.some((w) => w.includes("did not match any scene"))).toBe(true);
    expect(log.some((l) => l.kind === "draft")).toBe(true);
  });
});
