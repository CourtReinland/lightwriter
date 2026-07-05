import { beforeEach, describe, expect, it } from "vitest";
import { runKeepGoing, type KeepGoingInput } from "./keepGoingService";
import type { ScriptReportCard } from "./scriptReportCardService";
import { loadRoomLog } from "./writersRoomService";
import { computeVoicePrint } from "./voiceMetricsService";
import type { TextAiProvider } from "./textAiSettingsService";

function installLocalStorage() {
  const store = new Map<string, string>();
  (globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
    clear: () => void store.clear(),
  };
}

const TAKE = [
  "INT. KITCHEN - DAY",
  "",
  "Mara waits by the window, coat on. The kettle screams and nobody moves.",
  "",
  "MARA",
  "We should go. Right now, before he wakes.",
  "",
  "INT. HALL - NIGHT",
  "",
  "Jonas blocks the door, arms folded, jaw set.",
  "",
  "JONAS",
  "Not yet. Not like this.",
  "",
].join("\n");

// Minimal literal card — the loop only reads metricScoreFromCard (framework
// entry score) and serializes it; normalizeReportCard's coverage penalties
// would obscure the queued scores.
function card(score: number): ScriptReportCard {
  return {
    overallScore: score,
    frameworkScores: [{
      frameworkId: "dan-harmon-story-circle",
      frameworkName: "Dan Harmon Story Circle",
      score,
      summary: "s",
      beatScores: [],
    }],
    topFixes: ["fix the You beat"],
  } as unknown as ScriptReportCard;
}

/** A scorer that returns the queued scores in order (first call scores the input take). */
function scoreQueue(scores: number[]) {
  let i = 0;
  const calls: string[] = [];
  return {
    calls,
    score: async (script: string) => {
      calls.push(script);
      return card(scores[Math.min(i++, scores.length - 1)]);
    },
  };
}

function rewriteComplete(log: Array<{ provider: string }>, mutate = (round: number) => `${TAKE}\n\nMARA\nRound ${round} was here.\n`) {
  let round = 0;
  return async (provider: TextAiProvider, _system: string, _user: string) => {
    log.push({ provider });
    round += 1;
    return JSON.stringify({ rewrittenScript: mutate(round), changeSummary: [], warnings: [] });
  };
}

const baseInput: KeepGoingInput = {
  script: TAKE,
  metricId: "dan-harmon-story-circle",
  metricName: "Dan Harmon Story Circle",
  targetPages: 0, // keep the expansion path out of unit tests
  knowledgeBase: null,
  styleProfile: null,
  allowedCast: ["MARA", "JONAS"],
  engines: ["claude", "grok"] as TextAiProvider[],
};

