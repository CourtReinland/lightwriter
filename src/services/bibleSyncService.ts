// Live two-way sync between LightWriter's World State (series-scoped
// characters & locations) and the shared Series Bible on disk:
//   ~/Library/Application Support/SeriesBible/
//     index.json                    — {"version":1,"series":[{id,name,created_at,updated_at}]}
//     <series_id>/bible.json        — characters{} / locations{} keyed by stable key
//     <series_id>/assets/           — bible-owned copies of reference images
//
// ScriptToScreen implements the identical contract, so assets tagged there
// appear in LightWriter near-live and vice versa. Merging is per-record
// last-writer-wins by updated_at (ISO, SECOND precision; ties keep the
// incumbent); "deleted":true tombstones win over older live data and are never
// resurrected by older records. Whole-file writes are atomic (tmp+rename) with
// optimistic mtime checks — on conflict we re-read, re-merge, and retry once.

import {
  WorldStateService,
  onWorldStateChange,
  type WorldCharacter,
  type WorldLocation,
  type WorldLocationCategory,
} from "./worldStateService";
import { persistGeneratedImageFile } from "./imageAssetStorageService";

// ---------------------------------------------------------------------------
// Contract types (identical in ScriptToScreen — do not deviate)
// ---------------------------------------------------------------------------

export type BibleSourceApp = "lightwriter" | "scripttoscreen";

export interface BibleCharacterRecord {
  name: string;
  aliases: string[];
  description: string;
  traits: string[];
  ref_image_path: string | null;
  updated_at: string;
  source_app: BibleSourceApp;
  deleted: boolean;
}

export interface BibleLocationRecord {
  name: string;
  aliases: string[];
  category: string;
  description: string;
  ref_image_path: string | null;
  updated_at: string;
  source_app: BibleSourceApp;
  deleted: boolean;
}

export interface BibleFile {
  version: 1;
  series_id: string;
  name: string;
  updated_at: string;
  characters: Record<string, BibleCharacterRecord>;
  locations: Record<string, BibleLocationRecord>;
}

export interface BibleIndexEntry {
  id: string;
  name: string;
  created_at: string;
  updated_at: string;
}

export interface BibleIndexFile {
  version: 1;
  series: BibleIndexEntry[];
}

// ---------------------------------------------------------------------------
// Electron bridge (window.lightwriterBible, exposed by preload.ts)
// ---------------------------------------------------------------------------

export interface BibleReadResult {
  json: string | null;
  mtimeMs: number | null;
}

export interface BibleWriteResult {
  ok: boolean;
  conflict: boolean;
  mtimeMs: number | null;
}

export interface LightWriterBibleBridge {
  readBible?: (seriesId: string) => Promise<BibleReadResult>;
  readIndex?: () => Promise<BibleReadResult>;
  writeBible?: (seriesId: string, json: string, expectedMtimeMs: number | null) => Promise<BibleWriteResult>;
  writeIndex?: (json: string, expectedMtimeMs: number | null) => Promise<BibleWriteResult>;
  copyAssetIn?: (seriesId: string, source: { sourcePath?: string; dataUrl?: string; mimeType?: string }, stableKey: string) => Promise<{ filePath: string }>;
  watchBible?: (seriesId: string) => Promise<{ ok: boolean }>;
  unwatchBible?: (seriesId: string) => Promise<{ ok: boolean }>;
  onBibleChanged?: (callback: (payload: { seriesId: string }) => void) => () => void;
}

declare global {
  interface Window {
    lightwriterBible?: LightWriterBibleBridge;
  }
}

function bridge(): LightWriterBibleBridge | undefined {
  return typeof window !== "undefined" ? window.lightwriterBible : undefined;
}

// ---------------------------------------------------------------------------
// Pure helpers (exported for tests)
// ---------------------------------------------------------------------------

