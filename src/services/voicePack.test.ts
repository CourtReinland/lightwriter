import { beforeEach, describe, expect, it } from "vitest";
import { VoiceCorpusStore } from "./voiceCorpusStore";
import {
  buildVoicePack,
  compileVoicePack,
  compiledVoicePackFor,
  loadVoicePack,
  saveVoicePack,
  selectRepresentativeScenes,
  splitScenes,
  type VoicePack,
} from "./voicePackService";

function installLocalStorage() {
  const store = new Map<string, string>();
  (globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
    clear: () => void store.clear(),
  };
}

// A dialogue-rich scene, padded past the 450-char selection floor.
function chattyScene(slug: string, who: string) {
  return `${slug}

The room hums with the kind of quiet that never lasts long in this house.

${who}
Can't you like, do something?! Like with your magic.

MAX
Something... something's blocking it. I can feel it pushing back at me.

${who}
Ugh!? How long will that take?! We are already so late and everybody is waiting on us.

MAX
Longer than we have. Maybe a lot longer than we have.

${who}
Don't say that. Don't even think about saying that.

MAX
Okay. Not saying it.
`;
}

const SCRIPT_A = `Title: Ep A

${chattyScene("INT. KITCHEN - DAY", "ALIYAH")}

EXT. YARD - DAY

A quiet beat. Nobody speaks here at all.
`;

const SCRIPT_B = `Title: Ep B

${chattyScene("EXT. ROAD - DAY", "AIDEN")}
`;

describe("splitScenes / selectRepresentativeScenes", () => {
  beforeEach(installLocalStorage);

  it("splits on sluglines and keeps scene text", () => {
    const scenes = splitScenes(SCRIPT_A);
    expect(scenes.length).toBe(2);
    expect(scenes[0].heading).toBe("INT. KITCHEN - DAY");
    expect(scenes[0].text).toContain("blocking it");
    expect(scenes[1].heading).toBe("EXT. YARD - DAY");
  });

  it("selects dialogue-rich scenes spread across episodes", () => {
    const scripts = VoiceCorpusStore.addScripts("s1", [
      { title: "Ep A", text: SCRIPT_A },
      { title: "Ep B", text: SCRIPT_B },
    ]);
    const picks = selectRepresentativeScenes(scripts, 5);
    expect(picks.length).toBe(2); // only one qualifying scene per episode
    expect(new Set(picks.map((p) => p.episode)).size).toBe(2);
    expect(picks[0].cueCount).toBeGreaterThanOrEqual(3);
  });
});

