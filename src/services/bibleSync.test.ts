import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  exportSeriesToBible,
  importBibleIntoSeries,
  adoptBibleSeries,
  startBibleSync,
  stopBibleSync,
  toIsoSeconds,
  isoToSeconds,
  upsertIndexEntry,
  parseIndexJson,
  type BibleFile,
  type BibleObjectRecord,
  type BibleWriteResult,
  type LightWriterBibleBridge,
} from "./bibleSyncService";
import { WorldStateService, onWorldStateChange } from "./worldStateService";

// ---------------------------------------------------------------------------
// Harness: in-memory localStorage + stubbed Electron bridges on globalThis
// ---------------------------------------------------------------------------

function installLocalStorage(): Map<string, string> {
  const store = new Map<string, string>();
  (globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
    clear: () => store.clear(),
  };
  return store;
}

/** A fake bible file-system: one series file + one index file with mtimes. */
function makeFakeBibleBridge(initialBibleJson: string | null = null) {
  const state = {
    bibleJson: initialBibleJson,
    bibleMtime: initialBibleJson ? 1 : (null as number | null),
    indexJson: null as string | null,
    indexMtime: null as number | null,
    changedCallbacks: [] as Array<(payload: { seriesId: string }) => void>,
  };
  let nextMtime = 100;

  const bridge: LightWriterBibleBridge = {
    readBible: vi.fn(async () => ({ json: state.bibleJson, mtimeMs: state.bibleMtime })),
    readIndex: vi.fn(async () => ({ json: state.indexJson, mtimeMs: state.indexMtime })),
    writeBible: vi.fn(async (_seriesId: string, json: string, expectedMtimeMs: number | null): Promise<BibleWriteResult> => {
      if ((expectedMtimeMs ?? null) !== (state.bibleMtime ?? null)) {
        return { ok: false, conflict: true, mtimeMs: state.bibleMtime };
      }
      state.bibleJson = json;
      state.bibleMtime = nextMtime++;
      return { ok: true, conflict: false, mtimeMs: state.bibleMtime };
    }),
    writeIndex: vi.fn(async (json: string, expectedMtimeMs: number | null): Promise<BibleWriteResult> => {
      if ((expectedMtimeMs ?? null) !== (state.indexMtime ?? null)) {
        return { ok: false, conflict: true, mtimeMs: state.indexMtime };
      }
      state.indexJson = json;
      state.indexMtime = nextMtime++;
      return { ok: true, conflict: false, mtimeMs: state.indexMtime };
    }),
    copyAssetIn: vi.fn(async (seriesId: string, _source: { sourcePath?: string; dataUrl?: string }, stableKey: string) => ({
      filePath: `/bible/${seriesId}/assets/${stableKey}.png`,
    })),
    watchBible: vi.fn(async () => ({ ok: true })),
    unwatchBible: vi.fn(async () => ({ ok: true })),
    onBibleChanged: vi.fn((cb: (payload: { seriesId: string }) => void) => {
      state.changedCallbacks.push(cb);
      return () => {};
    }),
  };
  return { bridge, state };
}

function installWindow(bridge: LightWriterBibleBridge | undefined) {
  (globalThis as { window?: unknown }).window = {
    lightwriterBible: bridge,
    // Asset bridge used when a record only has an inline data url.
    lightwriterAssets: {
      saveImageAsset: async (req: { name: string }) => ({ filePath: `/lw/assets/${req.name}.png` }),
    },
  };
}

function parseBible(json: string | null): BibleFile {
  expect(json).toBeTruthy();
  return JSON.parse(json!) as BibleFile;
}

const T0 = Date.parse("2026-07-12T10:00:00Z"); // fixed base timestamp (ms)

beforeEach(() => {
  installLocalStorage();
});

afterEach(() => {
  stopBibleSync();
  vi.useRealTimers();
});

// ---------------------------------------------------------------------------
// Timestamp helpers
// ---------------------------------------------------------------------------

