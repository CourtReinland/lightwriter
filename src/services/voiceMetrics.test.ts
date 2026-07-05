import { describe, expect, it } from "vitest";
import {
  baseCharacterName,
  compareToVoicePrint,
  computeChannelStats,
  computeVoicePrint,
  deviationsToNotes,
  extractChannels,
  extractSignaturePhrases,
  voicePrintToPromptBlock,
} from "./voiceMetricsService";

// Traditional-format fixture (Moon Festival style).
const TRADITIONAL = `Title: Test Episode
Author: Court Reinland

EXT. COUNTRY ROAD - DAY

The family car is broken down. Aliyah stares at the engine.

ALIYAH
(loud whispering)
Can't you like, do something?! Like with your magic.

MAX
Something... something's blocking it.

ALIYAH
You can't fix it?

DAD
Sorry little lady, dad doesn't have tools up here. We have to call a tow.

ALIYAH
Ugh!? How long will that take?!

.CU SHOT OF A CLOCK FACE. THE HANDS TICK BY.

INT. KITCHEN - DAY

Mom comes over to comfort her.

MOM
Look, you're father is doing the best he can.

ALIYAH
Ugh...

CUT TO:

EXT. ROAD - NIGHT

They wait.
`;

// Producer-edition fixture (Sneaky Snake style).
const PRODUCER = `Title: Producer Test

INT. KITCHEN

!!WS DAD TAKING A PIE OUT OF THE OVEN

Dad takes a pie out of the oven.

!!CU DAD BREATHING IN THE AROMA

AIDEN
What's dad cooking? That smells so good.

AIDEN
Pie!

AIDEN THOUGHTS
Don't eat the apple pie. Don't eat the apple pie. Don't even think about pie.

ALIYAH
Ooh that smells delicious.

AIDEN
Dad says we can't have any, it's for Aunt Connie.
`;

describe("extractChannels", () => {
  it("splits a traditional script into channels with attribution", () => {
    const channels = extractChannels(TRADITIONAL);
    expect(channels.sluglines).toEqual(["EXT. COUNTRY ROAD - DAY", "INT. KITCHEN - DAY", "EXT. ROAD - NIGHT"]);
    expect(channels.sceneCount).toBe(3);
    expect(channels.transitions).toEqual(["CUT TO:"]);
    expect(channels.dialogue.map((d) => d.character)).toEqual(["ALIYAH", "MAX", "ALIYAH", "DAD", "ALIYAH", "MOM", "ALIYAH"]);
    expect(channels.dialogue[0].parentheticals).toEqual(["loud whispering"]);
    expect(channels.dialogue[0].text).toBe("Can't you like, do something?! Like with your magic.");
    expect(channels.actionBlocks.some((a) => a.includes("family car is broken down"))).toBe(true);
  });

  it("treats title-page keys as non-body and .CU forced lines as shots", () => {
    const channels = extractChannels(TRADITIONAL);
    expect(channels.shots).toEqual(["CU SHOT OF A CLOCK FACE. THE HANDS TICK BY."]);
    expect(channels.actionBlocks.some((a) => a.includes("Court Reinland"))).toBe(false);
  });

  it("handles producer-edition !! shot lines and cue variants", () => {
    const channels = extractChannels(PRODUCER);
    expect(channels.shots.length).toBe(2);
    expect(channels.shots[0]).toBe("WS DAD TAKING A PIE OUT OF THE OVEN");
    const thoughts = channels.dialogue.find((d) => d.character === "AIDEN THOUGHTS");
    expect(thoughts).toBeDefined();
    expect(thoughts!.baseCharacter).toBe("AIDEN");
  });

  it("does not mistake shot or transition lines for character cues", () => {
    const channels = extractChannels(PRODUCER);
    const cueNames = channels.dialogue.map((d) => d.baseCharacter);
    expect(cueNames).not.toContain("WS DAD TAKING A PIE OUT OF THE OVEN");
    expect(cueNames.every((n) => ["AIDEN", "ALIYAH"].includes(n))).toBe(true);
  });
});

describe("baseCharacterName", () => {
  it("strips stacked cue variants", () => {
    expect(baseCharacterName("AIDEN THOUGHTS")).toBe("AIDEN");
    expect(baseCharacterName("MAX V.O.")).toBe("MAX");
    expect(baseCharacterName("MOM CONT'D")).toBe("MOM");
    expect(baseCharacterName("ALIYAH")).toBe("ALIYAH");
  });
});