/** ms epoch -> contract ISO timestamp at SECOND precision ("2026-07-12T10:30:00Z"). */
export function toIsoSeconds(ms: number): string {
  return `${new Date(Math.max(0, Math.floor(ms / 1000) * 1000)).toISOString().slice(0, 19)}Z`;
}

/** Contract timestamp -> whole seconds since epoch (NaN-safe: invalid -> 0). */
export function isoToSeconds(iso: string): number {
  const parsed = Date.parse(iso);
  return Number.isFinite(parsed) ? Math.floor(parsed / 1000) : 0;
}

/** ms epoch -> whole seconds (the merge granularity of the contract). */
export function msToSeconds(ms: number): number {
  return Math.floor(ms / 1000);
}

/**
 * Last-writer-wins at second precision: does `incoming` replace `incumbent`?
 * Ties keep the incumbent. Tombstones need no special casing — a newer
 * deleted record wins like any other newer record, and an older record can
 * never resurrect a tombstone because it loses the comparison.
 */
export function incomingWins(incomingSeconds: number, incumbentSeconds: number): boolean {
  return incomingSeconds > incumbentSeconds;
}

export function emptyBible(seriesId: string, name: string, nowMs: number): BibleFile {
  return {
    version: 1,
    series_id: seriesId,
    name,
    updated_at: toIsoSeconds(nowMs),
    characters: {},
    locations: {},
  };
}

export function parseBibleJson(json: string | null): BibleFile | null {
  if (!json) return null;
  try {
    const parsed = JSON.parse(json) as Partial<BibleFile> | null;
    if (!parsed || typeof parsed !== "object") return null;
    return {
      version: 1,
      series_id: String(parsed.series_id || ""),
      name: String(parsed.name || ""),
      updated_at: String(parsed.updated_at || toIsoSeconds(0)),
      characters: parsed.characters && typeof parsed.characters === "object" ? (parsed.characters as Record<string, BibleCharacterRecord>) : {},
      locations: parsed.locations && typeof parsed.locations === "object" ? (parsed.locations as Record<string, BibleLocationRecord>) : {},
    };
  } catch {
    return null;
  }
}

export function parseIndexJson(json: string | null): BibleIndexFile {
  if (json) {
    try {
      const parsed = JSON.parse(json) as Partial<BibleIndexFile> | null;
      if (parsed && Array.isArray(parsed.series)) {
        return { version: 1, series: parsed.series as BibleIndexEntry[] };
      }
    } catch {
      /* fall through to a fresh index */
    }
  }
  return { version: 1, series: [] };
}

/** Upsert one series entry into the index (immutably), bumping updated_at. */
export function upsertIndexEntry(index: BibleIndexFile, seriesId: string, name: string, nowMs: number): BibleIndexFile {
  const nowIso = toIsoSeconds(nowMs);
  const existing = index.series.find((s) => s.id === seriesId);
  const series = existing
    ? index.series.map((s) => (s.id === seriesId ? { ...s, name, updated_at: nowIso } : s))
    : [...index.series, { id: seriesId, name, created_at: nowIso, updated_at: nowIso }];
  return { version: 1, series };
}

export interface LightWriterWorldSnapshot {
  seriesName: string;
  locations: WorldLocation[];
  characters: WorldCharacter[];
}

function normalizeCategory(category: string): WorldLocationCategory {
  return category === "interior" || category === "exterior" || category === "other" ? category : "other";
}

/**
 * Merge LightWriter world records into an existing bible file (pure LWW; no
 * I/O). `refImagePaths` maps stable key -> bible-owned asset path (already
 * copied in by the caller). `tombstoneKeys` are stable keys that WERE in the
 * last export snapshot but no longer exist in LightWriter — i.e. records the
 * user deleted here — written as fresh tombstones.
 */
