import { beforeEach, describe, expect, it } from "vitest";
import {
  GreenRoomStore,
  buildCharacterSystemPrompt,
  characterReply,
  dossiersPromptBlock,
  draftDossier,
} from "./greenRoomService";
import { VoiceCorpusStore } from "./voiceCorpusStore";

function installLocalStorage() {
  const store = new Map<string, string>();
  (globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
    clear: () => void store.clear(),
  };
}

const EP = `Title: Ep A

INT. KITCHEN - DAY

AIDEN
Pie! I want the whole thing right now.

AIDEN
What?

ALIYAH
Ooh that smells delicious.
`;

describe("GreenRoomStore", () => {
  beforeEach(installLocalStorage);

  it("dossier CRUD with ensure semantics", () => {
    const d = GreenRoomStore.ensureDossier("s1", "Aiden");
    expect(d.id).toBeTruthy();
    expect(GreenRoomStore.ensureDossier("s1", "aiden").id).toBe(d.id); // case-insensitive
    d.want = "the pie";
    GreenRoomStore.saveDossier(d);
    expect(GreenRoomStore.getDossier("s1", "AIDEN")?.want).toBe("the pie");
    GreenRoomStore.deleteDossier("s1", d.id);
    expect(GreenRoomStore.getDossier("s1", "Aiden")).toBeNull();
  });

  it("chat persistence per character", () => {
    GreenRoomStore.appendMessage("s1", "Aiden", { role: "author", text: "hey", at: 1 });
    GreenRoomStore.appendMessage("s1", "Aiden", { role: "character", text: "hey yourself", at: 2 });
    expect(GreenRoomStore.getChat("s1", "Aiden")).toHaveLength(2);
    expect(GreenRoomStore.getChat("s1", "Max")).toHaveLength(0);
    GreenRoomStore.clearChat("s1", "Aiden");
    expect(GreenRoomStore.getChat("s1", "Aiden")).toHaveLength(0);
  });
});

describe("buildCharacterSystemPrompt", () => {
  beforeEach(installLocalStorage);

  it("grounds the agent in dossier + real lines + rules", () => {
    VoiceCorpusStore.addScripts("s1", [{ title: "Ep A", text: EP }]);
    const d = GreenRoomStore.ensureDossier("s1", "AIDEN");
    d.want = "to win";
    d.secret = "ate the pie";
    d.selfLie = "I can stop any time";
    d.memory = "The author showed me a storyboard once.";
    GreenRoomStore.saveDossier(d);

    const system = buildCharacterSystemPrompt("s1", "AIDEN");
    expect(system).toContain("You ARE AIDEN");
    expect(system).toContain("What you want: to win");
    expect(system).toContain("ate the pie");
    expect(system).toContain("YOU SAID THAT");
    expect(system).toContain('"What?" (Ep A)');
    expect(system).toContain("WHAT YOU REMEMBER");
    expect(system).toContain("I wouldn't say that");
  });
});

describe("characterReply", () => {
  beforeEach(installLocalStorage);

  it("answers in character, persists both turns, and threads the transcript", async () => {
    GreenRoomStore.appendMessage("s1", "Aiden", { role: "author", text: "How was the take?", at: 1 });
    GreenRoomStore.appendMessage("s1", "Aiden", { role: "character", text: "Which take?", at: 2 });

    let seenSystem = "";
    let seenUser = "";
    const reply = await characterReply("s1", "Aiden", "The pie scene.", {
      complete: async (system, user) => {
        seenSystem = system;
        seenUser = user;
        return "Oh. THAT take. I regret nothing.";
      },
    });
    expect(reply).toBe("Oh. THAT take. I regret nothing.");
    expect(seenSystem).toContain("You ARE Aiden");
    expect(seenUser).toContain("AUTHOR: How was the take?");
    expect(seenUser).toContain("AIDEN: Which take?");
    expect(seenUser).toContain("AUTHOR: The pie scene.");
    const chat = GreenRoomStore.getChat("s1", "Aiden");
    expect(chat).toHaveLength(4);
    expect(chat[3]).toMatchObject({ role: "character", text: "Oh. THAT take. I regret nothing." });
  });

  it("distills old messages into dossier memory past the threshold", async () => {
    for (let i = 0; i < 50; i += 1) {
      GreenRoomStore.appendMessage("s1", "Aiden", { role: i % 2 ? "character" : "author", text: `msg ${i}`, at: i });
    }
    const reply = await characterReply("s1", "Aiden", "Still with me?", {
      complete: async (system) =>
        /long-term memory/i.test(system) ? "I remember the author walked me through fifty ideas." : "Yeah. Barely.",
    });
    expect(reply).toBe("Yeah. Barely.");
    expect(GreenRoomStore.getDossier("s1", "Aiden")?.memory).toContain("fifty ideas");
    expect(GreenRoomStore.getChat("s1", "Aiden").length).toBeLessThanOrEqual(28);
  });
});

describe("draftDossier / dossiersPromptBlock", () => {
  beforeEach(installLocalStorage);

  it("drafts from evidence and stores editable fields", async () => {
    VoiceCorpusStore.addScripts("s1", [{ title: "Ep A", text: EP }]);
    const d = await draftDossier("s1", "AIDEN", {
      complete: async (_s, user) => {
        expect(user).toContain("THEIR REAL LINES");
        return JSON.stringify({
          lifeStory: "Youngest in the family; competitive since the crib.",
          want: "to win; underneath, to be seen",
          secret: "he ate the pie",
          selfLie: "one bite doesn't count",
          voiceNotes: "short bursts, exclamations",
        });
      },
    });
    expect(d.secret).toBe("he ate the pie");
    expect(GreenRoomStore.getDossier("s1", "AIDEN")?.selfLie).toBe("one bite doesn't count");
  });

  it("compiles a subtext block for the room, skipping empty dossiers", () => {
    const a = GreenRoomStore.ensureDossier("s1", "Aiden");
    a.want = "to win";
    a.secret = "ate the pie";
    GreenRoomStore.saveDossier(a);
    GreenRoomStore.ensureDossier("s1", "Empty");

    const block = dossiersPromptBlock("s1");
    expect(block).toContain("CHARACTER DOSSIERS");
    expect(block).toContain("AIDEN — wants: to win; hides: ate the pie");
    expect(block).not.toContain("EMPTY");
    expect(dossiersPromptBlock(undefined)).toBe("");
    expect(dossiersPromptBlock("s2")).toBe("");
  });
});