describe("runKeepGoing", () => {
  beforeEach(installLocalStorage);

  it("iterates until the target and keeps the best draft", async () => {
    const { score, calls } = scoreQueue([60, 71, 82]);
    const log: Array<{ provider: string }> = [];
    const progress: string[] = [];
    const result = await runKeepGoing(
      { ...baseInput, targetScore: 80 },
      (p) => progress.push(p.label),
      { complete: rewriteComplete(log), scoreScript: score },
    );
    expect(result.startScore).toBe(60);
    expect(result.finalScore).toBe(82);
    expect(result.trajectory).toEqual([60, 71, 82]);
    expect(result.rounds).toBe(2);
    expect(result.reachedTarget).toBe(true);
    expect(result.improved).toBe(true);
    expect(result.finalScript).toContain("Round 2 was here.");
    expect(calls[0]).toBe(TAKE); // first scoring measures the take as delivered
    expect(progress.some((l) => l.includes("measuring the take"))).toBe(true);
  });

  it("stops immediately when the take already meets the target", async () => {
    const { score } = scoreQueue([85]);
    const log: Array<{ provider: string }> = [];
    const result = await runKeepGoing({ ...baseInput, targetScore: 80 }, undefined, {
      complete: rewriteComplete(log),
      scoreScript: score,
    });
    expect(result.rounds).toBe(0);
    expect(log).toHaveLength(0);
    expect(result.reachedTarget).toBe(true);
    expect(result.improved).toBe(false);
    expect(result.finalScript).toBe(TAKE);
  });

  it("never delivers worse: regressions are discarded and a stall stops the loop", async () => {
    const { score } = scoreQueue([60, 55, 58]);
    const log: Array<{ provider: string }> = [];
    const result = await runKeepGoing({ ...baseInput, targetScore: 80, maxRounds: 3 }, undefined, {
      complete: rewriteComplete(log),
      scoreScript: score,
    });
    expect(result.finalScore).toBe(60);
    expect(result.finalScript).toBe(TAKE);
    expect(result.improved).toBe(false);
    expect(result.rounds).toBe(2); // stall after two non-improving rounds
    expect(result.warnings.some((w) => w.includes("Stalled"))).toBe(true);
    expect(result.warnings.filter((w) => w.includes("below the 60 best")).length).toBe(2);
  });

  it("rotates engines between rounds", async () => {
    const { score } = scoreQueue([60, 62, 64, 66]);
    const log: Array<{ provider: string }> = [];
    const result = await runKeepGoing({ ...baseInput, targetScore: 99, maxRounds: 3 }, undefined, {
      complete: rewriteComplete(log),
      scoreScript: score,
    });
    expect(log.map((l) => l.provider)).toEqual(["claude", "grok", "claude"]);
    expect(result.enginesUsed).toEqual(["Claude (Anthropic)", "Grok (xAI)", "Claude (Anthropic)"]);
    expect(result.trajectory).toEqual([60, 62, 64, 66]);
  });

  it("treats a truncated rewrite as a failed round", async () => {
    const { score } = scoreQueue([60, 70]);
    const truncating = async () => JSON.stringify({ rewrittenScript: "INT. KITCHEN - DAY\n\nMARA\nHi.", changeSummary: [], warnings: [] });
    const result = await runKeepGoing({ ...baseInput, maxRounds: 1 }, undefined, {
      complete: truncating,
      scoreScript: score,
    });
    expect(result.finalScript).toBe(TAKE);
    expect(result.warnings.some((w) => w.includes("truncated"))).toBe(true);
    expect(result.trajectory).toEqual([60]); // the truncated pass was never scored
  });

  it("appends the voice pack and measured voice notes to rewrite prompts", async () => {
    const chatty = `INT. A - DAY\n\nMARA\nHey!\n\nJONAS\nWhat?!\n\nMARA\nUgh...\n\nJONAS\nOkay. Fine.\n\nMARA\nNo way!\n\nJONAS\nWay.\n`;
    const print = computeVoicePrint([
      { title: "Ep A", text: chatty },
      { title: "Ep B", text: chatty },
    ]);
    // A take big enough to clear the confidence floor (≥6 cues, ≥120 words)
    // and verbose enough to deviate from the chatty print.
    const longLine = "I have been giving this matter a great deal of careful consideration and I believe that we must proceed with the utmost caution before committing ourselves to anything at all.";
    const verboseTake = `INT. HALL - NIGHT\n\n${Array.from({ length: 6 }, (_, k) => `${k % 2 ? "JONAS" : "MARA"}\n${longLine}`).join("\n\n")}\n`;
    const { score } = scoreQueue([60, 82]);
    let seenUser = "";
    const result = await runKeepGoing(
      { ...baseInput, script: verboseTake, voicePack: "=== AUTHOR VOICE PACK ===\nPOLICY: Enter late.", voicePrint: print },
      undefined,
      {
        complete: async (_p, _s, user) => {
          seenUser = user;
          return JSON.stringify({ rewrittenScript: `${verboseTake}\nMARA\nYeah!\n`, changeSummary: [], warnings: [] });
        },
        scoreScript: score,
      },
    );
    expect(seenUser).toContain("AUTHOR VOICE PACK");
    expect(seenUser).toContain("VOICE NOTES");
    expect(result.voiceScore).not.toBeNull();
  });

  it("logs a keep-going entry to the room log when a projectId is given", async () => {
    const { score } = scoreQueue([60, 82]);
    const log: Array<{ provider: string }> = [];
    await runKeepGoing({ ...baseInput, projectId: "p1", targetScore: 80 }, undefined, {
      complete: rewriteComplete(log),
      scoreScript: score,
    });
    const entries = loadRoomLog("p1");
    expect(entries).toHaveLength(1);
    expect(entries[0].kind).toBe("keep-going");
    expect(entries[0].startScore).toBe(60);
    expect(entries[0].finalScore).toBe(82);
    expect(entries[0].changeSummary?.[0]).toContain("Trajectory: 60 → 82");
  });

  it("surfaces rewrite failures as warnings and still returns the original take", async () => {
    const { score } = scoreQueue([60]);
    const failing = async () => {
      throw new Error("engine down");
    };
    const result = await runKeepGoing({ ...baseInput, maxRounds: 3 }, undefined, {
      complete: failing,
      scoreScript: score,
    });
    expect(result.improved).toBe(false);
    expect(result.finalScript).toBe(TAKE);
    expect(result.rounds).toBe(2); // two failures = stall
    expect(result.warnings.some((w) => w.includes("engine down"))).toBe(true);
  });

  it("throws when the initial scoring fails", async () => {
    await expect(
      runKeepGoing(baseInput, undefined, {
        complete: rewriteComplete([]),
        scoreScript: async () => {
          throw new Error("analyst 401");
        },
      }),
    ).rejects.toThrow(/couldn't score the take/);
  });

  it("throws with no engines", async () => {
    await expect(runKeepGoing({ ...baseInput, engines: [] })).rejects.toThrow(/at least one engine/);
  });

  it("a tie adopts the newer draft but counts toward the stall", async () => {
    const { score } = scoreQueue([60, 60, 60]);
    const log: Array<{ provider: string }> = [];
    const result = await runKeepGoing({ ...baseInput, targetScore: 80, maxRounds: 3 }, undefined, {
      complete: rewriteComplete(log),
      scoreScript: score,
    });
    expect(result.rounds).toBe(2);
    expect(result.finalScore).toBe(60);
    expect(result.improved).toBe(true); // newer draft adopted on the tie
    expect(result.finalScript).toContain("Round 2 was here.");
    expect(result.changeSummary.filter((c) => c.includes("held at 60")).length).toBe(2);
  });
});

describe("runKeepGoing: stop + scoring scope", () => {
  beforeEach(installLocalStorage);

  it("Stop aborts at the next step boundary and keeps the best draft so far", async () => {
    const controller = new AbortController();
    let scoreCalls = 0;
    const score = async () => {
      scoreCalls += 1;
      // Abort right after round 1's re-score lands (call 2 = initial + round 1).
      if (scoreCalls === 2) controller.abort();
      return card(scoreCalls === 1 ? 60 : 70);
    };
    const log: Array<{ provider: string }> = [];
    const result = await runKeepGoing(
      { ...baseInput, targetScore: 99, maxRounds: 3, signal: controller.signal },
      undefined,
      { complete: rewriteComplete(log), scoreScript: score },
    );
    expect(result.stopped).toBe(true);
    expect(result.rounds).toBe(1); // round 2 never started
    expect(result.finalScore).toBe(70); // round 1's improvement was kept
    expect(result.improved).toBe(true);
    expect(result.warnings.some((w) => w.includes("Stopped by you"))).toBe(true);
    expect(log).toHaveLength(1); // exactly one rewrite was paid for
  });

  it("logs the delivered score even when the trajectory ends on a discarded round", async () => {
    const { score } = scoreQueue([60, 71, 65, 68]);
    const log: Array<{ provider: string }> = [];
    await runKeepGoing({ ...baseInput, projectId: "p2", targetScore: 99, maxRounds: 3 }, undefined, {
      complete: rewriteComplete(log),
      scoreScript: score,
    });
    const entry = loadRoomLog("p2")[0];
    expect(entry.finalScore).toBe(71);
    expect(entry.changeSummary?.[0]).toContain("60 → 71 → 65 → 68 · delivered 71");
    expect(entry.engines).toEqual(["claude", "grok", "claude"]); // provider ids, not display labels
  });

  it("round summaries report the beaten best, not the previous (discarded) sample", async () => {
    const { score } = scoreQueue([60, 55, 70]);
    const log: Array<{ provider: string }> = [];
    const result = await runKeepGoing({ ...baseInput, targetScore: 99, maxRounds: 2 }, undefined, {
      complete: rewriteComplete(log),
      scoreScript: score,
    });
    expect(result.changeSummary.some((c) => c.includes("60 → 70"))).toBe(true);
    expect(result.changeSummary.some((c) => c.includes("55 → 70"))).toBe(false);
  });

  it("scoreFrameworksFor: framework metric scopes to itself, craft metric to the active set", async () => {
    const { scoreFrameworksFor } = await import("./keepGoingService");
    const { ALL_FRAMEWORKS } = await import("../frameworks");
    const dh = ALL_FRAMEWORKS.find((f) => f.id === "dan-harmon-story-circle")!;
    const threeAct = ALL_FRAMEWORKS.find((f) => f.id === "three-act")!;

    expect(scoreFrameworksFor("dan-harmon-story-circle", [threeAct])).toEqual([dh]);
    expect(scoreFrameworksFor("style", [threeAct, dh])).toEqual([threeAct, dh]);
    expect(scoreFrameworksFor("style", [])).toBeUndefined();
    expect(scoreFrameworksFor("style", undefined)).toBeUndefined();
  });
});
