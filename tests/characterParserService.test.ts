import { describe, expect, it, vi } from "vitest";
import { normalizeParsedCharacters, parseCharactersWithTextAi } from "../src/services/characterParserService";

class FakeTextAiService {
  complete = vi.fn();
}

describe("characterParserService", () => {
  it("normalizes LLM character JSON and rejects camera/shot fragments", () => {
    const characters = normalizeParsedCharacters([
      { name: "Aiden", description: "earnest student" },
      { name: "GLOWS WITH A CERTAIN CHARACTER", description: "bad fragment" },
      { name: "CU CLOSE UP ALIYAH", description: "camera line" },
      { name: "Aliyah", description: "skeptical friend" },
      { name: "AIDEN", description: "duplicate" },
    ]);

    expect(characters.map((character) => character.name)).toEqual(["AIDEN", "ALIYAH"]);
    expect(characters[0].description).toBe("earnest student");
  });

  it("fires the selected text AI parser and uses its clean character names", async () => {
    const service = new FakeTextAiService();
    service.complete.mockResolvedValue(JSON.stringify({
      characters: [
        { name: "AIDEN", description: "earnest student", evidence: ["AIDEN"] },
        { name: "ALIYAH", description: "skeptical friend", evidence: ["ALIYAH"] },
      ],
    }));

    const characters = await parseCharactersWithTextAi("ALIYAH\nWhy are we here?", service as never);

    expect(service.complete).toHaveBeenCalledTimes(1);
    expect(service.complete.mock.calls[0][0]).toContain("screenplay character parser");
    expect(characters.map((character) => character.name)).toEqual(["AIDEN", "ALIYAH"]);
  });
});
