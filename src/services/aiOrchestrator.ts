import { GrokService } from "./grokService";
import { KnowledgeBaseService, type KnowledgeBase } from "./knowledgeBase";
import { StyleProfileService, type StyleProfile } from "./styleProfile";
import type { ComputedBeat } from "../frameworks/utils";

// ── Modes ──

export type OrchestratorMode =
  // Existing writing modes
  | "improve_dialogue"
  | "expand_scene"
  | "compress"
  | "alternative_line"
  | "add_action"
  | "fix_formatting"
  | "custom"
  // New writing modes
  | "smart_continue"
  | "scene_builder"
  | "character_voice"
  // Analysis modes
  | "instant_critique"
  | "plot_hole_check"
  | "beat_alignment_check";

export const ANALYSIS_MODES: OrchestratorMode[] = [
  "instant_critique",
  "plot_hole_check",
  "beat_alignment_check",
];

// ── Context ──

export interface OrchestratorContext {
  selectedText: string;
  surroundingContext: string;
  fullScript: string;
  cursorLine: number;
  cursorBeats: ComputedBeat[];
  knowledgeBase: KnowledgeBase | null;
  styleProfile: StyleProfile | null;
  mode: OrchestratorMode;
  customPrompt?: string;
  characterName?: string;
  characterNames?: string[]; // For scene builder: multiple characters
}

// ── Mode Configs ──

interface ModeConfig {
  taskPrompt: string;
  temperature: number;
  maxTokens: number;
  needsSelection: boolean;
  isAnalysis: boolean;
}

const MODE_CONFIGS: Record<OrchestratorMode, ModeConfig> = {
  improve_dialogue: {
    taskPrompt: "Improve this dialogue. Make it more natural, compelling, and character-specific. Return ONLY the improved dialogue in Fountain format.",
    temperature: 0.8, maxTokens: 2048, needsSelection: true, isAnalysis: false,
  },
  expand_scene: {
    taskPrompt: "Expand this scene with more detail, action lines, and atmosphere. Return ONLY the expanded version in Fountain format.",
    temperature: 0.8, maxTokens: 2048, needsSelection: true, isAnalysis: false,
  },
  compress: {
    taskPrompt: "Compress this — make it tighter and more impactful. Return ONLY the compressed version in Fountain format.",
    temperature: 0.8, maxTokens: 2048, needsSelection: true, isAnalysis: false,
  },
  alternative_line: {
    taskPrompt: "Write 3 alternative versions numbered 1-3, each with a different tone. Return ONLY the alternatives in Fountain format.",
    temperature: 0.9, maxTokens: 2048, needsSelection: true, isAnalysis: false,
  },
  add_action: {
    taskPrompt: "Add vivid action/description lines to enhance visual storytelling. Return ONLY the enhanced version in Fountain format.",
    temperature: 0.8, maxTokens: 2048, needsSelection: true, isAnalysis: false,
  },
  fix_formatting: {
    taskPrompt: "Fix the Fountain formatting. Ensure proper scene headings, character names, dialogue, parentheticals, and transitions. Return ONLY the corrected Fountain text.",
    temperature: 0.3, maxTokens: 2048, needsSelection: true, isAnalysis: false,
  },
  custom: {
    taskPrompt: "", // Filled by customPrompt
    temperature: 0.8, maxTokens: 2048, needsSelection: true, isAnalysis: false,
  },
  smart_continue: {
    taskPrompt: "Continue writing the next 200-400 words from where the text ends. Match the established voice and pacing exactly. Write in proper Fountain screenplay format. Return ONLY the new screenplay text.",
    temperature: 0.85, maxTokens: 1024, needsSelection: false, isAnalysis: false,
  },
  scene_builder: {
    taskPrompt: "Generate a complete scene skeleton for this story beat. Include: scene heading, detailed action blocks, 2-3 meaningful dialogue exchanges, and clear emotional arc direction. Return ONLY the scene in Fountain format.",
    temperature: 0.8, maxTokens: 2048, needsSelection: false, isAnalysis: false,
  },
  character_voice: {
    taskPrompt: "Write dialogue for the specified character in this context. Match their established voice, speech patterns, and personality. Return ONLY the dialogue in Fountain format.",
    temperature: 0.75, maxTokens: 1024, needsSelection: true, isAnalysis: false,
  },
  instant_critique: {
    taskPrompt: `Analyze this screenplay section. Provide a structured critique with scores (1-10) for:
1. PACING — Is the rhythm effective? Too fast, too slow?
2. TENSION — Does the scene build and maintain dramatic tension?
3. DIALOGUE — Is it natural, subtext-rich, and character-specific?
4. CONSISTENCY — Does it fit the established story world?

For each, provide a score and 1-2 sentences of specific feedback. Then list 3 actionable improvement suggestions.

Format:
PACING: [score]/10
[feedback]

TENSION: [score]/10
[feedback]

DIALOGUE: [score]/10
[feedback]

CONSISTENCY: [score]/10
[feedback]

SUGGESTIONS:
1. [suggestion]
2. [suggestion]
3. [suggestion]`,
    temperature: 0.4, maxTokens: 1500, needsSelection: true, isAnalysis: true,
  },
  plot_hole_check: {
    taskPrompt: `Check this screenplay section for inconsistencies against the story knowledge base. Look for:
- Character contradictions (behavior, knowledge, or voice inconsistent with their profile)
- World rule violations (events that break established rules)
- Timeline issues (events out of order or impossible timing)
- Unresolved threads that should have been addressed by now
- Logic gaps

List each issue found. If none, say "No inconsistencies detected." Be specific with line references.`,
    temperature: 0.3, maxTokens: 2000, needsSelection: true, isAnalysis: true,
  },
  beat_alignment_check: {
    taskPrompt: `Evaluate how well this screenplay section serves its current story beat. Score 1-10.

Consider:
- Does the content fulfill the beat's dramatic purpose?
- Are the expected emotional and narrative elements present?
- What's accomplished? What's missing?
- Specific suggestions to better align with the beat.

Format:
BEAT: [beat name]
ALIGNMENT: [score]/10
ACCOMPLISHED: [what the section does well for this beat]
MISSING: [what's lacking]
SUGGESTIONS: [2-3 specific improvements]`,
    temperature: 0.3, maxTokens: 1000, needsSelection: true, isAnalysis: true,
  },
};