export function mergeWorldIntoBible(args: {
  existing: BibleFile | null;
  seriesId: string;
  world: LightWriterWorldSnapshot;
  refImagePaths: Map<string, string>;
  tombstoneKeys: { characters: string[]; locations: string[] };
  nowMs: number;
}): BibleFile {
  const { existing, seriesId, world, refImagePaths, tombstoneKeys, nowMs } = args;
  const next: BibleFile = existing
    ? { ...existing, series_id: seriesId, characters: { ...existing.characters }, locations: { ...existing.locations } }
    : emptyBible(seriesId, world.seriesName, nowMs);
  next.name = world.seriesName || next.name;

  for (const character of world.characters) {
    const key = character.stsCharacterKey;
    const incumbent = next.characters[key];
    if (incumbent && !incomingWins(msToSeconds(character.updatedAt), isoToSeconds(incumbent.updated_at))) continue;
    next.characters[key] = {
      name: character.name,
      aliases: character.aliases ?? [],
      description: character.description || "",
      traits: character.traits ?? [],
      ref_image_path: refImagePaths.get(key) ?? incumbent?.ref_image_path ?? null,
      updated_at: toIsoSeconds(character.updatedAt),
      source_app: "lightwriter",
      deleted: false,
    };
  }

  for (const location of world.locations) {
    const key = location.stsLocationKey;
    const incumbent = next.locations[key];
    if (incumbent && !incomingWins(msToSeconds(location.updatedAt), isoToSeconds(incumbent.updated_at))) continue;
    next.locations[key] = {
      name: location.name,
      aliases: location.aliases ?? [],
      category: location.category,
      description: location.description || "",
      ref_image_path: refImagePaths.get(key) ?? incumbent?.ref_image_path ?? null,
      updated_at: toIsoSeconds(location.updatedAt),
      source_app: "lightwriter",
      deleted: false,
    };
  }

  // Records deleted in LightWriter since the previous export become tombstones
  // (timestamped now, so a CONCURRENT newer edit elsewhere still wins later).
  const liveCharacterKeys = new Set(world.characters.map((c) => c.stsCharacterKey));
  for (const key of tombstoneKeys.characters) {
    if (liveCharacterKeys.has(key)) continue;
    const incumbent = next.characters[key];
    if (incumbent && !incomingWins(msToSeconds(nowMs), isoToSeconds(incumbent.updated_at))) continue;
    next.characters[key] = {
      name: incumbent?.name || key,
      aliases: incumbent?.aliases ?? [],
      description: incumbent?.description || "",
      traits: incumbent?.traits ?? [],
      ref_image_path: null,
      updated_at: toIsoSeconds(nowMs),
      source_app: "lightwriter",
      deleted: true,
    };
  }
  const liveLocationKeys = new Set(world.locations.map((l) => l.stsLocationKey));
  for (const key of tombstoneKeys.locations) {
    if (liveLocationKeys.has(key)) continue;
    const incumbent = next.locations[key];
    if (incumbent && !incomingWins(msToSeconds(nowMs), isoToSeconds(incumbent.updated_at))) continue;
    next.locations[key] = {
      name: incumbent?.name || key,
      aliases: incumbent?.aliases ?? [],
      category: incumbent?.category || "other",
      description: incumbent?.description || "",
      ref_image_path: null,
      updated_at: toIsoSeconds(nowMs),
      source_app: "lightwriter",
      deleted: true,
    };
  }

  // File-level updated_at = newest record timestamp (or now).
  let newest = msToSeconds(nowMs);
  for (const record of [...Object.values(next.characters), ...Object.values(next.locations)]) {
    newest = Math.max(newest, isoToSeconds(record.updated_at));
  }
  next.updated_at = toIsoSeconds(newest * 1000);
  return next;
}

// ---------------------------------------------------------------------------
// Settings + status
// ---------------------------------------------------------------------------

const SYNC_ENABLED_KEY = "lw-bible-sync-enabled";
const EXPORTED_KEYS_PREFIX = "lw-bible-exported-keys-";

/** Default ON — a missing key means enabled. */
export function isBibleSyncEnabled(): boolean {
  try {
    return localStorage.getItem(SYNC_ENABLED_KEY) !== "0";
  } catch {
    return true;
  }
}

