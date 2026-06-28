import type { Project } from "./storageService";
import type { GeneratedAsset } from "../types/assets";
import { simpleScriptHash } from "./scriptStructure";
import { WorldStateService, listSceneHeadings, type WorldLocation } from "./worldStateService";

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
  /** The screenplay this manifest belongs to — links the manifest to the script. */
  screenplay?: { script_hash: string; project_name: string; fountain: string };
  /** Series this script belongs to (portable World State). */
  series_name?: string;
  characters: Record<string, { reference_image_path?: string; visual_prompt?: string; voice_id?: string; voice_provider?: string; voice_samples: string[]; world_character_key?: string }>;
  locations: Record<string, Record<string, unknown>>;
  /** Shared location library keyed by stable stsLocationKey, so the same location resolves identically across scripts in a series. */
  world_locations?: Record<string, Record<string, unknown>>;
  /** Shared, portable character library keyed by stable stsCharacterKey — pre-populates the characters ScriptToScreen detects. */
  world_characters?: Record<string, Record<string, unknown>>;
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
  project: Project;
  assets: GeneratedAsset[];
}): Script2ScreenManifest {
  const manifest: Script2ScreenManifest = {
    version: 1,
    resolve_project_name: args.project.name,
    screenplay: {
      script_hash: simpleScriptHash(args.project.content),
      project_name: args.project.name,
      fountain: args.project.content,
    },
    characters: {},
    locations: {},
    generated_media: {},
  };
  const warnings: string[] = [];

  const seriesId = args.project.seriesId;
  if (seriesId) {
    manifest.series_name = WorldStateService.getSeries(seriesId)?.name;
  }

  // 0-based scene index -> heading, so a shot can resolve its scene's location.
  const headingByIndex = new Map<number, string>();
  for (const s of listSceneHeadings(args.project.content)) headingByIndex.set(s.index, s.heading);
  const sceneReferenceForIndex = (sceneIndex: number | undefined): WorldLocation | null => {
    if (!seriesId || sceneIndex === undefined) return null;
    return WorldStateService.resolveLocationForScene(args.project.id, seriesId, sceneIndex, headingByIndex.get(sceneIndex) || "");
  };

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
    // The shot's scene reference (its world location image), so a provider that
    // accepts a scene reference alongside character references gets BOTH per shot.
    const shotLocation = sceneReferenceForIndex(asset.scriptRef.sceneIndex);
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
      scene_reference_path: shotLocation?.referenceFilePath || "",
      world_location_key: shotLocation?.stsLocationKey || "",
      file_path: asset.filePath,
      generated_at: new Date(asset.createdAt).toISOString(),
      lightwriter_script_ref: asset.scriptRef,
    };
  }

  // World State: resolve each scene to its portable series location (binding
  // first, else alias match), build a shared world_locations{} library keyed by
  // the stable stsLocationKey, and tag each scene's locations{} entry with it —
  // so the same location resolves identically across every script in the series.
  if (seriesId) {
    for (const scene of listSceneHeadings(args.project.content)) {
      const loc: WorldLocation | null = WorldStateService.resolveLocationForScene(
        args.project.id,
        seriesId,
        scene.index,
        scene.heading,
      );
      if (!loc) continue;

      manifest.world_locations ??= {};
      if (!manifest.world_locations[loc.stsLocationKey]) {
        const entry: Record<string, unknown> = {
          name: loc.name,
          category: loc.category,
          aliases: loc.aliases,
          description: loc.description,
          reference_image_path: loc.referenceFilePath || "",
        };
        if (!loc.referenceFilePath && loc.referenceImageDataUrl) {
          entry.reference_image_data_url = loc.referenceImageDataUrl;
          warnings.push(`World location "${loc.name}" reference image has no saved file path yet (re-save it in the desktop app to persist).`);
        } else if (!loc.referenceFilePath && !loc.referenceImageDataUrl) {
          warnings.push(`World location "${loc.name}" has no reference image yet.`);
        }
        manifest.world_locations[loc.stsLocationKey] = entry;
      }

      const sceneKey = String(scene.index);
      const existing = manifest.locations[sceneKey] || {};
      manifest.locations[sceneKey] = {
        ...existing,
        world_location_key: loc.stsLocationKey,
        world_location_name: loc.name,
        lightwriter_world_location_id: loc.id,
        description: (existing.description as string) || loc.description || scene.heading,
        reference_image_paths:
          (existing.reference_image_paths as string[]) || (loc.referenceFilePath ? [loc.referenceFilePath] : []),
        file_path: (existing.file_path as string) || loc.referenceFilePath || "",
      };
    }

    // Portable series CHARACTERS: a shared world_characters{} library keyed by the
    // stable stsCharacterKey, and a by-name/alias pre-population of characters{} so
    // ScriptToScreen's detected characters arrive with their reference image. A
    // generated character ASSET for the same name (set above) keeps precedence.
    for (const c of WorldStateService.listCharacters(seriesId)) {
      const refPath = c.referenceFilePath || "";
      manifest.world_characters ??= {};
      const entry: Record<string, unknown> = {
        name: c.name,
        aliases: c.aliases,
        description: c.description,
        traits: c.traits || [],
        reference_image_path: refPath,
      };
      if (!refPath && c.referenceImageDataUrl) {
        entry.reference_image_data_url = c.referenceImageDataUrl;
        warnings.push(`Series character "${c.name}" reference image has no saved file path yet (re-save it in the desktop app to persist).`);
      } else if (!refPath && !c.referenceImageDataUrl) {
        warnings.push(`Series character "${c.name}" has no reference image yet.`);
      }
      manifest.world_characters[c.stsCharacterKey] = entry;

      // Pre-populate the by-name map for every cue spelling (name + aliases).
      for (const key of [c.name.toUpperCase(), ...c.aliases.map((a) => a.toUpperCase())]) {
        const existing = manifest.characters[key];
        if (!existing) {
          manifest.characters[key] = {
            reference_image_path: refPath || "",
            visual_prompt: c.description,
            voice_samples: [],
            world_character_key: c.stsCharacterKey,
          };
        } else {
          // First world character to claim a cue spelling owns it; don't let a
          // later alias collision silently repoint the key or portrait.
          if (!existing.world_character_key) existing.world_character_key = c.stsCharacterKey;
          if (!existing.reference_image_path && refPath) existing.reference_image_path = refPath;
        }
      }
    }
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
