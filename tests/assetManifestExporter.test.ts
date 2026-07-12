import { describe, expect, it, beforeEach } from "vitest";
import { buildScript2ScreenManifest, buildLightWriterPackage } from "../src/services/assetManifestExporter";
import { WorldStateService } from "../src/services/worldStateService";
import type { GeneratedAsset } from "../src/types/assets";

// Minimal in-memory localStorage so WorldStateService works in the node test env.
function installLocalStorage() {
  const store = new Map<string, string>();
  (globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
    clear: () => store.clear(),
  };
}

const assets: GeneratedAsset[] = [
  {
    id: "scene-asset",
    projectId: "project-1",
    kind: "scene_set",
    provider: "gemini-nano-banana",
    model: "gemini-2.5-flash-image",
    name: "Coffee Shop",
    prompt: "Cinematic coffee shop background",
    mimeType: "image/png",
    filePath: "/tmp/lightwriter/assets/images/s0_sh0_coffee.png",
    createdAt: 100,
    updatedAt: 100,
    scriptRef: {
      scriptHash: "script-hash",
      sceneHeading: "INT. COFFEE SHOP - DAY",
      sceneIndex: 0,
      sceneStartLine: 3,
      sceneEndLine: 10,
      contentExcerpt: "A cozy cafe.",
    },
    metadata: {
      promptVersion: 1,
      aspectRatio: "16:9",
      script2ScreenShotKey: "s0_sh0",
    },
  },
  {
    id: "character-asset",
    projectId: "project-1",
    kind: "character",
    provider: "grok-imagine",
    model: "grok-imagine-latest",
    name: "ALEX",
    prompt: "Character portrait for ALEX",
    mimeType: "image/png",
    filePath: "/tmp/lightwriter/assets/characters/alex.png",
    createdAt: 101,
    updatedAt: 101,
    scriptRef: {
      scriptHash: "script-hash",
      characterName: "ALEX",
      contentExcerpt: "ALEX (30s, restless eyes)",
    },
    metadata: { promptVersion: 1, aspectRatio: "2:3" },
  },
  {
    id: "shot-asset",
    projectId: "project-1",
    kind: "shot",
    provider: "gemini-nano-banana",
    model: "gemini-2.5-flash-image",
    name: "s0_sh1_alex_closeup",
    prompt: "CU on ALEX as she steels herself",
    mimeType: "image/png",
    filePath: "/tmp/lightwriter/assets/images/s0_sh1_alex_closeup.png",
    createdAt: 102,
    updatedAt: 102,
    scriptRef: {
      scriptHash: "script-hash",
      sceneHeading: "INT. COFFEE SHOP - DAY",
      sceneIndex: 0,
      characterName: "ALEX",
    },
    metadata: { promptVersion: 1, aspectRatio: "16:9", script2ScreenShotKey: "s0_sh1" },
  },
];

