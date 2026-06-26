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

describe("expandScriptToTargetPages (plan-then-write)", () => {
  it("plans new scenes, writes each, and inserts after the named slugline", async () => {
    // One mock for both phases: the PLAN prompt asks for {"newScenes":...}; any
    // other call is a per-scene write that returns Fountain.
    const mockComplete = async (_system: string, user: string) => {
      if (user.includes('"newScenes"')) {
        return '{"newScenes":[{"insert_after":"INT. ROOM - DAY","beat":"Need","synopsis":"Jess discovers a clue.","pages":2}]}';
      }
      const body = Array.from({ length: 60 }, (_, i) => `Jess searches the room. Beat ${i}.`).join("\n");
      return `INT. NEWSCENE - DAY\n\n${body}`;
    };

    const res = await expandScriptToTargetPages(
      SCRIPT,
      { targetPages: 3, knowledgeBase: null, styleProfile: null },
      undefined,
      mockComplete,
    );

    expect(res.endPages).toBeGreaterThan(res.startPages);
    expect(res.passes).toBeGreaterThanOrEqual(1);
    // The new scene was inserted AFTER INT. ROOM and BEFORE EXT. STREET.
    const idxRoom = res.script.indexOf("INT. ROOM - DAY");
    const idxNew = res.script.indexOf("INT. NEWSCENE - DAY");
    const idxStreet = res.script.indexOf("EXT. STREET - DAY");
    expect(idxRoom).toBeGreaterThanOrEqual(0);
    expect(idxRoom).toBeLessThan(idxNew);
    expect(idxNew).toBeLessThan(idxStreet);
  });

  it("returns the original and warns when planning yields no scenes", async () => {
    const res = await expandScriptToTargetPages(
      SCRIPT,
      { targetPages: 20, knowledgeBase: null, styleProfile: null },
      undefined,
      async () => "{}",
    );
    expect(res.script).toBe(SCRIPT);
    expect(res.warnings.some((w) => /target/i.test(w))).toBe(true);
  });

  it("no-ops when already at the target length", async () => {
    let called = false;
    const res = await expandScriptToTargetPages(
      SCRIPT,
      { targetPages: 1, knowledgeBase: null, styleProfile: null },
      undefined,
      async () => {
        called = true;
        return "{}";
      },
    );
    expect(called).toBe(false);
    expect(res.script).toBe(SCRIPT);
  });
});