describe("bible timestamp helpers", () => {
  it("round-trips at second precision", () => {
    expect(toIsoSeconds(T0)).toBe("2026-07-12T10:00:00Z");
    expect(toIsoSeconds(T0 + 999)).toBe("2026-07-12T10:00:00Z"); // sub-second truncated
    expect(isoToSeconds("2026-07-12T10:00:00Z")).toBe(T0 / 1000);
    expect(isoToSeconds(toIsoSeconds(T0 + 1500))).toBe(Math.floor((T0 + 1500) / 1000));
  });

  it("treats invalid timestamps as epoch (never wins a merge)", () => {
    expect(isoToSeconds("not-a-date")).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Export mapping
// ---------------------------------------------------------------------------

describe("exportSeriesToBible", () => {
  it("maps LW world records to bible records under their stable keys, copying images in", async () => {
    const { bridge, state } = makeFakeBibleBridge();
    installWindow(bridge);
    const series = WorldStateService.createSeries("Maddox Chronicles");
    const location = WorldStateService.addLocation(series.id, {
      name: "Family Kitchen",
      aliases: ["KITCHEN", "FAMILY KITCHEN"],
      category: "interior",
      description: "Warm oak cabinets.",
      referenceFilePath: "/lw/assets/kitchen.png",
      stsLocationKey: "stsloc_kitchen",
      updatedAt: T0,
    });
    const character = WorldStateService.addCharacter(series.id, {
      name: "Aiden",
      aliases: ["AIDEN", "YOUNG AIDEN"],
      description: "Restless eyes.",
      traits: ["curious", "stubborn"],
      referenceFilePath: "/lw/assets/aiden.png",
      stsCharacterKey: "stschar_aiden",
      updatedAt: T0 + 5000,
    });

    expect(await exportSeriesToBible(series.id)).toBe(true);

    const bible = parseBible(state.bibleJson);
    expect(bible.version).toBe(1);
    expect(bible.series_id).toBe(series.id);
    expect(bible.name).toBe("Maddox Chronicles");
    expect(Object.keys(bible.locations)).toEqual(["stsloc_kitchen"]);
    expect(Object.keys(bible.characters)).toEqual(["stschar_aiden"]);

    const bLoc = bible.locations.stsloc_kitchen;
    expect(bLoc.name).toBe("Family Kitchen");
    expect(bLoc.aliases).toEqual(["KITCHEN", "FAMILY KITCHEN"]);
    expect(bLoc.category).toBe("interior");
    expect(bLoc.description).toBe("Warm oak cabinets.");
    expect(bLoc.updated_at).toBe(toIsoSeconds(location.updatedAt));
    expect(bLoc.source_app).toBe("lightwriter");
    expect(bLoc.deleted).toBe(false);
    // Bible owns a COPY of the image (never an app-private path).
    expect(bLoc.ref_image_path).toBe(`/bible/${series.id}/assets/stsloc_kitchen.png`);
    expect(bridge.copyAssetIn).toHaveBeenCalledWith(series.id, { sourcePath: "/lw/assets/kitchen.png" }, "stsloc_kitchen");

    const bChar = bible.characters.stschar_aiden;
    expect(bChar.traits).toEqual(["curious", "stubborn"]);
    expect(bChar.updated_at).toBe(toIsoSeconds(character.updatedAt));
    expect(bChar.ref_image_path).toBe(`/bible/${series.id}/assets/stschar_aiden.png`);

    // Index upsert happened too.
    const index = parseIndexJson(state.indexJson);
    expect(index.series.map((s) => ({ id: s.id, name: s.name }))).toEqual([{ id: series.id, name: "Maddox Chronicles" }]);
  });

  it("merges last-writer-wins: newer bible records survive, ties keep the incumbent", async () => {
    const series = WorldStateService.createSeries("S");
    WorldStateService.addCharacter(series.id, { name: "Aiden (LW old)", stsCharacterKey: "k_old", updatedAt: T0 });
    WorldStateService.addCharacter(series.id, { name: "Mara (LW tie)", stsCharacterKey: "k_tie", updatedAt: T0 + 500 }); // same SECOND as bible's T0
    const existing: BibleFile = {
      version: 1,
      series_id: series.id,
      name: "S",
      updated_at: toIsoSeconds(T0 + 60_000),
      characters: {
        k_old: { name: "Aiden (S2S newer)", aliases: [], description: "", traits: [], ref_image_path: null, updated_at: toIsoSeconds(T0 + 60_000), source_app: "scripttoscreen", deleted: false },
        k_tie: { name: "Mara (S2S tie)", aliases: [], description: "", traits: [], ref_image_path: null, updated_at: toIsoSeconds(T0), source_app: "scripttoscreen", deleted: false },
      },
      locations: {},
      objects: {},
    };
    const { bridge, state } = makeFakeBibleBridge(JSON.stringify(existing));
    installWindow(bridge);

    expect(await exportSeriesToBible(series.id)).toBe(true);
    const bible = parseBible(state.bibleJson);
    // Newer S2S record wins over the older LW record.
    expect(bible.characters.k_old.name).toBe("Aiden (S2S newer)");
    expect(bible.characters.k_old.source_app).toBe("scripttoscreen");
    // Tie (same second) keeps the incumbent already in the file.
    expect(bible.characters.k_tie.name).toBe("Mara (S2S tie)");
  });

  it("re-reads, re-merges, and retries ONCE when the write conflicts mid-flight", async () => {
    const series = WorldStateService.createSeries("S");
    WorldStateService.addCharacter(series.id, { name: "Aiden", stsCharacterKey: "k_lw", updatedAt: T0 });

    const { bridge, state } = makeFakeBibleBridge();
    installWindow(bridge);
    // Simulate ScriptToScreen writing between our read and our write: the first
    // writeBible call conflicts; the re-read then sees S2S's new record.
    const s2sBible: BibleFile = {
      version: 1,
      series_id: series.id,
      name: "S",
      updated_at: toIsoSeconds(T0 + 30_000),
      characters: { k_s2s: { name: "Boris", aliases: ["BORIS"], description: "", traits: [], ref_image_path: null, updated_at: toIsoSeconds(T0 + 30_000), source_app: "scripttoscreen", deleted: false } },
      locations: {},
      objects: {},
    };
    const realWrite = bridge.writeBible!;
    let firstWrite = true;
    bridge.writeBible = vi.fn(async (seriesId: string, json: string, expected: number | null) => {
      if (firstWrite) {
        firstWrite = false;
        state.bibleJson = JSON.stringify(s2sBible);
        state.bibleMtime = 55; // mtime moved -> conflict
        return { ok: false, conflict: true, mtimeMs: 55 };
      }
      return realWrite(seriesId, json, expected);
    });

    expect(await exportSeriesToBible(series.id)).toBe(true);
    expect(bridge.readBible).toHaveBeenCalledTimes(2);
    expect(bridge.writeBible).toHaveBeenCalledTimes(2);
    const bible = parseBible(state.bibleJson);
    // The retried write contains BOTH S2S's record and ours (true re-merge).
    expect(bible.characters.k_s2s.name).toBe("Boris");
    expect(bible.characters.k_lw.name).toBe("Aiden");
  });

  it("tombstones records deleted in LightWriter since the previous export", async () => {
    const { bridge, state } = makeFakeBibleBridge();
    installWindow(bridge);
    const series = WorldStateService.createSeries("S");
    // Relative timestamp: the tombstone is stamped Date.now(), so the record it
    // replaces must be OLDER than the wall clock for LWW to let it win.
    const anHourAgo = Date.now() - 3_600_000;
    const doomed = WorldStateService.addLocation(series.id, { name: "Old Barn", stsLocationKey: "stsloc_barn", updatedAt: anHourAgo });
    await exportSeriesToBible(series.id);
    expect(parseBible(state.bibleJson).locations.stsloc_barn.deleted).toBe(false);

    WorldStateService.deleteLocation(doomed.id);
    await exportSeriesToBible(series.id);
    const tombstone = parseBible(state.bibleJson).locations.stsloc_barn;
    expect(tombstone.deleted).toBe(true);
    expect(tombstone.source_app).toBe("lightwriter");
    // Fresh timestamp: a concurrent NEWER remote edit can still win later.
    expect(isoToSeconds(tombstone.updated_at)).toBeGreaterThan(Math.floor(anHourAgo / 1000));
  });

  it("merges the MANAGED objects section (incumbents survive) and preserves unknown future sections byte-for-byte", async () => {
    const series = WorldStateService.createSeries("S");
    WorldStateService.addCharacter(series.id, { name: "Aiden", stsCharacterKey: "k_lw", updatedAt: T0 });
    // An S2S-tagged object LightWriter holds no record for: the merge must keep
    // it untouched (it is now MANAGED, but the incumbent wins when LW has nothing).
    const objects = {
      obj_pie_deadbeef: {
        name: "Pie",
        aliases: ["PIE", "CHERRY PIE"],
        description: "A lattice-top cherry pie.",
        ref_image_path: "/bible/s/assets/obj_pie_deadbeef.png",
        updated_at: toIsoSeconds(T0),
        deleted: false,
        source_app: "scripttoscreen",
        scale_hint: "tabletop",
      },
    };
    const future_section = { anything: [1, "two", { nested: true }], note: "unknown to LightWriter" };
    const existing = {
      version: 1,
      series_id: series.id,
      name: "S",
      updated_at: toIsoSeconds(T0),
      characters: {},
      locations: {},
      objects,
      future_section,
    };
    const { bridge, state } = makeFakeBibleBridge(JSON.stringify(existing));
    installWindow(bridge);

    expect(await exportSeriesToBible(series.id)).toBe(true);
    const first = JSON.parse(state.bibleJson!) as Record<string, unknown>;
    // The S2S object record survives the merge unchanged…
    expect(JSON.stringify(first.objects)).toBe(JSON.stringify(objects));
    // …UNKNOWN sections survive byte-identical (the passthrough contract)…
    expect(JSON.stringify(first.future_section)).toBe(JSON.stringify(future_section));
    // …while the managed sections were still rewritten normally.
    expect((first.characters as Record<string, { name: string }>).k_lw.name).toBe("Aiden");

    // A second export (round-trip echo) still carries them unchanged.
    expect(await exportSeriesToBible(series.id)).toBe(true);
    const second = JSON.parse(state.bibleJson!) as Record<string, unknown>;
    expect(JSON.stringify(second.objects)).toBe(JSON.stringify(objects));
    expect(JSON.stringify(second.future_section)).toBe(JSON.stringify(future_section));
  });

  it("carries objects landed by a concurrent S2S write plus unknown sections through the conflict re-read-re-merge retry", async () => {
    const series = WorldStateService.createSeries("S");
    WorldStateService.addCharacter(series.id, { name: "Aiden", stsCharacterKey: "k_lw", updatedAt: T0 });
    const { bridge, state } = makeFakeBibleBridge();
    installWindow(bridge);
    // Between our read and write, S2S lands a file that ALREADY has objects
    // (and an unknown future section).
    const objects = { obj_lamp_12345678: { name: "Lamp", aliases: ["LAMP"], description: "", ref_image_path: null, updated_at: toIsoSeconds(T0), deleted: false, source_app: "scripttoscreen", scale_hint: "handheld" } };
    const future_section = { note: "still unknown to LightWriter" };
    const s2sJson = JSON.stringify({ version: 1, series_id: series.id, name: "S", updated_at: toIsoSeconds(T0), characters: {}, locations: {}, objects, future_section });
    const realWrite = bridge.writeBible!;
    let firstWrite = true;
    bridge.writeBible = vi.fn(async (seriesId: string, json: string, expected: number | null) => {
      if (firstWrite) {
        firstWrite = false;
        state.bibleJson = s2sJson;
        state.bibleMtime = 55;
        return { ok: false, conflict: true, mtimeMs: 55 };
      }
      return realWrite(seriesId, json, expected);
    });

    expect(await exportSeriesToBible(series.id)).toBe(true);
    const bible = JSON.parse(state.bibleJson!) as Record<string, unknown>;
    expect(JSON.stringify(bible.objects)).toBe(JSON.stringify(objects));
    expect(JSON.stringify(bible.future_section)).toBe(JSON.stringify(future_section));
    expect((bible.characters as Record<string, { name: string }>).k_lw.name).toBe("Aiden");
  });

  it("no-ops without a bridge (browser) or without the series", async () => {
    installWindow(undefined);
    expect(await exportSeriesToBible("missing")).toBe(false);
    const { bridge } = makeFakeBibleBridge();
    installWindow(bridge);
    expect(await exportSeriesToBible("missing")).toBe(false);
    expect(bridge.writeBible).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Import merge
// ---------------------------------------------------------------------------

function bibleWith(seriesId: string, partial: Partial<Pick<BibleFile, "characters" | "locations" | "objects">>): string {
  const bible: BibleFile = {
    version: 1,
    series_id: seriesId,
    name: "S",
    updated_at: toIsoSeconds(T0),
    characters: partial.characters ?? {},
    locations: partial.locations ?? {},
    objects: partial.objects ?? {},
  };
  return JSON.stringify(bible);
}

describe("importBibleIntoSeries", () => {
  it("creates unknown live records with the bible's stable key and disk image path preserved", async () => {
    const series = WorldStateService.createSeries("S");
    const json = bibleWith(series.id, {
      characters: {
        "char_boris_deadbeef": { name: "Boris", aliases: ["BORIS"], description: "Gruff.", traits: ["loyal"], ref_image_path: "/bible/s/assets/char_boris_deadbeef.png", updated_at: toIsoSeconds(T0), source_app: "scripttoscreen", deleted: false },
      },
      locations: {
        "loc_dock_12345678": { name: "The Dock", aliases: ["DOCK"], category: "exterior", description: "Fog.", ref_image_path: null, updated_at: toIsoSeconds(T0), source_app: "scripttoscreen", deleted: false },
      },
    });
    const { bridge } = makeFakeBibleBridge(json);
    installWindow(bridge);

    expect(await importBibleIntoSeries(series.id)).toBe(true);

    const characters = WorldStateService.listCharacters(series.id);
    expect(characters).toHaveLength(1);
    expect(characters[0].stsCharacterKey).toBe("char_boris_deadbeef");
    expect(characters[0].name).toBe("Boris");
    expect(characters[0].traits).toEqual(["loyal"]);
    // Bible assets ARE durable disk paths — imported directly.
    expect(characters[0].referenceFilePath).toBe("/bible/s/assets/char_boris_deadbeef.png");
    // Preserves the bible timestamp so a re-export ties instead of echoing.
    expect(Math.floor(characters[0].updatedAt / 1000)).toBe(isoToSeconds(toIsoSeconds(T0)));

    const locations = WorldStateService.listLocations(series.id);
    expect(locations[0].stsLocationKey).toBe("loc_dock_12345678");
    expect(locations[0].category).toBe("exterior");
  });

  it("newer bible records update LW; older and tied ones are ignored", async () => {
    const series = WorldStateService.createSeries("S");
    WorldStateService.addCharacter(series.id, { name: "Aiden LW", stsCharacterKey: "k_newer", updatedAt: T0 });
    WorldStateService.addCharacter(series.id, { name: "Mara LW", stsCharacterKey: "k_older", updatedAt: T0 + 60_000 });
    WorldStateService.addCharacter(series.id, { name: "Pip LW", stsCharacterKey: "k_tie", updatedAt: T0 + 300 });
    const json = bibleWith(series.id, {
      characters: {
        k_newer: { name: "Aiden S2S", aliases: [], description: "", traits: [], ref_image_path: null, updated_at: toIsoSeconds(T0 + 30_000), source_app: "scripttoscreen", deleted: false },
        k_older: { name: "Mara S2S", aliases: [], description: "", traits: [], ref_image_path: null, updated_at: toIsoSeconds(T0), source_app: "scripttoscreen", deleted: false },
        k_tie: { name: "Pip S2S", aliases: [], description: "", traits: [], ref_image_path: null, updated_at: toIsoSeconds(T0), source_app: "scripttoscreen", deleted: false },
      },
    });
    const { bridge } = makeFakeBibleBridge(json);
    installWindow(bridge);

    await importBibleIntoSeries(series.id);
    const byKey = new Map(WorldStateService.listCharacters(series.id).map((c) => [c.stsCharacterKey, c.name]));
    expect(byKey.get("k_newer")).toBe("Aiden S2S"); // bible newer -> updated
    expect(byKey.get("k_older")).toBe("Mara LW"); // bible older -> ignored
    expect(byKey.get("k_tie")).toBe("Pip LW"); // same second -> incumbent kept
  });

  it("tombstones delete the matching LW record but never beat a newer local edit", async () => {
    const series = WorldStateService.createSeries("S");
    WorldStateService.addLocation(series.id, { name: "Barn", stsLocationKey: "k_dead", updatedAt: T0 });
    WorldStateService.addLocation(series.id, { name: "Pier (edited later)", stsLocationKey: "k_alive", updatedAt: T0 + 120_000 });
    const json = bibleWith(series.id, {
      locations: {
        k_dead: { name: "Barn", aliases: [], category: "exterior", description: "", ref_image_path: null, updated_at: toIsoSeconds(T0 + 60_000), source_app: "scripttoscreen", deleted: true },
        k_alive: { name: "Pier", aliases: [], category: "exterior", description: "", ref_image_path: null, updated_at: toIsoSeconds(T0 + 60_000), source_app: "scripttoscreen", deleted: true },
      },
    });
    const { bridge } = makeFakeBibleBridge(json);
    installWindow(bridge);

    await importBibleIntoSeries(series.id);
    const keys = WorldStateService.listLocations(series.id).map((l) => l.stsLocationKey);
    expect(keys).toEqual(["k_alive"]); // newer tombstone deleted k_dead; older tombstone lost to the newer local edit
  });

  it("a tombstone never resurrects as a live record on import", async () => {
    const series = WorldStateService.createSeries("S");
    const json = bibleWith(series.id, {
      characters: {
        k_gone: { name: "Ghost", aliases: [], description: "", traits: [], ref_image_path: null, updated_at: toIsoSeconds(T0), source_app: "scripttoscreen", deleted: true },
      },
    });
    const { bridge } = makeFakeBibleBridge(json);
    installWindow(bridge);
    await importBibleIntoSeries(series.id);
    expect(WorldStateService.listCharacters(series.id)).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Objects: managed two-way merge (kind three, shipped S2S-side first)
// ---------------------------------------------------------------------------

/** Bible object record with contract defaults filled in. */
function bObj(partial: Partial<BibleObjectRecord> & { name: string; updated_at: string }): BibleObjectRecord {
  return { aliases: [], description: "", scale_hint: "", ref_image_path: null, source_app: "scripttoscreen", deleted: false, ...partial };
}

describe("objects managed sync", () => {
  it("exports LW objects under their stable obj_ keys with scale_hint and image copy", async () => {
    const { bridge, state } = makeFakeBibleBridge();
    installWindow(bridge);
    const series = WorldStateService.createSeries("S");
    const pie = WorldStateService.addObject(series.id, {
      name: "Cherry Pie",
      aliases: ["PIE", "CHERRY PIE"],
      description: "Lattice top, still steaming.",
      scaleHint: "tabletop",
      referenceFilePath: "/lw/assets/pie.png",
      stsObjectKey: "obj_cherry_pie_11111111",
      updatedAt: T0,
    });

    expect(await exportSeriesToBible(series.id)).toBe(true);
    const bible = parseBible(state.bibleJson);
    expect(Object.keys(bible.objects)).toEqual(["obj_cherry_pie_11111111"]);
    const bObject = bible.objects.obj_cherry_pie_11111111;
    expect(bObject.name).toBe("Cherry Pie");
    expect(bObject.aliases).toEqual(["PIE", "CHERRY PIE"]);
    expect(bObject.description).toBe("Lattice top, still steaming.");
    expect(bObject.scale_hint).toBe("tabletop");
    expect(bObject.updated_at).toBe(toIsoSeconds(pie.updatedAt));
    expect(bObject.source_app).toBe("lightwriter");
    expect(bObject.deleted).toBe(false);
    // Bible owns a COPY of the image, named after the stable key.
    expect(bObject.ref_image_path).toBe(`/bible/${series.id}/assets/obj_cherry_pie_11111111.png`);
    expect(bridge.copyAssetIn).toHaveBeenCalledWith(series.id, { sourcePath: "/lw/assets/pie.png" }, "obj_cherry_pie_11111111");
  });

  it("export merges objects LWW: newer bible records survive, ties keep the incumbent", async () => {
    const series = WorldStateService.createSeries("S");
    WorldStateService.addObject(series.id, { name: "Lamp (LW old)", stsObjectKey: "ko_old", updatedAt: T0 });
    WorldStateService.addObject(series.id, { name: "Vase (LW tie)", stsObjectKey: "ko_tie", updatedAt: T0 + 500 }); // same SECOND as bible's T0
    const existing = bibleWith(series.id, {
      objects: {
        ko_old: bObj({ name: "Lamp (S2S newer)", updated_at: toIsoSeconds(T0 + 60_000), scale_hint: "handheld" }),
        ko_tie: bObj({ name: "Vase (S2S tie)", updated_at: toIsoSeconds(T0) }),
      },
    });
    const { bridge, state } = makeFakeBibleBridge(existing);
    installWindow(bridge);

    expect(await exportSeriesToBible(series.id)).toBe(true);
    const bible = parseBible(state.bibleJson);
    expect(bible.objects.ko_old.name).toBe("Lamp (S2S newer)");
    expect(bible.objects.ko_old.scale_hint).toBe("handheld"); // S2S-set hint NOT wiped by the older LW record
    expect(bible.objects.ko_old.source_app).toBe("scripttoscreen");
    expect(bible.objects.ko_tie.name).toBe("Vase (S2S tie)");
  });

  it("a CONCURRENT newer S2S object write wins the conflict re-merge", async () => {
    const series = WorldStateService.createSeries("S");
    WorldStateService.addObject(series.id, { name: "Pie (LW)", stsObjectKey: "obj_pie_11111111", updatedAt: T0 });
    const { bridge, state } = makeFakeBibleBridge();
    installWindow(bridge);
    // S2S re-tags the SAME key (newer) between our read and write.
    const s2sJson = bibleWith(series.id, {
      objects: { obj_pie_11111111: bObj({ name: "Pie (S2S)", scale_hint: "tabletop", updated_at: toIsoSeconds(T0 + 60_000) }) },
    });
    const realWrite = bridge.writeBible!;
    let firstWrite = true;
    bridge.writeBible = vi.fn(async (seriesId: string, json: string, expected: number | null) => {
      if (firstWrite) {
        firstWrite = false;
        state.bibleJson = s2sJson;
        state.bibleMtime = 55;
        return { ok: false, conflict: true, mtimeMs: 55 };
      }
      return realWrite(seriesId, json, expected);
    });

    expect(await exportSeriesToBible(series.id)).toBe(true);
    const bible = parseBible(state.bibleJson);
    expect(bible.objects.obj_pie_11111111.name).toBe("Pie (S2S)");
    expect(bible.objects.obj_pie_11111111.scale_hint).toBe("tabletop");
  });

  it("export converges a same-named LW object onto the incumbent bible key (no duplicate), adopting it locally", async () => {
    const series = WorldStateService.createSeries("S");
    // Same pie tagged in S2S first (older), then created in LW with a DIFFERENT freshly-minted key.
    const lwPie = WorldStateService.addObject(series.id, { name: "Cherry Pie", aliases: ["PIE"], description: "LW description", updatedAt: T0 + 60_000 });
    expect(lwPie.stsObjectKey).not.toBe("obj_pie_deadbeef");
    const existing = bibleWith(series.id, {
      objects: { obj_pie_deadbeef: bObj({ name: "Pie", aliases: ["PIE"], description: "S2S description", updated_at: toIsoSeconds(T0) }) },
    });
    const { bridge, state } = makeFakeBibleBridge(existing);
    installWindow(bridge);

    expect(await exportSeriesToBible(series.id)).toBe(true);
    const bible = parseBible(state.bibleJson);
    // ONE record, under the incumbent's key, with the newer LW fields.
    expect(Object.keys(bible.objects)).toEqual(["obj_pie_deadbeef"]);
    expect(bible.objects.obj_pie_deadbeef.description).toBe("LW description");
    expect(bible.objects.obj_pie_deadbeef.source_app).toBe("lightwriter");
    // The LW record adopted the bible key, so both apps now address one record.
    const after = WorldStateService.listObjects(series.id);
    expect(after).toHaveLength(1);
    expect(after[0].stsObjectKey).toBe("obj_pie_deadbeef");
    // The adopted key is what the tombstone snapshot holds — a follow-up export
    // must NOT tombstone it.
    expect(await exportSeriesToBible(series.id)).toBe(true);
    expect(parseBible(state.bibleJson).objects.obj_pie_deadbeef.deleted).toBe(false);
  });

  it("import converges an unknown bible key onto the same-named LW object (adopt key, LWW fields)", async () => {
    const series = WorldStateService.createSeries("S");
    // Bible newer -> bible fields win AND the key is adopted.
    WorldStateService.addObject(series.id, { name: "Pie", aliases: ["PIE"], description: "LW", updatedAt: T0 });
    const json = bibleWith(series.id, {
      objects: { obj_pie_deadbeef: bObj({ name: "Pie", aliases: ["PIE"], description: "S2S", scale_hint: "tabletop", updated_at: toIsoSeconds(T0 + 60_000) }) },
    });
    const { bridge } = makeFakeBibleBridge(json);
    installWindow(bridge);

    expect(await importBibleIntoSeries(series.id)).toBe(true);
    const objects = WorldStateService.listObjects(series.id);
    expect(objects).toHaveLength(1); // converged — NOT duplicated
    expect(objects[0].stsObjectKey).toBe("obj_pie_deadbeef");
    expect(objects[0].description).toBe("S2S");
    expect(objects[0].scaleHint).toBe("tabletop");
    expect(Math.floor(objects[0].updatedAt / 1000)).toBe(isoToSeconds(toIsoSeconds(T0 + 60_000)));
  });

  it("import adopts the bible key even when LW's fields are newer (fields kept, key converged)", async () => {
    const series = WorldStateService.createSeries("S");
    WorldStateService.addObject(series.id, { name: "Pie", aliases: ["PIE"], description: "LW newer", updatedAt: T0 + 120_000 });
    const json = bibleWith(series.id, {
      objects: { obj_pie_deadbeef: bObj({ name: "Pie", aliases: ["PIE"], description: "S2S older", updated_at: toIsoSeconds(T0 + 60_000) }) },
    });
    const { bridge } = makeFakeBibleBridge(json);
    installWindow(bridge);

    await importBibleIntoSeries(series.id);
    const objects = WorldStateService.listObjects(series.id);
    expect(objects).toHaveLength(1);
    expect(objects[0].stsObjectKey).toBe("obj_pie_deadbeef");
    expect(objects[0].description).toBe("LW newer"); // LWW kept LW's fields
    expect(Math.floor(objects[0].updatedAt / 1000)).toBe(Math.floor((T0 + 120_000) / 1000)); // timestamp untouched -> next export overwrites the bible
  });

  it("imports objects with scale_hint clamped to the frozen vocabulary", async () => {
    const series = WorldStateService.createSeries("S");
    const json = bibleWith(series.id, {
      objects: {
        obj_ok_11111111: bObj({ name: "Lamp", scale_hint: "handheld", updated_at: toIsoSeconds(T0) }),
        obj_bad_22222222: bObj({ name: "Moon", scale_hint: "gigantic", updated_at: toIsoSeconds(T0) }),
      },
    });
    const { bridge } = makeFakeBibleBridge(json);
    installWindow(bridge);

    await importBibleIntoSeries(series.id);
    const byKey = new Map(WorldStateService.listObjects(series.id).map((o) => [o.stsObjectKey, o]));
    expect(byKey.get("obj_ok_11111111")?.scaleHint).toBe("handheld");
    expect(byKey.get("obj_bad_22222222")?.scaleHint).toBe(""); // clamped, not invented
    expect(byKey.get("obj_ok_11111111")?.aliases).toEqual(["LAMP"]); // name fallback, uppercased
  });

  it("tombstones objects deleted in LightWriter since the previous export", async () => {
    const { bridge, state } = makeFakeBibleBridge();
    installWindow(bridge);
    const series = WorldStateService.createSeries("S");
    const anHourAgo = Date.now() - 3_600_000;
    const doomed = WorldStateService.addObject(series.id, { name: "Old Lamp", stsObjectKey: "obj_old_lamp_33333333", updatedAt: anHourAgo });
    await exportSeriesToBible(series.id);
    expect(parseBible(state.bibleJson).objects.obj_old_lamp_33333333.deleted).toBe(false);

    WorldStateService.deleteObject(doomed.id);
    await exportSeriesToBible(series.id);
    const tombstone = parseBible(state.bibleJson).objects.obj_old_lamp_33333333;
    expect(tombstone.deleted).toBe(true);
    expect(tombstone.source_app).toBe("lightwriter");
    expect(tombstone.ref_image_path).toBeNull();
    expect(isoToSeconds(tombstone.updated_at)).toBeGreaterThan(Math.floor(anHourAgo / 1000));
  });

  it("imported object tombstones delete the LW record, never resurrect, and never match by name", async () => {
    const series = WorldStateService.createSeries("S");
    WorldStateService.addObject(series.id, { name: "Lamp", stsObjectKey: "ko_dead", updatedAt: T0 });
    // A DIFFERENT live LW pie whose name matches a tombstone — must survive
    // (deleted records are excluded from name-based convergence).
    WorldStateService.addObject(series.id, { name: "Pie", aliases: ["PIE"], updatedAt: T0 });
    const json = bibleWith(series.id, {
      objects: {
        ko_dead: bObj({ name: "Lamp", updated_at: toIsoSeconds(T0 + 60_000), deleted: true }),
        obj_gone_44444444: bObj({ name: "Ghost Prop", updated_at: toIsoSeconds(T0), deleted: true }),
        obj_pie_tomb: bObj({ name: "Pie", aliases: ["PIE"], updated_at: toIsoSeconds(T0 + 60_000), deleted: true }),
      },
    });
    const { bridge } = makeFakeBibleBridge(json);
    installWindow(bridge);

    await importBibleIntoSeries(series.id);
    const names = WorldStateService.listObjects(series.id).map((o) => o.name);
    expect(names).toEqual(["Pie"]); // Lamp deleted; Ghost Prop not resurrected; Pie untouched
  });
});

// ---------------------------------------------------------------------------
// Series adoption + index
// ---------------------------------------------------------------------------

describe("index + series adoption", () => {
  it("upsertIndexEntry adds then updates without duplicating", () => {
    let index = parseIndexJson(null);
    index = upsertIndexEntry(index, "series_a", "Alpha", T0);
    index = upsertIndexEntry(index, "series_a", "Alpha Renamed", T0 + 60_000);
    index = upsertIndexEntry(index, "series_b", "Beta", T0 + 60_000);
    expect(index.series).toHaveLength(2);
    const a = index.series.find((s) => s.id === "series_a")!;
    expect(a.name).toBe("Alpha Renamed");
    expect(a.created_at).toBe(toIsoSeconds(T0)); // creation time preserved
    expect(a.updated_at).toBe(toIsoSeconds(T0 + 60_000));
  });

  it("adoptBibleSeries creates LW series with the bible's authoritative ids preserved", async () => {
    const lwSeries = WorldStateService.createSeries("Mine");
    const { bridge, state } = makeFakeBibleBridge();
    state.indexJson = JSON.stringify({
      version: 1,
      series: [
        { id: lwSeries.id, name: "Mine", created_at: toIsoSeconds(T0), updated_at: toIsoSeconds(T0) },
        { id: "s2s_series_42", name: "From ScriptToScreen", created_at: toIsoSeconds(T0), updated_at: toIsoSeconds(T0) },
      ],
    });
    installWindow(bridge);

    expect(await adoptBibleSeries()).toBe(1); // only the foreign one
    const ids = WorldStateService.listSeries().map((s) => s.id);
    expect(ids).toContain("s2s_series_42");
    expect(WorldStateService.getSeries("s2s_series_42")?.name).toBe("From ScriptToScreen");
    // Adopting again is a no-op.
    expect(await adoptBibleSeries()).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Live sync: no echo loops, change-driven export
// ---------------------------------------------------------------------------

describe("startBibleSync", () => {
  it("does an initial import+export round-trip and watches the series", async () => {
    const series = WorldStateService.createSeries("S");
    WorldStateService.addCharacter(series.id, { name: "Aiden", stsCharacterKey: "k1", updatedAt: T0 });
    const { bridge, state } = makeFakeBibleBridge();
    installWindow(bridge);

    await startBibleSync(series.id);
    expect(bridge.watchBible).toHaveBeenCalledWith(series.id);
    expect(parseBible(state.bibleJson).characters.k1.name).toBe("Aiden");
    stopBibleSync();
    expect(bridge.unwatchBible).toHaveBeenCalledWith(series.id);
  });

  it("NEVER echoes an import back out as an export", async () => {
    vi.useFakeTimers();
    const series = WorldStateService.createSeries("S");
    const { bridge, state } = makeFakeBibleBridge();
    installWindow(bridge);

    await startBibleSync(series.id);
    const exportsAfterStart = (bridge.writeBible as ReturnType<typeof vi.fn>).mock.calls.length;

    // ScriptToScreen adds a character and the watcher fires.
    state.bibleJson = bibleWith(series.id, {
      characters: {
        k_s2s: { name: "Boris", aliases: ["BORIS"], description: "", traits: [], ref_image_path: null, updated_at: toIsoSeconds(T0 + 60_000), source_app: "scripttoscreen", deleted: false },
      },
    });
    state.bibleMtime = 999;
    const onImported = vi.fn();
    // Re-register with an import spy by restarting the sync (same path).
    await startBibleSync(series.id, { onImported });
    for (const cb of state.changedCallbacks) cb({ seriesId: series.id });

    // Let the debounced import AND any (wrongly) scheduled export elapse.
    await vi.advanceTimersByTimeAsync(10_000);

    // The import landed in LW…
    expect(WorldStateService.listCharacters(series.id).map((c) => c.stsCharacterKey)).toContain("k_s2s");
    expect(onImported).toHaveBeenCalled();
    // …but writes made BY the import did not schedule an echo export.
    const exportsAfterImport = (bridge.writeBible as ReturnType<typeof vi.fn>).mock.calls.length;
    expect(exportsAfterImport - exportsAfterStart).toBeLessThanOrEqual(1); // only the restart's own initial export
    // And a REAL local edit still exports.
    WorldStateService.addCharacter(series.id, { name: "Nell", stsCharacterKey: "k_local", updatedAt: Date.now() });
    await vi.advanceTimersByTimeAsync(10_000);
    expect(parseBible(state.bibleJson).characters.k_local.name).toBe("Nell");
  });

  it("debounces world-state changes into one export", async () => {
    vi.useFakeTimers();
    const series = WorldStateService.createSeries("S");
    const { bridge, state } = makeFakeBibleBridge();
    installWindow(bridge);
    await startBibleSync(series.id);
    const before = (bridge.writeBible as ReturnType<typeof vi.fn>).mock.calls.length;

    WorldStateService.addCharacter(series.id, { name: "A", stsCharacterKey: "ka", updatedAt: Date.now() });
    WorldStateService.addCharacter(series.id, { name: "B", stsCharacterKey: "kb", updatedAt: Date.now() });
    WorldStateService.addLocation(series.id, { name: "C", stsLocationKey: "kc", updatedAt: Date.now() });
    // Object edits are an export trigger too ("lw-world-objects").
    WorldStateService.addObject(series.id, { name: "D", stsObjectKey: "kd", updatedAt: Date.now() });
    await vi.advanceTimersByTimeAsync(10_000);

    const after = (bridge.writeBible as ReturnType<typeof vi.fn>).mock.calls.length;
    expect(after - before).toBe(1);
    const bible = parseBible(state.bibleJson);
    expect(Object.keys(bible.characters).sort()).toEqual(["ka", "kb"]);
    expect(Object.keys(bible.locations)).toEqual(["kc"]);
    expect(Object.keys(bible.objects)).toEqual(["kd"]);
  });
});

// ---------------------------------------------------------------------------
// World-state change signal (the additive subscription used by the sync)
// ---------------------------------------------------------------------------

describe("onWorldStateChange", () => {
  it("fires with the storage key on successful writes and supports unsubscribe", () => {
    const seen: string[] = [];
    const off = onWorldStateChange((key) => seen.push(key));
    const series = WorldStateService.createSeries("S");
    WorldStateService.addLocation(series.id, { name: "Kitchen" });
    expect(seen).toContain("lw-series");
    expect(seen).toContain("lw-world-locations");
    off();
    const count = seen.length;
    WorldStateService.addCharacter(series.id, { name: "Aiden" });
    expect(seen.length).toBe(count);
  });
});
