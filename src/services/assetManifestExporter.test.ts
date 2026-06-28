import { describe, it, expect, beforeEach } from "vitest";
import { buildScript2ScreenManifest } from "./assetManifestExporter";
import { WorldStateService } from "./worldStateService";
import type { Project } from "./storageService";
import type { GeneratedAsset } from "../types/assets";

function installLocalStorage() {
  const store = new Map<string, string>();
  (globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
    clear: () => store.clear(),
  };
}

const CONTENT = "INT. KITCHEN - DAY\n\nAIDEN enters.\n\nAIDEN\nWe made it.\n";

function project(seriesId?: string): Project {
  return { id: "p1", name: "Pilot", content: CONTENT, targetPages: 10, activeFrameworks: [], seriesId, createdAt: 0, updatedAt: 0 };
}

function shotAsset(): GeneratedAsset {
  return {
    id: "a1",
    projectId: "p1",
    kind: "shot",
    provider: "gemini-nano-banana",
    model: "gemini-x",
    name: "Shot 1",
    prompt: "Aiden in the kitchen",
    mimeType: "image/png",
    filePath: "/imgs/shot1.png",
    createdAt: 0,
    updatedAt: 0,
    scriptRef: { scriptHash: "", sceneIndex: 0, sceneHeading: "INT. KITCHEN - DAY", characterName: "Aiden" },
    metadata: { promptVersion: 1, script2ScreenShotKey: "s0_sh0" },
  };
}

describe("buildScript2ScreenManifest — series characters + script link", () => {
  beforeEach(() => installLocalStorage());

  it("links the screenplay, exports world characters, and pre-populates characters by name", () => {
    const s = WorldStateService.createSeries("Aiden Chronicles");
    WorldStateService.addLocation(s.id, { name: "Kitchen", aliases: ["KITCHEN"], referenceFilePath: "/imgs/kitchen.png" });
    const aiden = WorldStateService.addCharacter(s.id, {
      name: "Aiden",
      aliases: ["AIDEN", "YOUNG AIDEN"],
      description: "an immortal boy",
      referenceFilePath: "/imgs/aiden.png",
    });

    const m = buildScript2ScreenManifest({ project: project(s.id), assets: [] });

    // Script is linked.
    expect(m.screenplay?.project_name).toBe("Pilot");
    expect(m.screenplay?.fountain).toBe(CONTENT);
    expect(m.screenplay?.script_hash).toBeTruthy();

    // World character library keyed by the stable stsCharacterKey.
    expect(m.world_characters?.[aiden.stsCharacterKey]).toMatchObject({
      name: "Aiden",
      reference_image_path: "/imgs/aiden.png",
    });

    // Detected-character pre-population for the name AND every cue alias.
    expect(m.characters["AIDEN"]).toMatchObject({ reference_image_path: "/imgs/aiden.png", world_character_key: aiden.stsCharacterKey });
    expect(m.characters["YOUNG AIDEN"]?.reference_image_path).toBe("/imgs/aiden.png");
  });

  it("gives each shot both its scene reference and its character reference", () => {
    const s = WorldStateService.createSeries("S");
    WorldStateService.addLocation(s.id, { name: "Kitchen", aliases: ["KITCHEN"], referenceFilePath: "/imgs/kitchen.png" });

    const m = buildScript2ScreenManifest({ project: project(s.id), assets: [shotAsset()] });

    const shot = m.generated_media["shot1.png"];
    expect(shot).toBeTruthy();
    expect(shot.scene_reference_path).toBe("/imgs/kitchen.png"); // scene (location) ref
    expect(shot.character_refs).toEqual({ AIDEN: "/imgs/shot1.png" }); // character ref
  });

  it("warns (not throws) when a series character has no reference image, and uses an empty-string sentinel", () => {
    const s = WorldStateService.createSeries("S");
    WorldStateService.addCharacter(s.id, { name: "Mara" });
    const m = buildScript2ScreenManifest({ project: project(s.id), assets: [] });
    expect(m.characters["MARA"]).toBeTruthy();
    expect(m.characters["MARA"].reference_image_path).toBe(""); // matches world_characters/world_locations sentinel
    expect(m._lightwriter_warnings?.some((w) => /Mara.*no reference image/i.test(w))).toBe(true);
  });

  it("lets a generated character asset keep precedence over the world-character portrait, but tags the world key", () => {
    const s = WorldStateService.createSeries("S");
    const aiden = WorldStateService.addCharacter(s.id, { name: "Aiden", referenceFilePath: "/imgs/aiden_world.png" });
    const asset: GeneratedAsset = {
      id: "ca1", projectId: "p1", kind: "character", provider: "gemini-nano-banana", model: "g",
      name: "Aiden portrait", prompt: "Aiden", mimeType: "image/png", filePath: "/imgs/aiden_asset.png",
      createdAt: 0, updatedAt: 0, scriptRef: { scriptHash: "", characterName: "Aiden" }, metadata: { promptVersion: 1 },
    };
    const m = buildScript2ScreenManifest({ project: project(s.id), assets: [asset] });
    expect(m.characters["AIDEN"].reference_image_path).toBe("/imgs/aiden_asset.png"); // asset wins
    expect(m.characters["AIDEN"].world_character_key).toBe(aiden.stsCharacterKey); // still tagged
  });

  it("skips an unbound scene image (no scene index) so it can't clobber locations[0]", () => {
    const s = WorldStateService.createSeries("S");
    const asset: GeneratedAsset = {
      id: "sc1", projectId: "p1", kind: "scene_set", provider: "gemini-nano-banana", model: "g",
      name: "Loose kitchen note", prompt: "", mimeType: "image/png", filePath: "/imgs/note.png",
      createdAt: 0, updatedAt: 0, scriptRef: { scriptHash: "", sceneHeading: "INT. KITCHEN - DAY" }, metadata: { promptVersion: 1 },
    };
    const m = buildScript2ScreenManifest({ project: project(s.id), assets: [asset] });
    expect(m.locations["0"]).toBeUndefined();
    expect(m._lightwriter_warnings?.some((w) => /isn't bound to a script scene/i.test(w))).toBe(true);
  });

  it("binds a scene image that has a scene index into locations", () => {
    const s = WorldStateService.createSeries("S");
    const asset: GeneratedAsset = {
      id: "sc2", projectId: "p1", kind: "scene_set", provider: "gemini-nano-banana", model: "g",
      name: "Kitchen", prompt: "", mimeType: "image/png", filePath: "/imgs/kitchen.png",
      createdAt: 0, updatedAt: 0, scriptRef: { scriptHash: "", sceneHeading: "INT. KITCHEN - DAY", sceneIndex: 0 }, metadata: { promptVersion: 1 },
    };
    const m = buildScript2ScreenManifest({ project: project(s.id), assets: [asset] });
    expect(m.locations["0"]).toBeTruthy();
    expect((m.locations["0"] as Record<string, unknown>).file_path).toBe("/imgs/kitchen.png");
  });

  it("omits the world layer for a script with no series", () => {
    const m = buildScript2ScreenManifest({ project: project(undefined), assets: [] });
    expect(m.world_characters).toBeUndefined();
    expect(m.screenplay?.fountain).toBe(CONTENT); // script link still present
  });
});
