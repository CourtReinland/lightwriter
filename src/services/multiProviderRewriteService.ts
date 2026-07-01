import { TextAiService, type TextCompleteOptions } from "./textAiService";
import { getTextAiProviderSettings, textAiProviderLabel, type TextAiProvider } from "./textAiSettingsService";
import { parseRewriteResponse } from "./scriptReportCardService";

// Runs ONE rewrite prompt across several providers IN PARALLEL (each its own
// "engine"), scores each result, and ranks them best-first — so the user gets
// the strongest of N takes instead of a single provider's one shot. Mirrors the
// reRollService fan-out, swapping temperatures for providers.

export interface RewriteCandidate {
  provider: TextAiProvider;
  providerLabel: string;
  /** Full rewritten script. Empty when this provider errored. */
  afterScript: string;
  changeSummary: string[];
  warnings: string[];
  /** Metric score of afterScript (null if scoring was skipped or failed). */
  score: number | null;
  error?: string;
}

export interface MultiRewriteResult {
  /** Sorted best-first (highest score; scored before unscored; errored last). */
  candidates: RewriteCandidate[];
  best: RewriteCandidate | null;
}

export type ProviderCompletion = (provider: TextAiProvider, system: string, user: string, options?: TextCompleteOptions) => Promise<string>;

/** Selected providers that actually have an API key configured. */
export function providersWithKeys(providers: TextAiProvider[]): TextAiProvider[] {
  return providers.filter((p) => getTextAiProviderSettings(p).apiKey.trim());
}

export async function runMultiProviderRewrite(args: {
  providers: TextAiProvider[];
  prompt: { system: string; user: string; temperature: number; maxTokens: number };
  /** Score a candidate's full script for the target metric (0-100). Optional. */
  scoreCandidate?: (afterScript: string) => Promise<number | null>;
  onProgress?: (msg: string) => void;
  /** Test seam: run completions without real network calls. */
  completeOverride?: ProviderCompletion;
  /** Max providers to fan out to (default 4). */
  maxProviders?: number;
}): Promise<MultiRewriteResult> {
  const active = providersWithKeys(args.providers).slice(0, args.maxProviders ?? 4);
  if (!active.length) throw new Error("None of the selected providers has an API key configured. Add a key in Settings.");

  const { system, user, temperature, maxTokens } = args.prompt;

  // 1. Fan out the rewrite across providers concurrently.
  const settled = await Promise.allSettled(
    active.map(async (provider): Promise<RewriteCandidate> => {
      args.onProgress?.(`Rewriting with ${textAiProviderLabel(provider)}…`);
      const raw = args.completeOverride
        ? await args.completeOverride(provider, system, user, { temperature, maxTokens })
        : await TextAiService.forProvider(provider).complete(system, user, { temperature, maxTokens });
      const parsed = parseRewriteResponse(raw);
      return {
        provider,
        providerLabel: textAiProviderLabel(provider),
        afterScript: parsed.rewrittenScript,
        changeSummary: parsed.changeSummary,
        warnings: parsed.warnings,
        score: null,
      };
    }),
  );

  const candidates: RewriteCandidate[] = settled.map((r, i) =>
    r.status === "fulfilled"
      ? r.value
      : {
          provider: active[i],
          providerLabel: textAiProviderLabel(active[i]),
          afterScript: "",
          changeSummary: [],
          warnings: [],
          score: null,
          error: r.reason instanceof Error ? r.reason.message : String(r.reason),
        },
  );

  const ok = candidates.filter((c) => !c.error && c.afterScript.trim());
  if (!ok.length) {
    throw new Error(candidates.find((c) => c.error)?.error ?? "Every provider failed to produce a rewrite.");
  }

  // 2. Score each successful candidate (concurrently) so we can rank them.
  if (args.scoreCandidate) {
    await Promise.all(
      ok.map(async (c) => {
        args.onProgress?.(`Scoring ${c.providerLabel}…`);
        try {
          c.score = await args.scoreCandidate!(c.afterScript);
        } catch {
          c.score = null;
        }
      }),
    );
  }

  // 3. Rank best-first.
  candidates.sort((a, b) => {
    if (Boolean(a.error) !== Boolean(b.error)) return a.error ? 1 : -1;
    return (b.score ?? -1) - (a.score ?? -1);
  });

  const best = candidates.find((c) => !c.error && c.afterScript.trim()) ?? null;
  return { candidates, best };
}
