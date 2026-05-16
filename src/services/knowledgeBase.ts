import { TextAiService } from "./textAiService";
import type { GeneratedAsset } from "../types/assets";

// ── Knowledge Base Types ──

export interface KBCharacter {
  id: string;
  name: string;
  description: string;
  traits: string[];
  voiceNotes: string;
  relationships: { characterName: string; description: string }[];
}

export interface KBWorldRule {
  id: string;
  category: "setting" | "magic" | "technology" | "time_period" | "other";
  title: string;
  description: string;
}

export interface KBPlotThread {
  id: string;
  title: string;
  status: "unresolved" | "foreshadowed" | "resolved";
  description: string;
}

export interface KBScene {
  id: string;
  heading: string;
  sceneIndex?: number;
  description: string;
}

export interface KBToneStyle {
  genre: string;
  mood: string;
  pacingNotes: string;
  targetStyle: string;
  styleNotes: string;
}

export interface KBCustomNote {
  id: string;
  title: string;
  content: string;
}

export interface KnowledgeBase {
  projectId: string;
  characters: KBCharacter[];
  scenes: KBScene[];
  worldRules: KBWorldRule[];
  plotThreads: KBPlotThread[];
  toneStyle: KBToneStyle;
  customNotes: KBCustomNote[];
  updatedAt: number;
}


export type ImportedPlotThread = Omit<KBPlotThread, "id">;

function normalizePlotStatus(value: string): KBPlotThread["status"] {
  const normalized = value.trim().toLowerCase();
  if (normalized === "resolved") return "resolved";
  if (normalized === "foreshadowed" || normalized === "foreshadow") return "foreshadowed";
  return "unresolved";
}

