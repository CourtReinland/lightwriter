import { describe, expect, it } from "vitest";
import { buildScript2ScreenManifest, buildLightWriterPackage } from "../src/services/assetManifestExporter";
import type { GeneratedAsset } from "../src/types/assets";

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
      resolveProjectName: "Pilot Resolve",
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
      resolveProjectName: "Pilot Resolve",
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