describe("computeChannelStats", () => {
  it("measures rhythm and texture", () => {
    const stats = computeChannelStats([
      "Can't you do something?! I'm gonna scream...",
      "Okay. Fine.",
    ]);
    expect(stats.sentenceCount).toBe(4);
    expect(stats.interrobangRate).toBeGreaterThan(0);
    expect(stats.ellipsisRate).toBeGreaterThan(0);
    expect(stats.contractionRate).toBeGreaterThan(0);
    expect(stats.shortSentenceRate).toBeGreaterThan(0);
  });

  it("counts caps emphasis and -ly adverbs", () => {
    const stats = computeChannelStats(["He SLOWLY walks away, sadly. This is HUGE."]);
    expect(stats.capsEmphasisRate).toBeGreaterThan(0);
    expect(stats.adverbLyRate).toBeGreaterThan(0);
  });
});

describe("extractSignaturePhrases", () => {
  it("finds phrases recurring across scripts and prefers the longest form", () => {
    const a = "You know what I mean. Sweet dreams are made. You know what I mean.";
    const b = "You know what I mean, buddy. Something else entirely here.";
    const phrases = extractSignaturePhrases([a, b]);
    expect(phrases.length).toBeGreaterThan(0);
    expect(phrases[0].phrase).toContain("know what");
    // The shorter contained bigram should have been swallowed by the longer phrase.
    const contained = phrases.filter((p) => "you know what i mean".includes(p.phrase));
    expect(contained.length).toBe(1);
  });

  it("drops pure-stopword grams", () => {
    const text = "of the and of the and of the and of the";
    expect(extractSignaturePhrases([text, text])).toEqual([]);
  });
});

describe("computeVoicePrint / compareToVoicePrint", () => {
  const corpus = [
    { title: "Ep A", text: TRADITIONAL },
    { title: "Ep B", text: PRODUCER },
  ];

  it("computes an aggregate print", () => {
    const print = computeVoicePrint(corpus);
    expect(print.scriptCount).toBe(2);
    expect(print.meanDialogueWordsPerCue).toBeGreaterThan(0);
    expect(print.dialogueShareOfWords).toBeGreaterThan(0);
    expect(print.dialogueShareOfWords).toBeLessThanOrEqual(1);
    expect(print.shotLinesPerScene).toBeGreaterThan(0);
  });

  it("scores corpus-like text high and alien text low", () => {
    const print = computeVoicePrint(corpus);
    const likeCorpus = compareToVoicePrint(TRADITIONAL, print);

    // Ornate, dialogue-free literary prose — nothing like the corpus.
    const alien = `INT. DRAWING ROOM - NIGHT

${Array(30)
  .fill(
    "The chandelier, resplendent and inexorably melancholic, cast its prodigiously intricate shadows across the damask wallpaper while the assembled company contemplated, with considerable and mounting trepidation, the ineffable strangeness of the evening's protracted and unsettling silence.",
  )
  .join("\n\n")}`;
    const alienReport = compareToVoicePrint(alien, print);

    expect(likeCorpus.score).toBeGreaterThan(alienReport.score);
    expect(alienReport.score).toBeLessThan(60);
    expect(alienReport.deviations.length).toBeGreaterThan(2);
  });

  it("flags low confidence on tiny samples", () => {
    const print = computeVoicePrint(corpus);
    const report = compareToVoicePrint("AIDEN\nHi.\n", print);
    expect(report.lowConfidence).toBe(true);
  });

  it("produces actionable deviation notes", () => {
    const print = computeVoicePrint(corpus);
    const talky = `INT. ROOM - DAY

MAX
${Array(20).fill("I have been thinking about the fundamental nature of our predicament and I believe that we must consider every possible avenue before committing ourselves to a course of action that we might later regret.").join(" ")}
`;
    const report = compareToVoicePrint(talky, print);
    const notes = deviationsToNotes(report);
    expect(notes.length).toBeGreaterThan(0);
    expect(notes[0]).toMatch(/measured .* vs the author's/);
  });
});

describe("voicePrintToPromptBlock", () => {
  it("serializes hard targets compactly", () => {
    const print = computeVoicePrint([
      { title: "Ep A", text: TRADITIONAL },
      { title: "Ep B", text: PRODUCER },
    ]);
    const block = voicePrintToPromptBlock(print);
    expect(block).toContain("VOICE PRINT");
    expect(block).toContain("words per speech");
    expect(block).toContain("Action lines");
    expect(block.length).toBeLessThan(2200);
  });
});
