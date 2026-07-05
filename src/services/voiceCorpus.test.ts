import { beforeEach, describe, expect, it } from "vitest";
import { VoiceCorpusStore } from "./voiceCorpusStore";
import {
  buildCharacterLineIndex,
  characterVoiceBlock,
  sampleCharacterLines,
  type AliasMap,
} from "./characterLineIndex";

function installLocalStorage() {
  const store = new Map<string, string>();
  (globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
    clear: () => void store.clear(),
  };
}

const EP_A = `Title: Ep A

INT. KITCHEN - DAY

AIDEN
Pie! I want the whole thing right now.

AIDEN THOUGHTS
Don't eat the apple pie. Don't eat the apple pie.

ALIYAH
Ooh that smells delicious.
`;

const EP_B = `Title: Ep B

EXT. ROAD - DAY

AIDEN
What?

MAXIMILIAN
Something's blocking it.
`;

describe("VoiceCorpusStore", () => {
  beforeEach(installLocalStorage);

  it("adds, lists, replaces by title, and removes scripts", () => {
    const added = VoiceCorpusStore.addScripts("s1", [
      { title: "Ep A", text: EP_A },
      { title: "Ep B", text: EP_B },
    ]);
    expect(added.length).toBe(2);
    expect(added[0].wordCount).toBeGreaterThan(0);

    // Re-import with the same title replaces in place (same id).
    const idBefore = added.find((s) => s.title === "Ep A")!.id;
    const after = VoiceCorpusStore.addScripts("s1", [{ title: "Ep A", text: `${EP_A}\nMAX\nNew line.` }]);
    expect(after.length).toBe(2);
    expect(after.find((s) => s.title === "Ep A")!.id).toBe(idBefore);
    expect(after.find((s) => s.title === "Ep A")!.text).toContain("New line.");

    const remaining = VoiceCorpusStore.removeScript("s1", idBefore);
    expect(remaining.length).toBe(1);
  });

  it("scopes corpora by series", () => {
    VoiceCorpusStore.addScripts("s1", [{ title: "Ep A", text: EP_A }]);
    expect(VoiceCorpusStore.listScripts("s2")).toEqual([]);
  });

  it("computes and caches the print; corpus changes invalidate it", () => {
    VoiceCorpusStore.addScripts("s1", [
      { title: "Ep A", text: EP_A },
      { title: "Ep B", text: EP_B },
    ]);
    expect(VoiceCorpusStore.getPrint("s1")).toBeNull();
    const print = VoiceCorpusStore.computePrint("s1");
    expect(print.scriptCount).toBe(2);
    expect(VoiceCorpusStore.getPrint("s1")?.computedAt).toBe(print.computedAt);

    VoiceCorpusStore.addScripts("s1", [{ title: "Ep C", text: EP_B }]);
    expect(VoiceCorpusStore.getPrint("s1")).toBeNull();
  });

  it("rejects an oversized corpus", () => {
    const huge = "AIDEN\nHello there.\n\n".repeat(150_000);
    expect(() => VoiceCorpusStore.addScripts("s1", [{ title: "Huge", text: huge }])).toThrow(/over the/);
  });

  it("throws when computing a print with no corpus", () => {
    expect(() => VoiceCorpusStore.computePrint("empty")).toThrow(/at least one script/);
  });
});

describe("buildCharacterLineIndex", () => {
  beforeEach(installLocalStorage);

  function corpus() {
    return VoiceCorpusStore.addScripts("s1", [
      { title: "Ep A", text: EP_A },
      { title: "Ep B", text: EP_B },
    ]);
  }

  it("indexes lines per base character with episode refs and cue variants", () => {
    const index = buildCharacterLineIndex(corpus());
    expect(index.AIDEN.lines.length).toBe(3);
    expect(index.AIDEN.episodes).toEqual(["Ep A", "Ep B"]);
    const thoughts = index.AIDEN.lines.find((l) => l.cueVariant === "AIDEN THOUGHTS");
    expect(thoughts?.text).toContain("apple pie");
    expect(index.ALIYAH.lines.length).toBe(1);
    expect(index.AIDEN.meanWordsPerLine).toBeGreaterThan(0);
  });

  it("resolves aliases to canonical world characters", () => {
    const aliases: AliasMap = new Map([["MAXIMILIAN", "Max"]]);
    const index = buildCharacterLineIndex(corpus(), aliases);
    expect(index.MAX).toBeDefined();
    expect(index.MAX.name).toBe("Max");
    expect(index.MAX.lines[0].text).toBe("Something's blocking it.");
    expect(index.MAXIMILIAN).toBeUndefined();
  });

  it("samples longest + shortest lines and renders a voice block", () => {
    const index = buildCharacterLineIndex(corpus());
    const samples = sampleCharacterLines(index.AIDEN);
    expect(samples.length).toBeGreaterThan(0);
    expect(samples.some((s) => s.text === "What?")).toBe(true);

    const block = characterVoiceBlock(index.AIDEN);
    expect(block).toContain("AIDEN");
    expect(block).toContain("Real lines they have said:");
    expect(block).toContain('"What?" (Ep B)');
  });
});