describe("asset manifest export", () => {
  it("builds a LightWriter package that links assets back to the script and Script2Screen shot keys", () => {
    const pkg = buildLightWriterPackage({
      project: { id: "project-1", name: "Pilot", content: "INT. COFFEE SHOP - DAY", targetPages: 30, activeFrameworks: [], createdAt: 1, updatedAt: 2 },
      assets,
      scriptPath: "/tmp/lightwriter/screenplay.fountain",
      resolveProjectName: "Pilot Resolve",
    });

    expect(pkg.source_app).toBe("LightWriter");
    expect(pkg.screenplay.path).toBe("/tmp/lightwriter/screenplay.fountain");
    expect(pkg.shots[0]).toMatchObject({ shot_key: "s0_sh0", scene_index: 0, start_image_path: "/tmp/lightwriter/assets/images/s0_sh0_coffee.png" });
    expect(pkg.characters.ALEX.reference_image_path).toBe("/tmp/lightwriter/assets/characters/alex.png");
  });

  it("routes scene backgrounds into locations and real shots into generated_media", () => {
    const manifest = buildScript2ScreenManifest({
      project: { id: "project-1", name: "Pilot Resolve", content: "INT. COFFEE SHOP - DAY", targetPages: 30, activeFrameworks: [], createdAt: 1, updatedAt: 2 },
      assets,
    });

    expect(manifest.version).toBe(1);

    // Scene background (scene_set) -> locations keyed by 0-based scene index, NOT generated_media.
    expect(manifest.generated_media["s0_sh0_coffee.png"]).toBeUndefined();
    expect(manifest.locations["0"]).toMatchObject({
      file_path: "/tmp/lightwriter/assets/images/s0_sh0_coffee.png",
      style_reference_path: "",
      description: "INT. COFFEE SHOP - DAY",
      reference_image_paths: ["/tmp/lightwriter/assets/images/s0_sh0_coffee.png"],
    });

    // Real shot asset -> generated_media keyed by filename.
    expect(manifest.generated_media["s0_sh1_alex_closeup.png"]).toMatchObject({
      type: "image",
      shot_key: "s0_sh1",
      provider: "gemini",
      file_path: "/tmp/lightwriter/assets/images/s0_sh1_alex_closeup.png",
    });
    expect(manifest.generated_media["s0_sh1_alex_closeup.png"].character_refs).toMatchObject({
      ALEX: "/tmp/lightwriter/assets/images/s0_sh1_alex_closeup.png",
    });

    // Characters still round-trip.
    expect(manifest.characters.ALEX).toMatchObject({
      reference_image_path: "/tmp/lightwriter/assets/characters/alex.png",
      visual_prompt: "Character portrait for ALEX",
    });
  });

  it("surfaces a warning instead of silently dropping browser-mode assets with no file path", () => {
    const manifest = buildScript2ScreenManifest({
      project: { id: "project-1", name: "Pilot Resolve", content: "EXT. CLIFF - DUSK", targetPages: 30, activeFrameworks: [], createdAt: 1, updatedAt: 2 },
      assets: [
        {
          id: "browser-scene",
          projectId: "project-1",
          kind: "scene_set",
          provider: "gemini-nano-banana",
          model: "gemini-2.5-flash-image",
          name: "No Path Scene",
          prompt: "A windswept cliff at dusk",
          mimeType: "image/png",
          imageDataUrl: "data:image/png;base64,AAAA",
          createdAt: 200,
          updatedAt: 200,
          scriptRef: { scriptHash: "h", sceneHeading: "EXT. CLIFF - DUSK", sceneIndex: 1 },
          metadata: { promptVersion: 1 },
        },
      ],
    });

    expect(Object.keys(manifest.locations)).toHaveLength(0);
    expect(manifest._lightwriter_warnings?.length).toBe(1);
    expect(manifest._lightwriter_warnings?.[0]).toContain("skipped");
    expect(manifest._lightwriter_warnings?.[0]).toContain("EXT. CLIFF - DUSK");
  });
});

describe("script2screen manifest — world locations", () => {
  beforeEach(() => installLocalStorage());

  it("resolves scene headings to shared series locations and emits a stable world_locations library", () => {
    const series = WorldStateService.createSeries("The Maddox Chronicles");
    const kitchen = WorldStateService.addLocation(series.id, {
      name: "Maddox Family Kitchen",
      aliases: ["KITCHEN"],
      description: "Warm sunlit kitchen.",
      referenceFilePath: "/tmp/lw/series/kitchen.png",
    });

    const project = {
      id: "proj-9",
      name: "Episode 1",
      content: "INT. KITCHEN - DAY\n\nFinn cooks.\n\nEXT. PARK - DAY\n\nThey walk.",
      targetPages: 23,
      activeFrameworks: [],
      seriesId: series.id,
      createdAt: 1,
      updatedAt: 2,
    };

    const manifest = buildScript2ScreenManifest({ project, assets: [] });

    expect(manifest.series_name).toBe("The Maddox Chronicles");
    expect(manifest.series_id).toBe(series.id);
    // KITCHEN scene (index 0) resolved to the series location via its alias.
    expect(manifest.world_locations?.[kitchen.stsLocationKey]).toMatchObject({
      name: "Maddox Family Kitchen",
      reference_image_path: "/tmp/lw/series/kitchen.png",
    });
    expect(manifest.locations["0"]).toMatchObject({
      world_location_key: kitchen.stsLocationKey,
      world_location_name: "Maddox Family Kitchen",
      file_path: "/tmp/lw/series/kitchen.png",
    });
    // PARK (index 1) has no matching world location, so it isn't tagged.
    expect(manifest.locations["1"]).toBeUndefined();
  });

  it("an explicit per-scene binding overrides alias matching", () => {
    const series = WorldStateService.createSeries("Series B");
    const kitchenA = WorldStateService.addLocation(series.id, { name: "Diner Kitchen", aliases: ["KITCHEN"] });
    const kitchenB = WorldStateService.addLocation(series.id, { name: "Home Kitchen", aliases: ["KITCHEN"] });
    const project = {
      id: "proj-b",
      name: "Ep",
      content: "INT. KITCHEN - DAY\n\nAction.",
      targetPages: 10,
      activeFrameworks: [],
      seriesId: series.id,
      createdAt: 1,
      updatedAt: 2,
    };
    // Bind scene 0 to the second kitchen explicitly.
    WorldStateService.bindScene(project.id, 0, kitchenB.id);

    const manifest = buildScript2ScreenManifest({ project, assets: [] });
    expect(manifest.locations["0"].world_location_key).toBe(kitchenB.stsLocationKey);
    expect(manifest.world_locations?.[kitchenA.stsLocationKey]).toBeUndefined();
  });
});