export function setBibleSyncEnabled(enabled: boolean): void {
  try {
    localStorage.setItem(SYNC_ENABLED_KEY, enabled ? "1" : "0");
  } catch {
    /* best effort */
  }
  // Live-apply without app re-wiring: restart (or stop) sync for the series
  // the app last asked us to sync.
  if (enabled) {
    if (requestedSeriesId) void startBibleSync(requestedSeriesId, requestedOptions);
  } else {
    stopBibleSync();
  }
}

type SyncStatusListener = () => void;
const syncStatusListeners: SyncStatusListener[] = [];
const lastSyncAt = new Map<string, number>();

/** Epoch ms of the last successful import OR export for a series (this session). */
export function getLastBibleSync(seriesId: string): number | null {
  return lastSyncAt.get(seriesId) ?? null;
}

export function onBibleSyncStatus(listener: SyncStatusListener): () => void {
  syncStatusListeners.push(listener);
  return () => {
    const i = syncStatusListeners.indexOf(listener);
    if (i >= 0) syncStatusListeners.splice(i, 1);
  };
}

function markSynced(seriesId: string): void {
  lastSyncAt.set(seriesId, Date.now());
  for (const listener of [...syncStatusListeners]) {
    try {
      listener();
    } catch {
      /* ignore */
    }
  }
}

// Stable keys present in LightWriter at the time of the LAST export — the safe
// basis for tombstoning: a key in this snapshot that has since vanished from
// LightWriter was deleted HERE (an S2S-created key we never held can't appear).
interface ExportedKeysSnapshot {
  characters: string[];
  locations: string[];
}

function readExportedKeys(seriesId: string): ExportedKeysSnapshot {
  try {
    const raw = localStorage.getItem(EXPORTED_KEYS_PREFIX + seriesId);
    const parsed = raw ? (JSON.parse(raw) as Partial<ExportedKeysSnapshot>) : null;
    return {
      characters: Array.isArray(parsed?.characters) ? parsed.characters : [],
      locations: Array.isArray(parsed?.locations) ? parsed.locations : [],
    };
  } catch {
    return { characters: [], locations: [] };
  }
}

function writeExportedKeys(seriesId: string, snapshot: ExportedKeysSnapshot): void {
  try {
    localStorage.setItem(EXPORTED_KEYS_PREFIX + seriesId, JSON.stringify(snapshot));
  } catch {
    /* best effort */
  }
}

// ---------------------------------------------------------------------------
// Export: LightWriter world records -> bible.json (+ index.json upsert)
// ---------------------------------------------------------------------------

// True while an import is writing into WorldStateService, so the world-state
// change listener does NOT echo the import straight back out as an export.
let importingFromBible = false;

/** Copy every record's reference image into the bible; returns stableKey -> bible asset path. */
async function copyRefImagesIntoBible(api: LightWriterBibleBridge, seriesId: string, world: LightWriterWorldSnapshot): Promise<Map<string, string>> {
  const paths = new Map<string, string>();
  if (!api.copyAssetIn) return paths;
  const records: Array<{ key: string; record: WorldLocation | WorldCharacter }> = [
    ...world.characters.map((c) => ({ key: c.stsCharacterKey, record: c as WorldLocation | WorldCharacter })),
    ...world.locations.map((l) => ({ key: l.stsLocationKey, record: l as WorldLocation | WorldCharacter })),
  ];
  for (const { key, record } of records) {
    try {
      let sourcePath = record.referenceFilePath;
      if (!sourcePath && record.referenceImageDataUrl) {
        // Persist the inline data url to disk via the existing asset bridge
        // first, then hand the bible a file to copy (it must own its copy).
        sourcePath = await persistGeneratedImageFile({
          projectId: record.seriesId,
          assetId: record.id,
          name: record.name,
          mimeType: record.referenceMimeType || "image/png",
          dataUrl: record.referenceImageDataUrl,
        });
        if (!sourcePath) {
          const { filePath } = await api.copyAssetIn(seriesId, { dataUrl: record.referenceImageDataUrl, mimeType: record.referenceMimeType }, key);
          paths.set(key, filePath);
          continue;
        }
      }
      if (!sourcePath) continue;
      const { filePath } = await api.copyAssetIn(seriesId, { sourcePath }, key);
      paths.set(key, filePath);
    } catch (err) {
      console.warn(`BibleSync: failed to copy reference image for "${key}" into the bible.`, err);
    }
  }
  return paths;
}

