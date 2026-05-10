import type { GeneratedAsset } from "../types/assets";
import type { KnowledgeBase, KBCharacter, KBScene } from "./knowledgeBase";

export interface AssetKnowledgeItem {
  asset: GeneratedAsset;
  title: string;
  description: string;
}

function normalize(value: string): string {
  return value.trim().toLowerCase();
}

export function characterDescriptionForAsset(asset: GeneratedAsset, characters: KBCharacter[]): string {
  const name = asset.scriptRef.characterName || asset.name;
  const match = characters.find((character) => normalize(character.name) === normalize(name));
  return match?.description || asset.scriptRef.contentExcerpt || asset.prompt;
}

export function sceneDescriptionForAsset(asset: GeneratedAsset, scenes: KBScene[]): string {
  const heading = asset.scriptRef.sceneHeading || asset.name;
  const sceneIndex = asset.scriptRef.sceneIndex;
  const match = scenes.find((scene) => scene.sceneIndex === sceneIndex || normalize(scene.heading) === normalize(heading));
  return match?.description || asset.scriptRef.contentExcerpt || asset.prompt;
}

export function buildAssetKnowledgeItems(assets: GeneratedAsset[], kb: KnowledgeBase, kind: "character" | "scene_set"): AssetKnowledgeItem[] {
  return assets
    .filter((asset) => asset.kind === kind)
    .map((asset) => ({
      asset,
      title: kind === "character" ? asset.scriptRef.characterName || asset.name : asset.scriptRef.sceneHeading || asset.name,
      description: kind === "character" ? characterDescriptionForAsset(asset, kb.characters) : sceneDescriptionForAsset(asset, kb.scenes || []),
    }));
}
