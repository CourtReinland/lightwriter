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

export interface KBToneStyle {
  genre: string;
  mood: string;
  pacingNotes: string;
}

export interface KBCustomNote {
  id: string;
  title: string;
  content: string;
}

export interface KnowledgeBase {
  projectId: string;
  characters: KBCharacter[];
  worldRules: KBWorldRule[];
  plotThreads: KBPlotThread[];
  toneStyle: KBToneStyle;
  customNotes: KBCustomNote[];
  updatedAt: number;
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
    worldRules: [],
    plotThreads: [],
    toneStyle: { genre: "", mood: "", pacingNotes: "" },
    customNotes: [],
    updatedAt: Date.now(),
  };
}

export class KnowledgeBaseService {
  static getKB(projectId: string): KnowledgeBase {
    try {
      const raw = localStorage.getItem(storageKey(projectId));
      if (raw) return JSON.parse(raw) as KnowledgeBase;
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
    if (kb.toneStyle.genre || kb.toneStyle.mood) {
      addSection("TONE & STYLE",
        `Genre: ${kb.toneStyle.genre || "N/A"}\nMood: ${kb.toneStyle.mood || "N/A"}\nPacing: ${kb.toneStyle.pacingNotes || "N/A"}`);
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

    const response = await fetch("https://api.x.ai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: "grok-3-mini-fast",
        messages: [
          {
            role: "system",
            content: `You are a screenplay analysis tool. Extract story elements from the screenplay and return ONLY a valid JSON object with this exact structure:
{
  "characters": [{ "name": "string", "description": "string", "traits": ["string"], "voiceNotes": "string", "relationships": [{ "characterName": "string", "description": "string" }] }],
  "worldRules": [{ "category": "setting|magic|technology|time_period|other", "title": "string", "description": "string" }],
  "plotThreads": [{ "title": "string", "status": "unresolved|foreshadowed|resolved", "description": "string" }],
  "toneStyle": { "genre": "string", "mood": "string", "pacingNotes": "string" }
}
Return ONLY the JSON. No markdown. No explanation.`,
          },
          {
            role: "user",
            content: `Analyze this screenplay and extract all characters, world rules, plot threads, and tone:\n\n${truncated}`,
          },
        ],
        temperature: 0.3,
        max_tokens: 4096,
      }),
    });

    if (!response.ok) throw new Error(`Scan failed: ${response.status}`);
    const data = await response.json();
    const text = data.choices?.[0]?.message?.content ?? "";

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
