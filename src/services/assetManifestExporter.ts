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
  locations: Record<string, Record<string, unknown>>;
  generated_media: Record<string, Record<string, unknown>>;
  /** Non-canonical: assets that could not be exported (e.g. browser-mode with no durable file path). ScriptToScreen ignores unknown keys. */
  _lightwriter_warnings?: string[];
}

function shotKeyFor(asset: GeneratedAsset): string | undefined {
  return typeof asset.metadata.script2ScreenShotKey === "string"
    ? asset.metadata.script2ScreenShotKey
    : asset.scriptRef.sceneIndex !== undefined
      ? `s${asset.scriptRef.sceneIndex}_sh0`
      : undefined;
}

/** 0-based scene index as a string — the form ScriptToScreen's importer normalizes most cleanly into scene_style_reference_paths. */
function sceneKeyFor(asset: GeneratedAsset): string {
  if (typeof asset.metadata.script2ScreenSceneKey === "string" && asset.metadata.script2ScreenSceneKey) {
    return asset.metadata.script2ScreenSceneKey;
  }
  return String(asset.scriptRef.sceneIndex ?? 0);
}

function characterNamesFor(asset: GeneratedAsset): string[] {
  return asset.scriptRef.characterName ? [asset.scriptRef.characterName.toUpperCase()] : [];
}

function filenameForPath(filePath: string): string {
  return filePath.split(/[\\/]/).pop() || filePath;
}

function script2ScreenProviderFor(asset: GeneratedAsset): string {
  if (asset.provider === "gemini-nano-banana") return "gemini";
  if (asset.provider === "grok-imagine") return "grok";
  return asset.provider;
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
  const warnings: string[] = [];

  for (const asset of args.assets) {
    if (asset.kind === "character" && asset.scriptRef.characterName) {
      if (!asset.filePath) {
        warnings.push(`Character "${asset.scriptRef.characterName}" skipped: no durable image file path (generate/persist it in the desktop app before export).`);
        continue;
      }
      manifest.characters[asset.scriptRef.characterName.toUpperCase()] = {
        reference_image_path: asset.filePath,
        visual_prompt: asset.prompt,
        voice_samples: [],
      };
      continue;
    }

    // Scene backgrounds (scene_set) are per-scene LOCATION references, not shot start-frames.
    // ScriptToScreen reads manifest.locations into scene_style_reference_paths; routing a scene
    // background into generated_media with a full sN_sh0 shot key would wrongly bind it to shot 0.
    if (asset.kind === "scene_set") {
      const sceneLabel = asset.metadata.locationName || asset.scriptRef.sceneHeading || asset.name;
      if (!asset.filePath) {
        warnings.push(`Scene background "${sceneLabel}" skipped: no durable image file path (generate/persist it in the desktop app before export).`);
        continue;
      }
      const sceneKey = sceneKeyFor(asset);
      const stylePath = typeof asset.metadata.styleReferencePath === "string" ? asset.metadata.styleReferencePath : "";
      manifest.locations[sceneKey] = {
        reference_image_paths: [asset.filePath],
        file_path: asset.filePath,
        style_reference_path: stylePath,
        description: sceneLabel,
        lightwriter_asset_id: asset.id,
        lightwriter_script_ref: asset.scriptRef,
      };
      continue;
    }

    const shotKey = shotKeyFor(asset);
    if (!shotKey || !asset.filePath) {
      if (shotKey && !asset.filePath) {
        warnings.push(`Shot "${asset.name}" (${shotKey}) skipped: no durable image file path (generate/persist it in the desktop app before export).`);
      }
      continue;
    }

    const filename = filenameForPath(asset.filePath);
    manifest.generated_media[filename] = {
      type: "image",
      shot_key: shotKey,
      prompt: asset.prompt,
      provider: script2ScreenProviderFor(asset),
      provider_settings: {
        model: asset.model,
        aspect_ratio: asset.metadata.aspectRatio || "widescreen_16_9",
        lightwriter_asset_id: asset.id,
        source_provider: asset.provider,
      },
      style_reference_path: typeof asset.metadata.styleReferencePath === "string" ? asset.metadata.styleReferencePath : "",
      character_refs:
        asset.scriptRef.characterName && asset.filePath
          ? { [asset.scriptRef.characterName.toUpperCase()]: asset.filePath }
          : {},
      file_path: asset.filePath,
      generated_at: new Date(asset.createdAt).toISOString(),
      lightwriter_script_ref: asset.scriptRef,
    };
  }

  if (warnings.length > 0) {
    manifest._lightwriter_warnings = warnings;
  }

  return manifest;
}

/** Count assets that would be skipped on export because they lack a durable file path (browser mode). */
export function countUnexportableAssets(assets: GeneratedAsset[]): number {
  return assets.filter(
    (asset) =>
      (asset.kind === "character" || asset.kind === "scene_set" || asset.kind === "shot" || asset.kind === "prop") &&
      !asset.filePath,
  ).length;
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