async function writeIndexUpsert(api: LightWriterBibleBridge, seriesId: string, name: string): Promise<void> {
  if (!api.readIndex || !api.writeIndex) return;
  for (let attempt = 0; attempt < 2; attempt++) {
    const { json, mtimeMs } = await api.readIndex();
    const next = upsertIndexEntry(parseIndexJson(json), seriesId, name, Date.now());
    const result = await api.writeIndex(JSON.stringify(next, null, 2), mtimeMs);
    if (result.ok) return;
    if (!result.conflict) return; // hard failure — nothing more to do
  }
  console.warn("BibleSync: index.json write still conflicting after retry; leaving it for the next sync.");
}

/**
 * Read-merge-write the active series' world records into the shared bible.
 * Returns true when the bible (and index) were written.
 */
export async function exportSeriesToBible(seriesId: string): Promise<boolean> {
  const api = bridge();
  if (!api?.readBible || !api.writeBible) return false;
  const series = WorldStateService.getSeries(seriesId);
  if (!series) return false;

  const world: LightWriterWorldSnapshot = {
    seriesName: series.name,
    locations: WorldStateService.listLocations(seriesId),
    characters: WorldStateService.listCharacters(seriesId),
  };
  const refImagePaths = await copyRefImagesIntoBible(api, seriesId, world);
  const previous = readExportedKeys(seriesId);

  let written = false;
  for (let attempt = 0; attempt < 2; attempt++) {
    const { json, mtimeMs } = await api.readBible(seriesId);
    const next = mergeWorldIntoBible({
      existing: parseBibleJson(json),
      seriesId,
      world,
      refImagePaths,
      tombstoneKeys: previous,
      nowMs: Date.now(),
    });
    const result = await api.writeBible(seriesId, JSON.stringify(next, null, 2), mtimeMs);
    if (result.ok) {
      written = true;
      break;
    }
    if (!result.conflict) break; // hard failure
    // conflict -> loop re-reads the newer file, re-merges, retries ONCE
  }
  if (!written) return false;

  writeExportedKeys(seriesId, {
    characters: world.characters.map((c) => c.stsCharacterKey),
    locations: world.locations.map((l) => l.stsLocationKey),
  });
  await writeIndexUpsert(api, seriesId, series.name);
  markSynced(seriesId);
  return true;
}

// ---------------------------------------------------------------------------
// Import: bible.json -> WorldStateService upserts/deletes
// ---------------------------------------------------------------------------

/**
 * Pull bible records into LightWriter's world state. Per stable key: a bible
 * record STRICTLY newer (second precision) than the matching LW record wins
 * (tie keeps the LW incumbent); tombstones delete the LW record; unknown live
 * records are created with the bible's stable key preserved. Never triggers
 * an export (the change-listener is suppressed while importing).
 */
