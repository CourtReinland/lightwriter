// Calibration against the author's real produced corpus. The corpus lives on
// this machine only (it is the author's copyrighted work and is never
// committed); the whole suite skips when the directory is absent, so CI and
// other machines are unaffected.
import { describe, expect, it } from "vitest";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { compareToVoicePrint, computeVoicePrint, voicePrintToPromptBlock } from "./voiceMetricsService";

const PAIRS_DIR = "/Users/capricorn/Projects/lightwriter/docs/pairs";

// A competent-but-generic kids' scene: correct Fountain, correct beats,
// default LLM house style. The gate must tell this apart from the author.
const GENERIC_SCENE = `INT. KITCHEN - DAY

Warm sunlight streams through the window, illuminating the cozy kitchen where the aroma of freshly baked pie fills the air with an irresistible sweetness.

AIDEN
I understand that we should not eat the pie because it is meant for Aunt Connie's birthday celebration, but I must admit that the temptation is quite difficult to resist.

ALIYAH
You are absolutely right, and I believe that we should demonstrate self-control and respect our father's wishes in this matter.

AIDEN
Perhaps we could find something else in the refrigerator that would satisfy our craving for something sweet and delicious.

Aliyah nods thoughtfully, considering her brother's suggestion carefully as she walks gracefully toward the refrigerator and opens the door slowly.

ALIYAH
That is an excellent idea, and I am confident that we will find a suitable alternative that will not disappoint anyone.

The two siblings smile at each other warmly, having successfully navigated a moral dilemma together through communication and mutual understanding.
`;

const load = () =>
  readdirSync(PAIRS_DIR)
    .filter((f) => f.endsWith(".fountain"))
    .sort()
    .map((f) => ({ title: f.replace(/\.fountain$/, ""), text: readFileSync(join(PAIRS_DIR, f), "utf8") }));

describe.skipIf(!existsSync(PAIRS_DIR))("voice print calibration on the real corpus", () => {
  it("held-out author scripts score high; generic AI style scores markedly lower", () => {
    const scripts = load();
    expect(scripts.length).toBeGreaterThanOrEqual(10);

    const heldOutScores: number[] = [];
    for (let i = 0; i < scripts.length; i += 1) {
      const rest = scripts.filter((_, idx) => idx !== i);
      const print = computeVoicePrint(rest);
      const report = compareToVoicePrint(scripts[i].text, print);
      heldOutScores.push(report.score);
    }

    const fullPrint = computeVoicePrint(scripts);
    const generic = compareToVoicePrint(GENERIC_SCENE, fullPrint);
    const meanHeldOut = heldOutScores.reduce((a, b) => a + b, 0) / heldOutScores.length;
    const minHeldOut = Math.min(...heldOutScores);

    // eslint-disable-next-line no-console
    console.log("held-out scores:", heldOutScores.map((s, i) => `${scripts[i].title.slice(0, 24)}=${s}`).join(", "));
    // eslint-disable-next-line no-console
    console.log(`mean held-out=${Math.round(meanHeldOut)} min=${minHeldOut} generic=${generic.score}`);
    // eslint-disable-next-line no-console
    console.log("generic deviations:", generic.deviations.map((d) => `${d.metric}: ${d.actual} vs ${d.expected}`).join(" | "));
    // eslint-disable-next-line no-console
    console.log("\n" + voicePrintToPromptBlock(fullPrint));

    expect(meanHeldOut).toBeGreaterThanOrEqual(70);
    expect(generic.score).toBeLessThan(minHeldOut);
    expect(meanHeldOut - generic.score).toBeGreaterThanOrEqual(20);
  });
});
