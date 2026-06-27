import { buildPrompt, type OrchestratorContext } from "./aiOrchestrator";
import { TextAiService } from "./textAiService";
import { cleanupGeneratedScreenplay } from "./generatedScriptCleanup";

// "Re-roll" a highlighted passage like Midjourney variations: regenerate it
// several times under the SAME constraints (KB, style, beats, series arcs/
// cliffhanger) but with different temperature weighting, so the user can pick the
// take they like. One single-call generation per variant, fired in parallel.

export interface ReRollVariant {
  id: number;
  temperature: number;
  label: string;
  text: string;
  error?: string;
}

const DEFAULT_TEMPS = [0.6, 0.85, 1.1];
const LABELS = ["Faithful", "Balanced", "Wild"];

/**
 * Generate re-roll variants for the current selection. Builds the prompt once
 * (re_roll mode, which carries the full OrchestratorContext including
 * seriesContext) and varies only the temperature per variant.
 */
export async function generateReRollVariants(
  ctx: OrchestratorContext,
  temps: number[] = DEFAULT_TEMPS,
): Promise<ReRollVariant[]> {
  const { system, user, maxTokens } = buildPrompt({ ...ctx, mode: "re_roll" });
  const names = ctx.knowledgeBase?.characters.map((c) => c.name) ?? [];
  const service = new TextAiService();

  return Promise.all(
    temps.map(async (temperature, id): Promise<ReRollVariant> => {
      const label = LABELS[id] ?? `Take ${id + 1}`;
      try {
        const raw = await service.complete(system, user, { temperature, maxTokens });
        return { id, temperature, label, text: cleanupGeneratedScreenplay(raw, names).trim() };
      } catch (e) {
        return { id, temperature, label, text: "", error: e instanceof Error ? e.message : "Re-roll failed" };
      }
    }),
  );
}