export async function importBibleIntoSeries(seriesId: string): Promise<boolean> {
  const api = bridge();
  if (!api?.readBible) return false;
  const { json } = await api.readBible(seriesId);
  const bible = parseBibleJson(json);
  if (!bible) return false;

  importingFromBible = true;
  try {
    // Characters --------------------------------------------------------
    const lwCharacters = WorldStateService.listCharacters(seriesId);
    for (const [key, record] of Object.entries(bible.characters)) {
      const existing = lwCharacters.find((c) => c.stsCharacterKey === key);
      const bibleSeconds = isoToSeconds(record.updated_at);
      if (record.deleted) {
        if (existing && incomingWins(bibleSeconds, msToSeconds(existing.updatedAt))) {
          WorldStateService.deleteCharacter(existing.id);
        }
        continue;
      }
      const updates: Partial<WorldCharacter> = {
        name: record.name,
        aliases: record.aliases?.length ? record.aliases : [record.name.toUpperCase()],
        description: record.description || "",
        traits: record.traits ?? [],
        // The bible's assets/ dir IS durable disk storage — point at it directly.
        referenceFilePath: record.ref_image_path ?? undefined,
        referenceImageDataUrl: undefined,
        // Preserve the bible timestamp so re-exports tie (no echo churn).
        updatedAt: bibleSeconds * 1000,
      };
      if (existing) {
        if (incomingWins(bibleSeconds, msToSeconds(existing.updatedAt))) {
          WorldStateService.updateCharacter(existing.id, updates);
        }
      } else {
        WorldStateService.addCharacter(seriesId, { ...updates, name: record.name, stsCharacterKey: key });
      }
    }

    // Locations ----------------------------------------------------------
    const lwLocations = WorldStateService.listLocations(seriesId);
    for (const [key, record] of Object.entries(bible.locations)) {
      const existing = lwLocations.find((l) => l.stsLocationKey === key);
      const bibleSeconds = isoToSeconds(record.updated_at);
      if (record.deleted) {
        if (existing && incomingWins(bibleSeconds, msToSeconds(existing.updatedAt))) {
          WorldStateService.deleteLocation(existing.id);
        }
        continue;
      }
      const updates: Partial<WorldLocation> = {
        name: record.name,
        aliases: record.aliases?.length ? record.aliases : [record.name.toUpperCase()],
        category: normalizeCategory(record.category),
        description: record.description || "",
        referenceFilePath: record.ref_image_path ?? undefined,
        referenceImageDataUrl: undefined,
        updatedAt: bibleSeconds * 1000,
      };
      if (existing) {
        if (incomingWins(bibleSeconds, msToSeconds(existing.updatedAt))) {
          WorldStateService.updateLocation(existing.id, updates);
        }
      } else {
        WorldStateService.addLocation(seriesId, { ...updates, name: record.name, stsLocationKey: key });
      }
    }
  } finally {
    importingFromBible = false;
  }
  markSynced(seriesId);
  return true;
}

/**
 * Adopt bible series created elsewhere (e.g. by ScriptToScreen) into
 * LightWriter's series list, PRESERVING the bible's authoritative series id.
 * Returns how many new series were adopted.
 */
export async function adoptBibleSeries(): Promise<number> {
  const api = bridge();
  if (!api?.readIndex) return 0;
  const { json } = await api.readIndex();
  const index = parseIndexJson(json);
  let adopted = 0;
  const known = new Set(WorldStateService.listSeries().map((s) => s.id));
  for (const entry of index.series) {
    if (!entry?.id || known.has(entry.id)) continue;
    WorldStateService.ensureSeries(entry.id, entry.name || "Untitled Series");
    adopted += 1;
  }
  return adopted;
}

// ---------------------------------------------------------------------------
// Live sync orchestration
// ---------------------------------------------------------------------------

const IMPORT_DEBOUNCE_MS = 300; // main already debounces fs.watch by 500ms
const EXPORT_DEBOUNCE_MS = 2000;

// World-state storage keys whose changes should trigger an export.
const EXPORT_TRIGGER_KEYS = new Set(["lw-series", "lw-world-locations", "lw-world-characters"]);

export interface BibleSyncOptions {
  /** Called after each import that may have changed world records (bump UI versions). */
  onImported?: () => void;
}

interface ActiveSync {
  seriesId: string;
  stopWorldListener: () => void;
  stopBibleListener: (() => void) | null;
  importTimer: ReturnType<typeof setTimeout> | null;
  exportTimer: ReturnType<typeof setTimeout> | null;
  stopped: boolean;
}

