import { describe, it, expect } from "vitest";
import { expandScriptToTargetPages, parseInsertions } from "./scriptExpansionService";

const SCRIPT = `Title: T

INT. ROOM - DAY

Action.

JESS
Hi.

EXT. STREET - DAY

Walk.
`;

describe("parseInsertions", () => {
  it("parses {scenes:[...]}", () => {
    const r = parseInsertions('{"scenes":[{"insert_after":"INT. ROOM - DAY","beat":"Go","fountain":"INT. CAR - DAY\\n\\nDrive."}]}');
    expect(r).toHaveLength(1);
    expect(r[0].insert_after).toBe("INT. ROOM - DAY");
    expect(r[0].fountain).toContain("INT. CAR - DAY");
  });

  it("ignores non-JSON", () => {
    expect(parseInsertions("sorry, no scenes")).toEqual([]);
  });
});

describe("expandScriptToTargetPages", () => {
  it("inserts new scenes after the named slugline and grows toward the target", async () => {
    let n = 0;
    const mockComplete = async () => {
      n++;
      const body = Array.from({ length: 60 }, (_, i) => `new line ${n}.${i}`).join("\\n");
      return `{"scenes":[{"insert_after":"INT. ROOM - DAY","beat":"Need","fountain":"INT. NEW${n} - DAY\\n\\n${body}"}]}`;
    };

    const res = await expandScriptToTargetPages(
      SCRIPT,
      { targetPages: 3, knowledgeBase: null, styleProfile: null },
      undefined,
      mockComplete,
    );

    expect(res.endPages).toBeGreaterThan(res.startPages);
    expect(res.passes).toBeGreaterThanOrEqual(1);
    // First new scene was inserted AFTER INT. ROOM and BEFORE EXT. STREET.
    const idxRoom = res.script.indexOf("INT. ROOM - DAY");
    const idxNew = res.script.indexOf("INT. NEW1 - DAY");
    const idxStreet = res.script.indexOf("EXT. STREET - DAY");
    expect(idxRoom).toBeGreaterThanOrEqual(0);
    expect(idxRoom).toBeLessThan(idxNew);
    expect(idxNew).toBeLessThan(idxStreet);
  });

  it("stops cleanly when the model returns no scenes", async () => {
    const res = await expandScriptToTargetPages(
      SCRIPT,
      { targetPages: 20, knowledgeBase: null, styleProfile: null },
      undefined,
      async () => "{}",
    );
    expect(res.script).toBe(SCRIPT);
    expect(res.warnings.some((w) => /target/i.test(w))).toBe(true);
  });
});
