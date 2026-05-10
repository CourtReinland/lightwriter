import { TextAiService } from "./textAiService";
import { extractCharacters, type ScriptCharacterRef } from "./scriptStructure";

interface ParsedCharacter {
  name?: string;
  description?: string;
  evidence?: string[];
}

function cleanJson(text: string): string {
  return text
    .trim()
    .replace(/^```(?:json)?\s*\n?/i, "")
    .replace(/\n?```\s*$/i, "")
    .trim();
}

function normalizeName(name: string): string {
  return name.replace(/\s+/g, " ").trim().toUpperCase();
}

function isPlausibleCharacterName(name: string): boolean {
  const normalized = normalizeName(name);
  if (!normalized) return false;
  if (normalized.length > 36) return false;
  if (/^(INT|EXT|EST|CUT TO|FADE|DISSOLVE|SMASH CUT|MATCH CUT)\b/.test(normalized)) return false;
  if (/^(CU|MS|WS|ECU|OTS|POV|WIDE SHOT|MEDIUM SHOT|CLOSE UP|TRACKING|PAN|TILT|INSERT)\b/.test(normalized)) return false;
  if (/\b(SHOT|CLOSE UP|WIDE|MEDIUM|CAMERA|AISLE|LIBRARY|BOOK|COVER|GLOWS|DUSTY)\b/.test(normalized) && normalized.split(/\s+/).length > 2) return false;
  return /^[A-Z][A-Z0-9 '\-.]*(?:\s+[A-Z][A-Z0-9 '\-.]*)*$/.test(normalized);
}

function parseCharacterJson(text: string): ParsedCharacter[] {
  const parsed = JSON.parse(cleanJson(text));
  if (Array.isArray(parsed)) return parsed as ParsedCharacter[];
  if (Array.isArray(parsed.characters)) return parsed.characters as ParsedCharacter[];
  return [];
}

export function normalizeParsedCharacters(characters: ParsedCharacter[]): ScriptCharacterRef[] {
  const byName = new Map<string, ScriptCharacterRef>();

  for (const character of characters) {
    const name = normalizeName(String(character.name || ""));
    if (!isPlausibleCharacterName(name) || byName.has(name)) continue;
    byName.set(name, {
      name,
      description: String(character.description || "").trim(),
      firstLine: byName.size + 1,
      evidence: Array.isArray(character.evidence) ? character.evidence.map(String).filter(Boolean).slice(0, 3) : [],
    });
  }

  return Array.from(byName.values());
}

export async function parseCharactersWithTextAi(script: string, service = new TextAiService()): Promise<ScriptCharacterRef[]> {
  const truncated = script.length > 60000 ? script.slice(0, 60000) : script;
  const system = `You are a screenplay character parser. Extract ONLY real speaking or described story characters from the screenplay.
Return ONLY valid JSON with this shape:
{"characters":[{"name":"CHARACTER NAME","description":"short visual/personality description from script context","evidence":["brief source line"]}]}

Rules:
- Include character cue names such as AIDEN, ALIYAH, MAYA.
- Include explicitly described characters such as ALEX (30s, restless eyes).
- Exclude shot directions, camera terms, scene headings, props, locations, transitions, and descriptive fragments.
- Do not invent names. Use uppercase names.`;

  const text = await service.complete(system, `Extract screenplay characters from this script:\n---\n${truncated}\n---`, {
    temperature: 0.1,
    maxTokens: 2048,
  });

  const parsed = normalizeParsedCharacters(parseCharacterJson(text));
  return parsed.length > 0 ? parsed : extractCharacters(script);
}