function splitTableLine(line: string): string[] {
  return line.split(/	|,(?=(?:[^"]*"[^"]*")*[^"]*$)/).map((cell) => cell.trim().replace(/^"|"$/g, ""));
}

function headerIndex(headers: string[], candidates: string[]): number {
  return headers.findIndex((header) => candidates.some((candidate) => header.includes(candidate)));
}

export function parsePlotThreadsFromTableText(text: string): ImportedPlotThread[] {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("# Sheet:"));
  if (!lines.length) return [];

  const firstRawCells = splitTableLine(lines[0]);
  const firstCells = firstRawCells.map((cell) => cell.toLowerCase());
  const titleHeaderIndex = headerIndex(firstCells, ["thread", "plot", "title", "storyline", "arc"]);
  const descriptionHeaderIndex = headerIndex(firstCells, ["description", "summary", "notes", "context", "detail"]);
  const statusHeaderIndex = headerIndex(firstCells, ["status", "state"]);
  const hasHeader = titleHeaderIndex >= 0 || descriptionHeaderIndex >= 0 || statusHeaderIndex >= 0;

  const rows = hasHeader ? lines.slice(1) : lines;
  const threads: ImportedPlotThread[] = [];
  for (const row of rows) {
    const cells = splitTableLine(row);
    if (!cells.some(Boolean)) continue;

    const title = (hasHeader ? cells[titleHeaderIndex >= 0 ? titleHeaderIndex : 0] : cells[0])?.trim() || "";
    if (!title) continue;

    const statusCell = hasHeader && statusHeaderIndex >= 0 ? cells[statusHeaderIndex] : cells.length >= 3 ? cells[1] : "";
    const status = normalizePlotStatus(statusCell || "");
    const descriptionCell = hasHeader && descriptionHeaderIndex >= 0
      ? cells[descriptionHeaderIndex]
      : cells.length >= 3
        ? cells.slice(2).filter(Boolean).join(" ")
        : cells.slice(1).filter(Boolean).join(" ");

    const extraNotes = hasHeader
      ? cells
          .map((cell, index) => ({ cell, index }))
          .filter(({ cell, index }) => cell && index !== titleHeaderIndex && index !== statusHeaderIndex && index !== descriptionHeaderIndex)
          .map(({ cell, index }) => `${firstRawCells[index] || `Column ${index + 1}`}: ${cell}`)
      : [];

    threads.push({
      title,
      status,
      description: [descriptionCell, ...extraNotes].filter(Boolean).join(" ").trim(),
    });
  }
  return threads;
}

// ── Service ──

let _uid = 0;
function uid(): string {
  return `kb_${Date.now()}_${++_uid}`;
}

function storageKey(projectId: string): string {
  return `lw-kb-${projectId}`;
}

function emptyKB(projectId: string): KnowledgeBase {
  return {
    projectId,
    characters: [],
    scenes: [],
    worldRules: [],
    plotThreads: [],
    toneStyle: { genre: "", mood: "", pacingNotes: "", targetStyle: "", styleNotes: "" },
    customNotes: [],
    updatedAt: Date.now(),
  };
}

export class KnowledgeBaseService {
  static getKB(projectId: string): KnowledgeBase {
    try {
      const raw = localStorage.getItem(storageKey(projectId));
      if (raw) {
        const parsed = JSON.parse(raw) as KnowledgeBase;
        const empty = emptyKB(projectId);
        return {
          ...empty,
          ...parsed,
          scenes: parsed.scenes || [],
          toneStyle: { ...empty.toneStyle, ...(parsed.toneStyle || {}) },
        };
      }
    } catch {
      // corrupt data
    }
    return emptyKB(projectId);
  }

  static saveKB(kb: KnowledgeBase): void {
    kb.updatedAt = Date.now();
    localStorage.setItem(storageKey(kb.projectId), JSON.stringify(kb));
  }

  // ── Character CRUD ──
  static addCharacter(kb: KnowledgeBase, char: Omit<KBCharacter, "id">): KnowledgeBase {
    return { ...kb, characters: [...kb.characters, { ...char, id: uid() }] };
  }
  static updateCharacter(kb: KnowledgeBase, id: string, updates: Partial<KBCharacter>): KnowledgeBase {
    return { ...kb, characters: kb.characters.map(c => c.id === id ? { ...c, ...updates } : c) };
  }
  static deleteCharacter(kb: KnowledgeBase, id: string): KnowledgeBase {
    return { ...kb, characters: kb.characters.filter(c => c.id !== id) };
  }

  // ── Scene CRUD ──
  static addScene(kb: KnowledgeBase, scene: Omit<KBScene, "id">): KnowledgeBase {
    return { ...kb, scenes: [...(kb.scenes || []), { ...scene, id: uid() }] };
  }
  static updateScene(kb: KnowledgeBase, id: string, updates: Partial<KBScene>): KnowledgeBase {
    return { ...kb, scenes: (kb.scenes || []).map(s => s.id === id ? { ...s, ...updates } : s) };
  }
  static deleteScene(kb: KnowledgeBase, id: string): KnowledgeBase {
    return { ...kb, scenes: (kb.scenes || []).filter(s => s.id !== id) };
  }

  static mergeGeneratedAssets(kb: KnowledgeBase, assets: GeneratedAsset[]): KnowledgeBase {
    let updated = { ...kb, scenes: kb.scenes || [] };
    for (const asset of assets) {
      if (asset.kind === "character") {
        const name = asset.scriptRef.characterName || asset.name;
        if (!name.trim()) continue;
        const existing = updated.characters.find(c => c.name.toLowerCase() === name.toLowerCase());
        if (!existing) {
          updated = this.addCharacter(updated, {
            name,
            description: asset.scriptRef.contentExcerpt || asset.prompt,
            traits: [],
            voiceNotes: "",
            relationships: [],
          });
        } else if (!existing.description.trim() && (asset.scriptRef.contentExcerpt || asset.prompt)) {
          updated = this.updateCharacter(updated, existing.id, { description: asset.scriptRef.contentExcerpt || asset.prompt });
        }
      }
      if (asset.kind === "scene_set") {
        const heading = asset.scriptRef.sceneHeading || asset.name;
        if (!heading.trim()) continue;
        const existing = updated.scenes.find(s => s.sceneIndex === asset.scriptRef.sceneIndex || s.heading.toLowerCase() === heading.toLowerCase());
        if (!existing) {
          updated = this.addScene(updated, {
            heading,
            sceneIndex: asset.scriptRef.sceneIndex,
            description: asset.scriptRef.contentExcerpt || asset.prompt,
          });
        } else if (!existing.description.trim() && (asset.scriptRef.contentExcerpt || asset.prompt)) {
          updated = this.updateScene(updated, existing.id, { description: asset.scriptRef.contentExcerpt || asset.prompt });
        }
      }
    }
    return updated;
  }

  // ── World Rule CRUD ──
  static addWorldRule(kb: KnowledgeBase, rule: Omit<KBWorldRule, "id">): KnowledgeBase {
    return { ...kb, worldRules: [...kb.worldRules, { ...rule, id: uid() }] };
  }
  static updateWorldRule(kb: KnowledgeBase, id: string, updates: Partial<KBWorldRule>): KnowledgeBase {
    return { ...kb, worldRules: kb.worldRules.map(r => r.id === id ? { ...r, ...updates } : r) };
  }
  static deleteWorldRule(kb: KnowledgeBase, id: string): KnowledgeBase {
    return { ...kb, worldRules: kb.worldRules.filter(r => r.id !== id) };
  }

  // ── Plot Thread CRUD ──
  static addPlotThread(kb: KnowledgeBase, thread: Omit<KBPlotThread, "id">): KnowledgeBase {
    return { ...kb, plotThreads: [...kb.plotThreads, { ...thread, id: uid() }] };
  }
  static updatePlotThread(kb: KnowledgeBase, id: string, updates: Partial<KBPlotThread>): KnowledgeBase {
    return { ...kb, plotThreads: kb.plotThreads.map(t => t.id === id ? { ...t, ...updates } : t) };
  }
  static deletePlotThread(kb: KnowledgeBase, id: string): KnowledgeBase {
    return { ...kb, plotThreads: kb.plotThreads.filter(t => t.id !== id) };
  }

  static mergePlotThreads(kb: KnowledgeBase, threads: ImportedPlotThread[]): KnowledgeBase {
    let updated = kb;
    for (const thread of threads) {
      const title = thread.title.trim();
      if (!title) continue;
      const exists = updated.plotThreads.some((existing) => existing.title.trim().toLowerCase() === title.toLowerCase());
      if (!exists) {
        updated = this.addPlotThread(updated, {
          title,
          status: thread.status,
          description: thread.description.trim(),
        });
      }
    }
    return updated;
  }

  // ── Custom Note CRUD ──
  static addCustomNote(kb: KnowledgeBase, note: Omit<KBCustomNote, "id">): KnowledgeBase {
    return { ...kb, customNotes: [...kb.customNotes, { ...note, id: uid() }] };
  }
  static updateCustomNote(kb: KnowledgeBase, id: string, updates: Partial<KBCustomNote>): KnowledgeBase {
    return { ...kb, customNotes: kb.customNotes.map(n => n.id === id ? { ...n, ...updates } : n) };
  }
  static deleteCustomNote(kb: KnowledgeBase, id: string): KnowledgeBase {
    return { ...kb, customNotes: kb.customNotes.filter(n => n.id !== id) };
  }

  // ── Tone/Style ──
  static updateToneStyle(kb: KnowledgeBase, updates: Partial<KBToneStyle>): KnowledgeBase {
    return { ...kb, toneStyle: { ...kb.toneStyle, ...updates } };
  }

  /**
   * Serialize KB into text for LLM prompt injection.
   * Prioritizes characters mentioned in the selection.
   */
  static serializeForPrompt(kb: KnowledgeBase, maxChars = 8000, mentionedNames?: string[]): string {
    const sections: string[] = [];
    let used = 0;

    const addSection = (label: string, content: string) => {
      const block = `[${label}]\n${content}\n`;
      if (used + block.length <= maxChars) {
        sections.push(block);
        used += block.length;
      }
    };

    // Tone first (small)
    if (kb.toneStyle.genre || kb.toneStyle.mood || kb.toneStyle.pacingNotes || kb.toneStyle.targetStyle || kb.toneStyle.styleNotes) {
      addSection("TONE & STYLE",
        [
          `Genre: ${kb.toneStyle.genre || "N/A"}`,
          `Mood: ${kb.toneStyle.mood || "N/A"}`,
          `Pacing: ${kb.toneStyle.pacingNotes || "N/A"}`,
          kb.toneStyle.targetStyle ? `Target/director style: ${kb.toneStyle.targetStyle}` : "",
          kb.toneStyle.styleNotes ? `Style constraints: ${kb.toneStyle.styleNotes}` : "",
        ].filter(Boolean).join("\n"));
    }

    // Prioritize mentioned characters
    const mentioned = mentionedNames?.map(n => n.toUpperCase()) ?? [];
    const priorityChars = kb.characters.filter(c => mentioned.includes(c.name.toUpperCase()));
    const otherChars = kb.characters.filter(c => !mentioned.includes(c.name.toUpperCase()));

    for (const c of [...priorityChars, ...otherChars]) {
      const traits = c.traits.length ? `Traits: ${c.traits.join(", ")}` : "";
      const voice = c.voiceNotes ? `Voice: ${c.voiceNotes}` : "";
      const rels = c.relationships.length
        ? `Relationships: ${c.relationships.map(r => `${r.characterName} — ${r.description}`).join("; ")}`
        : "";
      addSection(`CHARACTER: ${c.name}`,
        [c.description, traits, voice, rels].filter(Boolean).join("\n"));
    }

    // Plot threads
    for (const t of kb.plotThreads) {
      addSection(`PLOT [${t.status.toUpperCase()}]: ${t.title}`, t.description);
    }

    // World rules
    for (const r of kb.worldRules) {
      addSection(`WORLD [${r.category.toUpperCase()}]: ${r.title}`, r.description);
    }

    // Custom notes
    for (const n of kb.customNotes) {
      addSection(`NOTE: ${n.title}`, n.content);
    }

    if (sections.length === 0) return "";
    return "=== STORY KNOWLEDGE BASE ===\n" + sections.join("\n");
  }

  /**
   * AI-powered script scanning to auto-extract KB entries.
   */
  static async scanScript(
    content: string,
    apiKey: string,
  ): Promise<Partial<KnowledgeBase>> {
    const truncated = content.length > 50000 ? content.slice(0, 50000) : content;

    const system = `You are a screenplay analysis tool. Extract story elements from the screenplay and return ONLY a valid JSON object with this exact structure:
{
  "characters": [{ "name": "string", "description": "string", "traits": ["string"], "voiceNotes": "string", "relationships": [{ "characterName": "string", "description": "string" }] }],
  "worldRules": [{ "category": "setting|magic|technology|time_period|other", "title": "string", "description": "string" }],
  "plotThreads": [{ "title": "string", "status": "unresolved|foreshadowed|resolved", "description": "string" }],
  "toneStyle": { "genre": "string", "mood": "string", "pacingNotes": "string", "targetStyle": "string", "styleNotes": "string" }
}
Return ONLY the JSON. No markdown. No explanation.`;

    const text = await new TextAiService().complete(
      system,
      `Analyze this screenplay and extract all characters, world rules, plot threads, and tone:\n\n${truncated}`,
      { temperature: 0.3, maxTokens: 4096 },
    );

    // Try to parse JSON from the response
    try {
      // Strip markdown code fences if present
      const cleaned = text.replace(/^```(?:json)?\s*\n?/i, "").replace(/\n?```\s*$/i, "").trim();
      const parsed = JSON.parse(cleaned);

      // Add IDs to parsed entries
      const result: Partial<KnowledgeBase> = {};
      if (parsed.characters) {
        result.characters = parsed.characters.map((c: Record<string, unknown>) => ({
          ...c, id: uid(),
          traits: c.traits || [],
          voiceNotes: c.voiceNotes || "",
          relationships: c.relationships || [],
        }));
      }
      if (parsed.worldRules) {
        result.worldRules = parsed.worldRules.map((r: Record<string, unknown>) => ({ ...r, id: uid() }));
      }
      if (parsed.plotThreads) {
        result.plotThreads = parsed.plotThreads.map((t: Record<string, unknown>) => ({ ...t, id: uid() }));
      }
      if (parsed.toneStyle) {
        result.toneStyle = parsed.toneStyle;
      }
      return result;
    } catch {
      throw new Error("Failed to parse AI response as JSON. Try again.");
    }
  }
}
