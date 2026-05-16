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

  it("builds Script2Screen manifest entries compatible with existing generated_media schema", () => {
    const manifest = buildScript2ScreenManifest({
      resolveProjectName: "Pilot Resolve",
      assets,
    });

    expect(manifest.version).toBe(1);
    expect(manifest.generated_media["s0_sh0_coffee.png"]).toMatchObject({
      type: "image",
      shot_key: "s0_sh0",
      provider: "gemini",
      file_path: "/tmp/lightwriter/assets/images/s0_sh0_coffee.png",
      style_reference_path: "",
      character_refs: {},
    });
    expect(manifest.generated_media["s0_sh0_coffee.png"].provider_settings).toMatchObject({
      model: "gemini-2.5-flash-image",
      source_provider: "gemini-nano-banana",
      lightwriter_asset_id: "scene-asset",
    });
    expect(manifest.characters.ALEX).toMatchObject({
      reference_image_path: "/tmp/lightwriter/assets/characters/alex.png",
      visual_prompt: "Character portrait for ALEX",
    });
  });
});
