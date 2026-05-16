export type AssetPromptSourceKind = "scene_set" | "character" | "shot";

export type AssetPromptDrafts = Record<string, string>;

export function promptDraftKey(sourceKind: AssetPromptSourceKind, index: number | string): string {
  return `${sourceKind}:${index}`;
}

export function mergeReviewedPromptDrafts(
  currentDrafts: AssetPromptDrafts,
  sourceKind: AssetPromptSourceKind,
  prompts: string[],
): AssetPromptDrafts {
  return prompts.reduce<AssetPromptDrafts>(
    (next, prompt, index) => ({
      ...next,
      [promptDraftKey(sourceKind, index)]: prompt,
    }),
    { ...currentDrafts },
  );
}