let activeSync: ActiveSync | null = null;
// The series the app last asked to sync — kept even while the toggle is off so
// re-enabling in Settings can resume without re-wiring.
let requestedSeriesId: string | null = null;
let requestedOptions: BibleSyncOptions | undefined;

function scheduleImport(sync: ActiveSync, options?: BibleSyncOptions): void {
  if (sync.importTimer) clearTimeout(sync.importTimer);
  sync.importTimer = setTimeout(() => {
    sync.importTimer = null;
    void importBibleIntoSeries(sync.seriesId)
      .then((changed) => {
        if (changed && !sync.stopped) options?.onImported?.();
      })
      .catch((err) => console.warn("BibleSync: import failed.", err));
  }, IMPORT_DEBOUNCE_MS);
}

function scheduleExport(sync: ActiveSync): void {
  if (sync.exportTimer) clearTimeout(sync.exportTimer);
  sync.exportTimer = setTimeout(() => {
    sync.exportTimer = null;
    void exportSeriesToBible(sync.seriesId).catch((err) => console.warn("BibleSync: export failed.", err));
  }, EXPORT_DEBOUNCE_MS);
}

/**
 * Start two-way sync for a series: initial import (bible -> LW) then export
 * (LW -> bible), then keep listening — bible file changes re-import, world
 * state changes re-export. Replaces any previous sync. No-ops in the browser
 * (no bridge) or when the Settings toggle is off. The returned promise
 * resolves when the INITIAL import+export round-trip has finished.
 */
export async function startBibleSync(seriesId: string, options?: BibleSyncOptions): Promise<void> {
  requestedSeriesId = seriesId;
  requestedOptions = options;
  stopBibleSync();
  const api = bridge();
  if (!api?.readBible || !isBibleSyncEnabled()) return;

  const sync: ActiveSync = {
    seriesId,
    stopWorldListener: () => {},
    stopBibleListener: null,
    importTimer: null,
    exportTimer: null,
    stopped: false,
  };
  activeSync = sync;

  // World-state changes (outside an import) -> debounced export.
  sync.stopWorldListener = onWorldStateChange((storageKey) => {
    if (sync.stopped || importingFromBible) return;
    if (!EXPORT_TRIGGER_KEYS.has(storageKey)) return;
    scheduleExport(sync);
  });

  // Bible file changes (ScriptToScreen wrote) -> debounced import.
  if (api.onBibleChanged) {
    sync.stopBibleListener = api.onBibleChanged(({ seriesId: changedId }) => {
      if (sync.stopped || changedId !== sync.seriesId) return;
      scheduleImport(sync, options);
    });
  }
  if (api.watchBible) {
    void api.watchBible(seriesId).catch((err) => console.warn("BibleSync: watch failed.", err));
  }

  // Adopt foreign series into LW's list, then the initial round-trip.
  try {
    await adoptBibleSeries();
  } catch (err) {
    console.warn("BibleSync: series adoption failed.", err);
  }
  try {
    const changed = await importBibleIntoSeries(seriesId);
    if (changed && !sync.stopped) options?.onImported?.();
  } catch (err) {
    console.warn("BibleSync: initial import failed.", err);
  }
  if (sync.stopped) return;
  try {
    await exportSeriesToBible(seriesId);
  } catch (err) {
    console.warn("BibleSync: initial export failed.", err);
  }
}

/** Stop the active sync (listeners, timers, and the main-process watcher). */
export function stopBibleSync(): void {
  const sync = activeSync;
  if (!sync) return;
  activeSync = null;
  sync.stopped = true;
  if (sync.importTimer) clearTimeout(sync.importTimer);
  if (sync.exportTimer) clearTimeout(sync.exportTimer);
  sync.stopWorldListener();
  sync.stopBibleListener?.();
  const api = bridge();
  if (api?.unwatchBible) void api.unwatchBible(sync.seriesId).catch(() => {});
}
