import { TextAiService } from "./textAiService";

// ── Style Profile Types ──

export interface StyleSample {
  id: string;
  filename: string;
  kind: "txt" | "fountain" | "pdf" | "docx" | "xlsx" | "xls" | "csv" | "other";
  wordCount: number;
  excerpt: string;
  importedAt: number;
}

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
  samples?: StyleSample[];
  voiceFingerprint?: string;
  actionLineStyle?: string;
  dialogueStyle?: string;
  humorProfile?: string;
  imageryProfile?: string;
  emotionalRegister?: string;
  pacingProfile?: string;
  doRules?: string[];
  avoidRules?: string[];
  styleContract?: string;
  confidenceScore?: number;
}

export interface AnalyzeStyleSampleInput {
  filename: string;
  kind: StyleSample["kind"];
  text: string;
}

// ── Service ──

function storageKey(projectId: string): string {
  return `lw-style-${projectId}`;
}

function uid(): string {
  return `style_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function wordCount(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

function normalizeSamples(samples: AnalyzeStyleSampleInput[]): AnalyzeStyleSampleInput[] {
  return samples
    .map((sample) => ({ ...sample, text: sample.text.trim() }))
    .filter((sample) => sample.text.length > 0);
}

function sampleKindFromFilename(filename: string): StyleSample["kind"] {
  const lower = filename.toLowerCase();
  if (lower.endsWith(".txt")) return "txt";
  if (lower.endsWith(".fountain")) return "fountain";
  if (lower.endsWith(".pdf")) return "pdf";
  if (lower.endsWith(".docx")) return "docx";
  if (lower.endsWith(".xlsx")) return "xlsx";
  if (lower.endsWith(".xls")) return "xls";
  if (lower.endsWith(".csv")) return "csv";
  return "other";
}

function buildSampleMetadata(samples: AnalyzeStyleSampleInput[]): StyleSample[] {
  return samples.map((sample) => ({
    id: uid(),
    filename: sample.filename,
    kind: sample.kind || sampleKindFromFilename(sample.filename),
    wordCount: wordCount(sample.text),
    excerpt: sample.text.slice(0, 600).trim(),
    importedAt: Date.now(),
  }));
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
   * Backward-compatible one-sample analyzer.
   */
  static async analyzeStyle(
    sampleText: string,
    projectId: string,
    _apiKey?: string,
  ): Promise<StyleProfile> {
    return this.analyzeSamples([{ filename: "Pasted sample", kind: "txt", text: sampleText }], projectId);
  }

  /**
   * Analyze one or more writing samples and turn them into an enforceable style contract.
   */
  static async analyzeSamples(
    sampleInputs: AnalyzeStyleSampleInput[],
    projectId: string,
  ): Promise<StyleProfile> {
    const samples = normalizeSamples(sampleInputs);
    if (samples.length === 0) throw new Error("Add at least one writing sample before analyzing style.");

    const combined = samples
      .map((sample, index) => `--- SAMPLE ${index + 1}: ${sample.filename} (${sample.kind}) ---\n${sample.text.slice(0, 14000)}`)
      .join("\n\n")
      .slice(0, 45000);

    const system = `You are a screenplay writing-style analyst. Analyze the supplied writing samples and return ONLY a valid JSON object.

The goal is not a vague summary. Build an enforceable style contract that a later screenwriting model can follow to write new scenes that still feel like this writer.

Return this exact JSON shape:
{
  "avgSentenceLength": number,
  "sentenceLengthVariance": "low"|"medium"|"high",
  "vocabularyComplexity": "simple"|"moderate"|"literary",
  "predominantTone": "string",
  "pov": "first person"|"second person"|"third person limited"|"third person omniscient"|"screenplay objective"|"mixed",
  "tense": "past"|"present"|"mixed",
  "dialogueToActionRatio": "dialogue-heavy"|"balanced"|"action-heavy"|"minimal dialogue",
  "voiceFingerprint": "specific rhythm, diction, syntax, and observational habits",
  "actionLineStyle": "how action/description lines work in this writer's voice",
  "dialogueStyle": "how characters tend to speak, including subtext and line length",
  "humorProfile": "humor style or 'minimal'",
  "imageryProfile": "sensory and visual tendencies",
  "emotionalRegister": "how directly emotion is stated versus implied",
  "pacingProfile": "scene rhythm and escalation habits",
  "doRules": ["5-8 concrete rules to imitate the writer's own style"],
  "avoidRules": ["5-8 concrete things that would break the writer's style"],
  "styleContract": "A compact 8-12 sentence directive for future LLM writing passes. It must be specific and actionable.",
  "confidenceScore": number,
  "rawAnalysis": "2-4 sentence human-readable summary"
}
Return ONLY JSON. No markdown. No explanation.`;

    const text = await TextAiService.forAnalyst().complete(
      system,
      `Analyze these writing samples and create the style contract:\n\n${combined}`,
      { temperature: 0.25, maxTokens: 2600 },
    );

    try {
      const cleaned = text.replace(/^```(?:json)?\s*\n?/i, "").replace(/\n?```\s*$/i, "").trim();
      const parsed = JSON.parse(cleaned);
      const metadata = buildSampleMetadata(samples);
      const excerpts = metadata.map((sample) => sample.excerpt).filter(Boolean).slice(0, 5);

      return {
        projectId,
        avgSentenceLength: Number(parsed.avgSentenceLength) || 15,
        sentenceLengthVariance: parsed.sentenceLengthVariance || "medium",
        vocabularyComplexity: parsed.vocabularyComplexity || "moderate",
        predominantTone: parsed.predominantTone || "neutral",
        pov: parsed.pov || "screenplay objective",
        tense: parsed.tense || "present",
        dialogueToActionRatio: parsed.dialogueToActionRatio || "balanced",
        sampleExcerpts: excerpts,
        rawAnalysis: parsed.rawAnalysis || "",
        updatedAt: Date.now(),
        samples: metadata,
        voiceFingerprint: parsed.voiceFingerprint || "",
        actionLineStyle: parsed.actionLineStyle || "",
        dialogueStyle: parsed.dialogueStyle || "",
        humorProfile: parsed.humorProfile || "",
        imageryProfile: parsed.imageryProfile || "",
        emotionalRegister: parsed.emotionalRegister || "",
        pacingProfile: parsed.pacingProfile || "",
        doRules: Array.isArray(parsed.doRules) ? parsed.doRules.map(String).slice(0, 10) : [],
        avoidRules: Array.isArray(parsed.avoidRules) ? parsed.avoidRules.map(String).slice(0, 10) : [],
        styleContract: parsed.styleContract || "",
        confidenceScore: Number(parsed.confidenceScore) || 0,
      };
    } catch {
      throw new Error("Failed to parse style analysis. Try again.");
    }
  }

  /**
   * Serialize style profile into natural-language prompt instructions.
   */
  static serializeForPrompt(profile: StyleProfile, targetStyle?: string): string {
    const lines = [
      "=== STYLE CONTRACT ===",
      "Primary rule: preserve the writer's own voice. Use any target/director style as a controlled influence, not a parody and not a replacement for the writer's style.",
      `Tone: ${profile.predominantTone}`,
      `POV: ${profile.pov}, Tense: ${profile.tense}`,
      `Sentence rhythm: avg ${profile.avgSentenceLength} words, ${profile.sentenceLengthVariance} variance`,
      `Vocabulary: ${profile.vocabularyComplexity}`,
      `Dialogue/action ratio: ${profile.dialogueToActionRatio}`,
    ];

    if (targetStyle?.trim()) {
      lines.push(`Target/director style directive: ${targetStyle.trim()}`);
      lines.push("Translate the target style into concrete craft choices while keeping characters, plot facts, and the writer's underlying voice intact.");
    }
    if (profile.styleContract) lines.push(`Contract: ${profile.styleContract}`);
    if (profile.voiceFingerprint) lines.push(`Voice fingerprint: ${profile.voiceFingerprint}`);
    if (profile.actionLineStyle) lines.push(`Action-line style: ${profile.actionLineStyle}`);
    if (profile.dialogueStyle) lines.push(`Dialogue style: ${profile.dialogueStyle}`);
    if (profile.humorProfile) lines.push(`Humor: ${profile.humorProfile}`);
    if (profile.imageryProfile) lines.push(`Imagery: ${profile.imageryProfile}`);
    if (profile.emotionalRegister) lines.push(`Emotion/subtext: ${profile.emotionalRegister}`);
    if (profile.pacingProfile) lines.push(`Pacing: ${profile.pacingProfile}`);
    if (profile.rawAnalysis) lines.push(`Summary: ${profile.rawAnalysis}`);
    if (profile.doRules?.length) lines.push(`Do: ${profile.doRules.join("; ")}`);
    if (profile.avoidRules?.length) lines.push(`Avoid: ${profile.avoidRules.join("; ")}`);
    if (profile.sampleExcerpts.length > 0) {
      lines.push("Reference excerpts:");
      profile.sampleExcerpts.slice(0, 3).forEach((excerpt, index) => {
        lines.push(`${index + 1}. "${excerpt.slice(0, 280)}${excerpt.length > 280 ? "..." : ""}"`);
      });
    }
    return lines.join("\n");
  }
}

export function inferStyleSampleKind(filename: string): StyleSample["kind"] {
  return sampleKindFromFilename(filename);
}