// ── Prompt Builder ──

const BASE_SYSTEM = `You are an expert screenwriting AI assistant integrated into a professional screenplay editor. You write in proper Fountain format. You are deeply familiar with story structure, character development, and screenplay craft.

CRITICAL RULES:
- For writing modes: Return ONLY the screenplay text itself. NO explanations, preamble, postamble, or commentary.
- For analysis modes: Return ONLY the structured analysis as instructed.
- Never use markdown code fences.
- Maintain consistency with the story's established world, characters, and tone.`;

export function buildPrompt(ctx: OrchestratorContext): {
  system: string;
  user: string;
  temperature: number;
  maxTokens: number;
} {
  const config = MODE_CONFIGS[ctx.mode];
  const sections: string[] = [BASE_SYSTEM];

  // Task instruction
  const task = ctx.mode === "custom" && ctx.customPrompt
    ? ctx.customPrompt
    : config.taskPrompt;
  sections.push(`\nTASK: ${task}`);

  // Style profile
  if (ctx.styleProfile) {
    sections.push("\n" + StyleProfileService.serializeForPrompt(ctx.styleProfile));
  }

  // Beat context
  if (ctx.cursorBeats.length > 0) {
    const beatLines = ctx.cursorBeats.map(b => {
      let line = `[${b.frameworkId.replace(/-/g, " ").toUpperCase()}] ${b.name} (pp ${b.startPage}-${b.endPage}): ${b.description}`;
      if (b.examples.length > 0) {
        line += `\nExamples: ${b.examples.slice(0, 2).join("; ")}`;
      }
      return line;
    });
    sections.push("\n=== CURRENT STORY BEAT ===\n" + beatLines.join("\n"));
  }

  // Character-specific context
  if (ctx.characterName && ctx.knowledgeBase) {
    const char = ctx.knowledgeBase.characters.find(
      c => c.name.toLowerCase() === ctx.characterName!.toLowerCase(),
    );
    if (char) {
      const traits = char.traits.length ? `Traits: ${char.traits.join(", ")}` : "";
      const voice = char.voiceNotes ? `Voice: ${char.voiceNotes}` : "";
      sections.push(`\n=== TARGET CHARACTER: ${char.name} ===\n${char.description}\n${traits}\n${voice}`);
    }
  }

  // Scene builder: multiple characters
  if (ctx.mode === "scene_builder" && ctx.characterNames && ctx.knowledgeBase) {
    const charDescs = ctx.characterNames.map(name => {
      const char = ctx.knowledgeBase!.characters.find(
        c => c.name.toLowerCase() === name.toLowerCase(),
      );
      return char ? `${char.name}: ${char.description} (${char.traits.slice(0, 3).join(", ")})` : name;
    });
    sections.push("\n=== CHARACTERS IN SCENE ===\n" + charDescs.join("\n"));
  }

  // Knowledge base (general)
  if (ctx.knowledgeBase) {
    // Extract mentioned character names from selected text
    const mentionedNames = ctx.knowledgeBase.characters
      .filter(c => ctx.selectedText.toUpperCase().includes(c.name.toUpperCase()) ||
                   ctx.surroundingContext.toUpperCase().includes(c.name.toUpperCase()))
      .map(c => c.name);

    const kbText = KnowledgeBaseService.serializeForPrompt(ctx.knowledgeBase, 8000, mentionedNames);
    if (kbText) {
      sections.push("\n" + kbText);
    }
  }

  const systemPrompt = sections.join("\n");

  // Build user message
  const userParts: string[] = [];

  if (ctx.surroundingContext && ctx.mode !== "smart_continue") {
    userParts.push(`Surrounding context:\n---\n${ctx.surroundingContext}\n---`);
  }

  if (ctx.selectedText && config.needsSelection) {
    userParts.push(`Selected text:\n---\n${ctx.selectedText}\n---`);
  } else if (ctx.mode === "smart_continue") {
    // For smart continue, use text before cursor
    const beforeCursor = ctx.fullScript.slice(
      Math.max(0, ctx.fullScript.length - 2000),
    );
    userParts.push(`Continue from here:\n---\n${beforeCursor}\n---`);
  }

  if (ctx.mode === "custom" && ctx.customPrompt) {
    userParts.push(`\nInstruction: ${ctx.customPrompt}`);
  }

  return {
    system: systemPrompt,
    user: userParts.join("\n\n"),
    temperature: config.temperature,
    maxTokens: config.maxTokens,
  };
}

// ── Generate ──

export async function generate(
  ctx: OrchestratorContext,
  apiKey: string,
): Promise<string> {
  const { system, user, temperature, maxTokens } = buildPrompt(ctx);

  const service = new GrokService(apiKey);
  return service.complete(system, user, { temperature, maxTokens });
}

export function isAnalysisMode(mode: OrchestratorMode): boolean {
  return ANALYSIS_MODES.includes(mode);
}