describe("buildVoicePack", () => {
  beforeEach(installLocalStorage);

  function seedCorpus() {
    VoiceCorpusStore.addScripts("s1", [
      { title: "Ep A", text: SCRIPT_A },
      { title: "Ep B", text: SCRIPT_B },
    ]);
    VoiceCorpusStore.computePrint("s1");
  }

  const mockComplete = (opts?: { failGeneric?: boolean }) => {
    const calls: Array<{ system: string; user: string }> = [];
    const fn = async (system: string, user: string) => {
      calls.push({ system, user });
      if (/house style/i.test(system)) {
        if (opts?.failGeneric) throw new Error("engine down");
        return `INT. GENERIC - DAY\n\nThe characters discuss the problem at considerable length, professionally covering the same events as the original scene did, with smooth grammatical sentences that carry no particular signature or stylistic identity whatsoever, resolving the beat exactly as before.\n\nMAX\nI am afraid something is preventing me from repairing it at this time.`;
      }
      return JSON.stringify({
        rules: [
          { kind: "never", text: "Never let dialogue exceed two sentences without an interruption." },
          { kind: "always", text: "Always open big reactions with an interjection (Ugh, Ooh, Whoa)." },
        ],
        policy: "Enter scenes late. Withhold explanations. Humor comes from repetition and kid-logic.",
      });
    };
    return { fn, calls };
  };

  it("builds pairs, harvests rules + policy, and persists", async () => {
    seedCorpus();
    const { fn, calls } = mockComplete();
    const progress: string[] = [];
    const pack = await buildVoicePack("s1", { complete: fn, onProgress: (l) => progress.push(l) });

    expect(pack.pairs.length).toBe(2);
    expect(pack.pairs[0].authored).toContain("blocking it");
    expect(pack.pairs[0].generic).toContain("GENERIC");
    expect(pack.rules.length).toBe(2);
    expect(pack.rules.every((r) => r.enabled && r.source === "harvested")).toBe(true);
    expect(pack.policy).toContain("Enter scenes late");
    expect(loadVoicePack("s1")?.pairs.length).toBe(2);
    expect(progress.some((p) => /generic half/.test(p))).toBe(true);
    // The harvest call saw the measured print and both pair sides.
    const harvest = calls.find((c) => /forensic style analyst/i.test(c.system))!;
    expect(harvest.user).toContain("VOICE PRINT");
    expect(harvest.user).toContain("[THE AUTHOR'S ACTUAL SCENE]");
  });

  it("keeps user-authored rules across rebuilds", async () => {
    seedCorpus();
    const { fn } = mockComplete();
    await buildVoicePack("s1", { complete: fn });
    const pack = loadVoicePack("s1")!;
    pack.rules.push({ id: "user1", kind: "never", text: "Never use the word 'suddenly'.", enabled: true, source: "user" });
    saveVoicePack(pack);

    await buildVoicePack("s1", { complete: fn });
    const rebuilt = loadVoicePack("s1")!;
    expect(rebuilt.rules.some((r) => r.id === "user1")).toBe(true);
    expect(rebuilt.rules.filter((r) => r.source === "harvested").length).toBe(2);
  });

  it("fails loudly when every generic half fails", async () => {
    seedCorpus();
    const { fn } = mockComplete({ failGeneric: true });
    await expect(buildVoicePack("s1", { complete: fn })).rejects.toThrow(/generic-half generation failed/);
  });
});

describe("compileVoicePack", () => {
  beforeEach(installLocalStorage);

  const pack: VoicePack = {
    seriesId: "s1",
    pairs: [
      {
        id: "p1",
        sceneRef: "Ep A — INT. KITCHEN - DAY",
        authored: "ALIYAH\nUgh!? Again?!",
        generic: "ALIYAH\nI am quite frustrated that this has happened again.",
        createdAt: 0,
      },
    ],
    rules: [
      { id: "r1", kind: "never", text: "Never over-explain.", enabled: true, source: "harvested" },
      { id: "r2", kind: "always", text: "Always cut on the turn.", enabled: true, source: "harvested" },
      { id: "r3", kind: "never", text: "Disabled rule.", enabled: false, source: "user" },
    ],
    policy: "Enter late, leave early.",
    updatedAt: 0,
  };

  it("assembles policy, enabled rules, print block, and one contrast example", () => {
    VoiceCorpusStore.addScripts("s1", [{ title: "Ep A", text: SCRIPT_A }]);
    const print = VoiceCorpusStore.computePrint("s1");
    const block = compileVoicePack(pack, print);
    expect(block).toContain("AUTHOR VOICE PACK");
    expect(block).toContain("POLICY:\nEnter late, leave early.");
    expect(block).toContain("+ Always cut on the turn.");
    expect(block).toContain("- Never over-explain.");
    expect(block).not.toContain("Disabled rule");
    expect(block).toContain("VOICE PRINT");
    expect(block).toContain("[GENERIC]");
    expect(block).toContain("[THE AUTHOR]");
  });

  it("respects the char budget", () => {
    const block = compileVoicePack(pack, null, 300);
    expect(block.length).toBeLessThanOrEqual(300);
  });

  it("compiledVoicePackFor returns empty without a pack or series", () => {
    expect(compiledVoicePackFor(undefined)).toBe("");
    expect(compiledVoicePackFor("nope")).toBe("");
    saveVoicePack(pack);
    expect(compiledVoicePackFor("s1")).toContain("AUTHOR VOICE PACK");
  });
});
