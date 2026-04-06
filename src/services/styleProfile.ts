// ── Style Profile Types ──

export interface StyleProfile {
  projectId: string;
  avgSentenceLength: number;
  sentenceLengthVariance: string; // "low" | "medium" | "high"
  vocabularyComplexity: string; // "simple" | "moderate" | "literary"
  predominantTone: string;
  pov: string;
  tense: string;
  dialogueToActionRatio: string;
  sampleExcerpts: string[];
  rawAnalysis: string;
  updatedAt: number;
}

// ── Service ──

function storageKey(projectId: string): string {
  return `lw-style-${projectId}`;
}

export class StyleProfileService {
  static getProfile(projectId: string): StyleProfile | null {
    try {
      const raw = localStorage.getItem(storageKey(projectId));
      if (raw) return JSON.parse(raw) as StyleProfile;
    } catch {
      // corrupt
    }
    return null;
  }

  static saveProfile(profile: StyleProfile): void {
    profile.updatedAt = Date.now();
    localStorage.setItem(storageKey(profile.projectId), JSON.stringify(profile));
  }

  static deleteProfile(projectId: string): void {
    localStorage.removeItem(storageKey(projectId));
  }

  /**
   * Analyze a writing sample to extract style metrics.
   */
  static async analyzeStyle(
    sampleText: string,
    projectId: string,
    apiKey: string,
  ): Promise<StyleProfile> {
    const truncated = sampleText.length > 20000 ? sampleText.slice(0, 20000) : sampleText;

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
            content: `You are a writing style analyst. Analyze the writing sample and return ONLY a valid JSON object:
{
  "avgSentenceLength": number,
  "sentenceLengthVariance": "low"|"medium"|"high",
  "vocabularyComplexity": "simple"|"moderate"|"literary",
  "predominantTone": "string describing the overall tone",
  "pov": "first person"|"second person"|"third person limited"|"third person omniscient",
  "tense": "past"|"present"|"mixed",
  "dialogueToActionRatio": "dialogue-heavy"|"balanced"|"action-heavy"|"minimal dialogue",
  "rawAnalysis": "A 2-3 sentence description of the writer's distinctive style characteristics, voice, and tendencies"
}
Return ONLY JSON. No markdown. No explanation.`,
          },
          {
            role: "user",
            content: `Analyze the writing style of this text:\n\n${truncated}`,
          },
        ],
        temperature: 0.3,
        max_tokens: 1024,
      }),
    });

    if (!response.ok) throw new Error(`Style analysis failed: ${response.status}`);
    const data = await response.json();
    const text = data.choices?.[0]?.message?.content ?? "";

    try {
      const cleaned = text.replace(/^```(?:json)?\s*\n?/i, "").replace(/\n?```\s*$/i, "").trim();
      const parsed = JSON.parse(cleaned);

      // Keep a short excerpt for reference
      const excerpt = truncated.slice(0, 300).trim();

      return {
        projectId,
        avgSentenceLength: parsed.avgSentenceLength || 15,
        sentenceLengthVariance: parsed.sentenceLengthVariance || "medium",
        vocabularyComplexity: parsed.vocabularyComplexity || "moderate",
        predominantTone: parsed.predominantTone || "neutral",
        pov: parsed.pov || "third person limited",
        tense: parsed.tense || "past",
        dialogueToActionRatio: parsed.dialogueToActionRatio || "balanced",
        sampleExcerpts: [excerpt],
        rawAnalysis: parsed.rawAnalysis || "",
        updatedAt: Date.now(),
      };
    } catch {
      throw new Error("Failed to parse style analysis. Try again.");
    }
  }

  /**
   * Serialize style profile into natural-language prompt instructions.
   */
  static serializeForPrompt(profile: StyleProfile): string {
    const lines = [
      "=== WRITING STYLE GUIDELINES ===",
      `Tone: ${profile.predominantTone}`,
      `POV: ${profile.pov}, Tense: ${profile.tense}`,
      `Sentence style: avg ${profile.avgSentenceLength} words, ${profile.sentenceLengthVariance} variance`,
      `Vocabulary: ${profile.vocabularyComplexity}`,
      `Dialogue ratio: ${profile.dialogueToActionRatio}`,
    ];
    if (profile.rawAnalysis) {
      lines.push(`Voice: ${profile.rawAnalysis}`);
    }
    if (profile.sampleExcerpts.length > 0) {
      lines.push(`Reference excerpt: "${profile.sampleExcerpts[0].slice(0, 200)}..."`);
    }
    return lines.join("\n");
  }
}
