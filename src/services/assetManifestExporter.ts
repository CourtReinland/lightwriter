import type { Project } from "./storageService";
import type { GeneratedAsset } from "../types/assets";
import { simpleScriptHash } from "./scriptStructure";

export interface LightWriterPackageShot {
  shot_key: string;
  scene_index: number;
  shot_index: number;
  scene_heading?: string;
  image_prompt: string;
  start_image_path?: string;
  characters: string[];
  metadata: Record<string, unknown>;
}

export interface LightWriterPackage {
  package_version: 1;
  source_app: "LightWriter";
  generated_at: string;
  project: {
    id: string;
    name: string;
  };
  screenplay: {
    path?: string;
    script_hash: string;
  };
  resolve_project_name?: string;
  shots: LightWriterPackageShot[];
  characters: Record<string, { reference_image_path?: string; visual_prompt: string; metadata: Record<string, unknown> }>;
  assets: GeneratedAsset[];
}

export interface Script2ScreenManifest {
  version: 1;
  resolve_project_name: string;
  characters: Record<string, { reference_image_path?: string; visual_prompt?: string; voice_id?: string; voice_provider?: string; voice_samples: string[] }>;
  locations: Record<string, unknown>;
  generated_media: Record<string, Record<string, unknown>>;
}

function shotKeyFor(asset: GeneratedAsset): string | undefined {
  return typeof asset.metadata.script2ScreenShotKey === "string"
    ? asset.metadata.script2ScreenShotKey
    : asset.scriptRef.sceneIndex !== undefined
      ? `s${asset.scriptRef.sceneIndex}_sh0`
      : undefined;
}

function characterNamesFor(asset: GeneratedAsset): string[] {
  return asset.scriptRef.characterName ? [asset.scriptRef.characterName.toUpperCase()] : [];
}

export function buildLightWriterPackage(args: {
  project: Project;
  assets: GeneratedAsset[];
  scriptPath?: string;
  resolveProjectName?: string;
}): LightWriterPackage {
  const shots = args.assets
    .filter((asset) => asset.kind === "scene_set" || asset.kind === "shot")
    .map((asset) => {
      const shotKey = shotKeyFor(asset) || `s${asset.scriptRef.sceneIndex ?? 0}_sh0`;
      const [, shotIndexText] = shotKey.split("_sh");
      return {
        shot_key: shotKey,
        scene_index: asset.scriptRef.sceneIndex ?? 0,
        shot_index: Number(shotIndexText || 0),
        scene_heading: asset.scriptRef.sceneHeading,
        image_prompt: asset.prompt,
        start_image_path: asset.filePath,
        characters: characterNamesFor(asset),
        metadata: { lightwriter_asset_id: asset.id, ...asset.metadata },
      };
    });

  const characters = args.assets
    .filter((asset) => asset.kind === "character" && asset.scriptRef.characterName)
    .reduce<LightWriterPackage["characters"]>((acc, asset) => {
      acc[asset.scriptRef.characterName!.toUpperCase()] = {
        reference_image_path: asset.filePath,
        visual_prompt: asset.prompt,
        metadata: { lightwriter_asset_id: asset.id, ...asset.metadata },
      };
      return acc;
    }, {});

  return {
    package_version: 1,
    source_app: "LightWriter",
    generated_at: new Date().toISOString(),
    project: { id: args.project.id, name: args.project.name },
    screenplay: { path: args.scriptPath, script_hash: simpleScriptHash(args.project.content) },
    resolve_project_name: args.resolveProjectName,
    shots,
    characters,
    assets: args.assets,
  };
}

export function buildScript2ScreenManifest(args: {
  resolveProjectName: string;
  assets: GeneratedAsset[];
}): Script2ScreenManifest {
  const manifest: Script2ScreenManifest = {
    version: 1,
    resolve_project_name: args.resolveProjectName,
    characters: {},
    locations: {},
    generated_media: {},
  };

  for (const asset of args.assets) {
    if (asset.kind === "character" && asset.scriptRef.characterName) {
      manifest.characters[asset.scriptRef.characterName.toUpperCase()] = {
        reference_image_path: asset.filePath,
        visual_prompt: asset.prompt,
        voice_samples: [],
      };
      continue;
    }

    const shotKey = shotKeyFor(asset);
    if (!shotKey || !asset.filePath) continue;

    manifest.generated_media[`${shotKey}:lightwriter:image:${asset.id}`] = {
      type: "image",
      shot_key: shotKey,
      prompt: asset.prompt,
      provider: asset.provider,
      provider_settings: {
        model: asset.model,
        aspect_ratio: asset.metadata.aspectRatio || "widescreen_16_9",
        lightwriter_asset_id: asset.id,
      },
      file_path: asset.filePath,
      generated_at: new Date(asset.createdAt).toISOString(),
      lightwriter_script_ref: asset.scriptRef,
    };
  }

  return manifest;
}

export function exportJsonDownload(data: unknown, filename: string): void {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(url);
}
