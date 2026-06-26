import { TextAiService } from "./textAiService";
import { getSelectedTextAiProviderSettings } from "./textAiSettingsService";
import { KnowledgeBaseService, type KnowledgeBase } from "./knowledgeBase";
import { StyleProfileService, type StyleProfile } from "./styleProfile";
import { cleanupGeneratedScreenplay } from "./generatedScriptCleanup";

export type GenerationUnit = "pages" | "words";

export interface PromptGenerationRequest {
  /** The writer's brief — what to write. */
  prompt: string;
  amount: number;
  unit: GenerationUnit;
  knowledgeBase?: KnowledgeBase | null;
  styleProfile?: StyleProfile | null;
  /** Existing text immediately before the cursor, so generation continues it. */
  precedingContext?: string;
}

// Rough screenplay density used to translate pages <-> words and size the
// output token budget. A script page is sparse (lots of whitespace), ~180-200
// words; we bias slightly long so the model doesn't stop short of the target.
const WORDS_PER_PAGE = 190;

// One screenplay word costs more output tokens than prose because of the
// frequent line breaks and ALL-CAPS cues; ~3 tokens/word is a safe budget.
function tokenBudgetForPages(pages: number): number {
  return Math.min(16000, Math.max(2048, Math.round(pages * WORDS_PER_PAGE * 3)));
}

export const SCREENPLAY_SYSTEM = `You are a professional screenwriter. Write an original screenplay in valid Fountain format following Hollywood screenplay conventions.

FORMAT RULES:
- Begin with a Fountain title page: lines "Title:", "Author:", "Draft date:", then a line containing only "====".
- Scene headings: INT. or EXT. LOCATION - TIME on their own line (e.g. EXT. ROOFTOP GARDEN - NIGHT).
- Action lines: present tense, visual, concise. Introduce each character in ALL CAPS on first appearance.
- Character cues: the speaking character's name in ALL CAPS on its own line, with their dialogue on the line(s) below.
- Parentheticals: short, in (parentheses) on their own line under the cue, only when needed.
- Transitions only when meaningful (CUT TO:, SMASH CUT TO:, FADE OUT.).

CRAFT RULES:
- Write real, fully dramatized scenes with concrete action and dialogue. Do NOT outline, summarize, or write "montage of..." placeholders.
- Every scene must advance the story with NEW information, location, or change. Never repeat a scene or restate the same beat with only minor variations.
- Give characters distinct voices. Show emotion through behavior, not narration.
- Return ONLY the screenplay text. No markdown, no code fences, no commentary, no notes.`;

/**
 * Generate fresh screenplay text from a free-form brief using the currently
 * selected WRITER model (e.g. SAO). This is a single, direct generation — it
 * does NOT run the scene-by-scene rewrite/analysis pipeline, so it isolates the
 * writer's raw output.
 */
export async function generateFromPrompt(req: PromptGenerationRequest): Promise<string> {
  const { prompt, amount, unit } = req;
  const pages = unit === "pages" ? amount : Math.max(1, Math.round(amount / WORDS_PER_PAGE));
  const approxWords = unit === "words" ? amount : Math.round(amount * WORDS_PER_PAGE);
  const maxTokens = tokenBudgetForPages(pages);

  const sections = [SCREENPLAY_SYSTEM];
  if (req.styleProfile) {
    sections.push("\n" + StyleProfileService.serializeForPrompt(req.styleProfile, req.knowledgeBase?.toneStyle?.targetStyle));
  }
  if (req.knowledgeBase) {
    const kb = KnowledgeBaseService.serializeForPrompt(req.knowledgeBase, 6000, []);
    if (kb) sections.push("\n" + kb);
  }
  const system = sections.join("\n");

  const lengthLine =
    unit === "pages"
      ? `TARGET LENGTH: approximately ${amount} script pages (~${approxWords} words of screenplay text). Develop the full story to fill this length — pace the beats so you neither rush the ending nor pad with repetition. Do not stop early.`
      : `TARGET LENGTH: approximately ${amount} words of screenplay text. Do not stop early or summarize.`;

  const userParts = [`BRIEF:\n${prompt.trim()}`, lengthLine];
  if (req.precedingContext && req.precedingContext.trim()) {
    userParts.push(
      `Continue naturally from the existing screenplay text below. Do NOT repeat any of it — pick up where it leaves off:\n---\n${req.precedingContext.slice(-4000)}\n---`,
    );
  }
  userParts.push("Write the screenplay now in Fountain format.");

  const service = new TextAiService(getSelectedTextAiProviderSettings());
  const raw = await service.complete(system, userParts.join("\n\n"), {
    temperature: 0.9,
    maxTokens,
    timeoutMs: 240_000,
  });
  const names = req.knowledgeBase?.characters.map((c) => c.name) ?? [];
  return cleanupGeneratedScreenplay(raw, names);
}
