// Portable "World State": locations (and later props/world rules) that persist
// ACROSS scripts grouped into a named Series — so the family kitchen in script 1
// is the same kitchen, with the same reference image and ScriptToScreen id, in
// script 2. A Project opts into a Series via Project.seriesId.

import { persistGeneratedImageFile } from "./imageAssetStorageService";

export interface Series {
  id: string;
  name: string;
  /** Project IDs in episode order (index 0 = episode 1). */
  episodeOrder: string[];
  createdAt: number;
  updatedAt: number;
}

/** A plot or character through-line spanning a range of episodes (0-based, inclusive). */
export interface SeriesArc {
  id: string;
  seriesId: string;
  kind: "plot" | "character";
  name: string;
  description: string;
  /** Character this arc tracks (for kind="character"). */
  characterName?: string;
  startEpisode: number;
  endEpisode: number;
  color?: string;
  createdAt: number;
  updatedAt: number;
}

/** A cliffhanger link: episode `fromEpisode` must END on a hook that OPENS `toEpisode` (= fromEpisode + 1). */
export interface SeriesCliffhanger {
  id: string;
  seriesId: string;
  fromEpisode: number;
  toEpisode: number;
  description: string;
  createdAt: number;
  updatedAt: number;
}

export type WorldLocationCategory = "interior" | "exterior" | "other";

export interface WorldLocation {
  id: string;
  seriesId: string;
  /** Human-facing name, e.g. "Maddox Family Kitchen". */
  name: string;
  /** Uppercase scene-heading tokens that should resolve to this location, e.g. ["KITCHEN", "FAMILY KITCHEN"]. */
  aliases: string[];
  category: WorldLocationCategory;
  description: string;
  referenceImageDataUrl?: string;
  referenceMimeType?: string;
  /** Durable on-disk path of the reference image (Electron), for ScriptToScreen handoff. */
  referenceFilePath?: string;
  /** Stable key carried into the ScriptToScreen manifest's locations{}. */
  stsLocationKey: string;
  createdAt: number;
  updatedAt: number;
}

/**
 * A portable, series-scoped character (sibling to WorldLocation): the same Aiden,
 * with the same portrait and ScriptToScreen id, across every script in the series.
 * Resolved from a Fountain CHARACTER cue via its uppercase `aliases`.
 */
export interface WorldCharacter {
  id: string;
  seriesId: string;
  /** Human-facing name, e.g. "Aiden". */
  name: string;
  /** Uppercase CHARACTER-cue tokens that resolve to this character, e.g. ["AIDEN", "YOUNG AIDEN"]. */
  aliases: string[];
  /** Appearance / who they are — used for portrait generation & continuity. */
  description: string;
  traits?: string[];
  voiceNotes?: string;
  referenceImageDataUrl?: string;
  referenceMimeType?: string;
  /** Durable on-disk path of the portrait (Electron), for ScriptToScreen handoff. */
  referenceFilePath?: string;
  /** Stable key carried into the ScriptToScreen manifest's characters{}. */
  stsCharacterKey: string;
  createdAt: number;
  updatedAt: number;
}

const SERIES_KEY = "lw-series";
const LOCATIONS_KEY = "lw-world-locations";
const CHARACTERS_KEY = "lw-world-characters";
const BINDINGS_PREFIX = "lw-scene-locations-";
const ARCS_KEY = "lw-series-arcs";
const CLIFFHANGERS_KEY = "lw-series-cliffhangers";
const MIGRATION_KEY = "lw-world-images-migrated-v1";

/** Per-script map: scene index (as string) -> world location id. */
export type SceneLocationBindings = Record<string, string>;

function uid(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
}

// ---------------------------------------------------------------------------
// Pure matching helpers (no storage — unit-tested)
// ---------------------------------------------------------------------------

/**
 * Pull the location token out of a scene heading:
 *   "INT. KITCHEN - DAY"            -> "KITCHEN"
 *   "EXT. MADDOX HOUSE - BACKYARD - NIGHT" -> "MADDOX HOUSE - BACKYARD"
 *   ".A SECRET ROOM"               -> "A SECRET ROOM"
 * Returns "" if the line isn't a scene heading.
 */
export function extractLocationToken(heading: string): string {
  let t = heading.trim();
  const m = t.match(/^(INT\.?\/EXT\.?|I\/E\.?|INT\.|EXT\.|EST\.|\.)\s*/i);
  if (!m) return "";
  t = t.slice(m[0].length).trim();
  // Strip a trailing time-of-day / qualifier after the last " - ".
  const TIME = /\b(DAY|NIGHT|DAWN|DUSK|MORNING|AFTERNOON|EVENING|LATER|CONTINUOUS|MOMENTS? LATER|SAME)\b/i;
  const parts = t.split(/\s+-\s+/);
  if (parts.length > 1 && TIME.test(parts[parts.length - 1])) parts.pop();
  return parts.join(" - ").trim();
}

function norm(s: string): string {
  return s.toUpperCase().replace(/[^A-Z0-9 ]/g, "").replace(/\s+/g, " ").trim();
}

/** Does a world location match a scene-heading location token? */
export function locationMatchesToken(loc: WorldLocation, token: string): boolean {
  const t = norm(token);
  if (!t) return false;
  const candidates = [loc.name, ...loc.aliases].map(norm).filter(Boolean);
  return candidates.some((c) => c === t || c.includes(t) || t.includes(c));
}

/** Rank matches: exact alias/name first, then contains. */
export function matchLocations(locations: WorldLocation[], token: string): WorldLocation[] {
  const t = norm(token);
  if (!t) return [];
  const score = (loc: WorldLocation): number => {
    const cands = [loc.name, ...loc.aliases].map(norm);
    if (cands.some((c) => c === t)) return 0;
    if (cands.some((c) => c.includes(t))) return 1;
    if (cands.some((c) => t.includes(c))) return 2;
    return 99;
  };
  return locations
    .map((loc) => ({ loc, s: score(loc) }))
    .filter((x) => x.s < 99)
    .sort((a, b) => a.s - b.s)
    .map((x) => x.loc);
}

/**
 * Pull the bare character name out of a Fountain CHARACTER cue:
 *   "AIDEN"           -> "AIDEN"
 *   "@Aiden"          -> "Aiden"
 *   "AIDEN (V.O.)"    -> "AIDEN"
 *   "AIDEN ^"         -> "AIDEN"  (dual-dialogue caret)
 * Returns "" for an empty cue.
 */
export function extractCharacterName(cue: string): string {
  let t = cue.trim();
  if (!t) return "";
  t = t.replace(/^@/, "");            // forced-character prefix
  t = t.replace(/\^\s*$/, "");         // dual-dialogue caret
  t = t.replace(/\s*\([^)]*\)\s*$/, ""); // trailing (V.O.) / (CONT'D) / (O.S.)
  return t.trim();
}

/** Does a world character match a CHARACTER-cue name? */
export function characterMatchesName(c: WorldCharacter, name: string): boolean {
  const t = norm(name);
  if (!t) return false;
  const candidates = [c.name, ...c.aliases].map(norm).filter(Boolean);
  return candidates.some((cand) => cand === t || cand.includes(t) || t.includes(cand));
}

/** Rank character matches: exact name/alias first, then contains. */
export function matchCharacters(characters: WorldCharacter[], name: string): WorldCharacter[] {
  const t = norm(name);
  if (!t) return [];
  const score = (c: WorldCharacter): number => {
    const cands = [c.name, ...c.aliases].map(norm);
    if (cands.some((cand) => cand === t)) return 0;
    if (cands.some((cand) => cand.includes(t))) return 1;
    if (cands.some((cand) => t.includes(cand))) return 2;
    return 99;
  };
  return characters
    .map((c) => ({ c, s: score(c) }))
    .filter((x) => x.s < 99)
    .sort((a, b) => a.s - b.s)
    .map((x) => x.c);
}

const HEADING_RE = /^(INT\.|EXT\.|EST\.|INT\.?\/EXT\.?|I\/E\.?)/i;

export function isSceneHeading(line: string): boolean {
  const t = line.trim();
  return HEADING_RE.test(t) || /^\.[A-Z]/.test(t);
}

export interface SceneAtCursor {
  /** 0-based index of this scene among all scene headings (aligns with export). */
  index: number;
  heading: string;
  token: string;
  /** 1-based line number of the scene heading. */
  headingLine: number;
}

/** Find the scene that contains a 1-based cursor line, or null if before the first heading. */
export function findSceneAtLine(content: string, cursorLine1Based: number): SceneAtCursor | null {
  const lines = content.split("\n");
  let sceneIndex = -1;
  let current: SceneAtCursor | null = null;
  for (let i = 0; i < lines.length; i++) {
    if (isSceneHeading(lines[i])) {
      sceneIndex += 1;
      if (i + 1 <= cursorLine1Based) {
        current = {
          index: sceneIndex,
          heading: lines[i].trim(),
          token: extractLocationToken(lines[i]),
          headingLine: i + 1,
        };
      } else {
        break; // headings past the cursor can't contain it
      }
    }
  }
  return current;
}

/** Every scene heading in the script, with its 0-based index, 1-based line, and location token. */
export function listSceneHeadings(content: string): { index: number; heading: string; token: string; line: number }[] {
  const out: { index: number; heading: string; token: string; line: number }[] = [];
  let index = -1;
  const lines = content.split("\n");
  for (let i = 0; i < lines.length; i++) {
    if (isSceneHeading(lines[i])) {
      index += 1;
      out.push({ index, heading: lines[i].trim(), token: extractLocationToken(lines[i]), line: i + 1 });
    }
  }
  return out;
}

/** Split a comma/semicolon/newline list of aliases into normalized uppercase tokens. */
export function parseAliases(input: string): string[] {
  return Array.from(
    new Set(
      input
        .split(/[,;\n]/)
        .map((a) => a.trim().toUpperCase())
        .filter(Boolean),
    ),
  );
}

// ---------------------------------------------------------------------------
// Series arc / cliffhanger query helpers (pure — unit-tested)
// ---------------------------------------------------------------------------

/** Arcs live in a given episode (0-based), sorted plot-first then by name. */
export function activeArcsForEpisode(arcs: SeriesArc[], episodeIndex: number): SeriesArc[] {
  return arcs
    .filter((a) => episodeIndex >= a.startEpisode && episodeIndex <= a.endEpisode)
    .sort((a, b) => (a.kind === b.kind ? a.name.localeCompare(b.name) : a.kind === "plot" ? -1 : 1));
}

/** The cliffhanger this episode must END on (feeding the next episode), if any. */
export function cliffhangerEndingEpisode(cliffs: SeriesCliffhanger[], episodeIndex: number): SeriesCliffhanger | null {
  return cliffs.find((c) => c.fromEpisode === episodeIndex) || null;
}

/** The prior cliffhanger this episode must OPEN by resolving/continuing, if any. */
export function cliffhangerOpeningEpisode(cliffs: SeriesCliffhanger[], episodeIndex: number): SeriesCliffhanger | null {
  return cliffs.find((c) => c.toEpisode === episodeIndex) || null;
}

// ---------------------------------------------------------------------------
// Persistence
// ---------------------------------------------------------------------------

function read<T>(key: string): T[] {
  if (typeof localStorage === "undefined") return [];
  try {
    const raw = localStorage.getItem(key);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? (parsed as T[]) : [];
  } catch {
    return [];
  }
}

// Set when a write() hits a storage quota error, so the UI can surface it
// instead of silently losing the write. Cleared via clearStorageQuotaError().
let storageQuotaError = false;

function isQuotaError(err: unknown): boolean {
  const e = err as { name?: string; code?: number } | null;
  return (
    !!e &&
    (e.name === "QuotaExceededError" || e.code === 22 || /quota/i.test(String(err)))
  );
}

/**
 * Best-effort persist. Returns true on success, false on any failure (data is
 * NOT thrown away silently — the boolean lets callers react). A quota failure
 * additionally raises the module quota flag so the app can warn the user.
 */
function write<T>(key: string, value: T[]): boolean {
  if (typeof localStorage === "undefined") return false;
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch (err) {
    if (isQuotaError(err)) {
      storageQuotaError = true;
      console.warn(`WorldState: localStorage quota exceeded writing "${key}"; write dropped.`, err);
    }
    return false;
  }
}

export const WorldStateService = {
  // Series ------------------------------------------------------------------
  listSeries(): Series[] {
    return read<Series>(SERIES_KEY).sort((a, b) => b.updatedAt - a.updatedAt);
  },

  getSeries(id: string): Series | null {
    return read<Series>(SERIES_KEY).find((s) => s.id === id) || null;
  },

  createSeries(name: string): Series {
    const now = Date.now();
    const series: Series = { id: uid("series"), name: name.trim() || "Untitled Series", episodeOrder: [], createdAt: now, updatedAt: now };
    const all = read<Series>(SERIES_KEY);
    all.push(series);
    write(SERIES_KEY, all);
    return series;
  },

  renameSeries(id: string, name: string): void {
    const all = read<Series>(SERIES_KEY);
    const s = all.find((x) => x.id === id);
    if (s) {
      s.name = name.trim() || s.name;
      s.updatedAt = Date.now();
      write(SERIES_KEY, all);
    }
  },

  deleteSeries(id: string): void {
    write(SERIES_KEY, read<Series>(SERIES_KEY).filter((s) => s.id !== id));
    write(LOCATIONS_KEY, read<WorldLocation>(LOCATIONS_KEY).filter((l) => l.seriesId !== id));
    write(CHARACTERS_KEY, read<WorldCharacter>(CHARACTERS_KEY).filter((c) => c.seriesId !== id));
  },

  // Locations ---------------------------------------------------------------
  listLocations(seriesId: string): WorldLocation[] {
    return read<WorldLocation>(LOCATIONS_KEY)
      .filter((l) => l.seriesId === seriesId)
      .sort((a, b) => a.name.localeCompare(b.name));
  },

  getLocation(id: string): WorldLocation | null {
    return read<WorldLocation>(LOCATIONS_KEY).find((l) => l.id === id) || null;
  },

  addLocation(seriesId: string, input: Partial<WorldLocation> & { name: string }): WorldLocation {
    const now = Date.now();
    const loc: WorldLocation = {
      id: uid("loc"),
      seriesId,
      name: input.name.trim(),
      aliases: input.aliases && input.aliases.length ? input.aliases : [input.name.trim().toUpperCase()],
      category: input.category || "interior",
      description: input.description || "",
      referenceImageDataUrl: input.referenceImageDataUrl,
      referenceMimeType: input.referenceMimeType,
      referenceFilePath: input.referenceFilePath,
      stsLocationKey: input.stsLocationKey || uid("stsloc"),
      createdAt: now,
      updatedAt: now,
    };
    const all = read<WorldLocation>(LOCATIONS_KEY);
    all.push(loc);
    write(LOCATIONS_KEY, all);
    return loc;
  },

  updateLocation(id: string, updates: Partial<WorldLocation>): WorldLocation | null {
    const all = read<WorldLocation>(LOCATIONS_KEY);
    const i = all.findIndex((l) => l.id === id);
    if (i < 0) return null;
    all[i] = { ...all[i], ...updates, id: all[i].id, seriesId: all[i].seriesId, updatedAt: Date.now() };
    write(LOCATIONS_KEY, all);
    return all[i];
  },

  deleteLocation(id: string): void {
    write(LOCATIONS_KEY, read<WorldLocation>(LOCATIONS_KEY).filter((l) => l.id !== id));
  },

  /** Locations in a series that match a scene heading, best first. */
  matchForHeading(seriesId: string, heading: string): WorldLocation[] {
    return matchLocations(this.listLocations(seriesId), extractLocationToken(heading));
  },

  // Characters (portable across the series, sibling to locations) -----------
  listCharacters(seriesId: string): WorldCharacter[] {
    return read<WorldCharacter>(CHARACTERS_KEY)
      .filter((c) => c.seriesId === seriesId)
      .sort((a, b) => a.name.localeCompare(b.name));
  },

  getCharacter(id: string): WorldCharacter | null {
    return read<WorldCharacter>(CHARACTERS_KEY).find((c) => c.id === id) || null;
  },

  addCharacter(seriesId: string, input: Partial<WorldCharacter> & { name: string }): WorldCharacter {
    const now = Date.now();
    const character: WorldCharacter = {
      id: uid("char"),
      seriesId,
      name: input.name.trim(),
      aliases: input.aliases && input.aliases.length ? input.aliases : [input.name.trim().toUpperCase()],
      description: input.description || "",
      traits: input.traits,
      voiceNotes: input.voiceNotes,
      referenceImageDataUrl: input.referenceImageDataUrl,
      referenceMimeType: input.referenceMimeType,
      referenceFilePath: input.referenceFilePath,
      stsCharacterKey: input.stsCharacterKey || uid("stschar"),
      createdAt: now,
      updatedAt: now,
    };
    const all = read<WorldCharacter>(CHARACTERS_KEY);
    all.push(character);
    write(CHARACTERS_KEY, all);
    return character;
  },

  updateCharacter(id: string, updates: Partial<WorldCharacter>): WorldCharacter | null {
    const all = read<WorldCharacter>(CHARACTERS_KEY);
    const i = all.findIndex((c) => c.id === id);
    if (i < 0) return null;
    all[i] = { ...all[i], ...updates, id: all[i].id, seriesId: all[i].seriesId, updatedAt: Date.now() };
    write(CHARACTERS_KEY, all);
    return all[i];
  },

  deleteCharacter(id: string): void {
    write(CHARACTERS_KEY, read<WorldCharacter>(CHARACTERS_KEY).filter((c) => c.id !== id));
  },

  /** Characters in a series that match a CHARACTER cue, best first. */
  matchForCue(seriesId: string, cue: string): WorldCharacter[] {
    return matchCharacters(this.listCharacters(seriesId), extractCharacterName(cue));
  },

  // Per-script scene -> location bindings (override on top of alias auto-match)
  getBindings(projectId: string): SceneLocationBindings {
    if (typeof localStorage === "undefined") return {};
    try {
      const raw = localStorage.getItem(BINDINGS_PREFIX + projectId);
      const parsed = raw ? JSON.parse(raw) : {};
      return parsed && typeof parsed === "object" ? (parsed as SceneLocationBindings) : {};
    } catch {
      return {};
    }
  },

  setBindings(projectId: string, bindings: SceneLocationBindings): void {
    if (typeof localStorage === "undefined") return;
    try {
      localStorage.setItem(BINDINGS_PREFIX + projectId, JSON.stringify(bindings));
    } catch {
      /* quota — best effort */
    }
  },

  bindScene(projectId: string, sceneIndex: number, locationId: string): void {
    const b = this.getBindings(projectId);
    b[String(sceneIndex)] = locationId;
    this.setBindings(projectId, b);
  },

  unbindScene(projectId: string, sceneIndex: number): void {
    const b = this.getBindings(projectId);
    delete b[String(sceneIndex)];
    this.setBindings(projectId, b);
  },

  boundLocationId(projectId: string, sceneIndex: number): string | undefined {
    return this.getBindings(projectId)[String(sceneIndex)];
  },

  /** Resolve a scene to its world location: explicit binding first, else best alias match. */
  resolveLocationForScene(projectId: string, seriesId: string, sceneIndex: number, heading: string): WorldLocation | null {
    const boundId = this.boundLocationId(projectId, sceneIndex);
    if (boundId) {
      const bound = this.getLocation(boundId);
      if (bound) return bound;
    }
    return this.matchForHeading(seriesId, heading)[0] || null;
  },

  // Episode order ----------------------------------------------------------
  getEpisodeOrder(seriesId: string): string[] {
    return this.getSeries(seriesId)?.episodeOrder ?? [];
  },

  setEpisodeOrder(seriesId: string, projectIds: string[]): void {
    const all = read<Series>(SERIES_KEY);
    const s = all.find((x) => x.id === seriesId);
    if (s) {
      s.episodeOrder = projectIds;
      s.updatedAt = Date.now();
      write(SERIES_KEY, all);
    }
  },

  /** Add a project as the next episode (no-op if already present). Returns its 0-based index. */
  addEpisode(seriesId: string, projectId: string): number {
    const order = this.getEpisodeOrder(seriesId);
    const existing = order.indexOf(projectId);
    if (existing >= 0) return existing;
    const next = [...order, projectId];
    this.setEpisodeOrder(seriesId, next);
    return next.length - 1;
  },

  removeEpisode(seriesId: string, projectId: string): void {
    this.setEpisodeOrder(seriesId, this.getEpisodeOrder(seriesId).filter((id) => id !== projectId));
  },

  /** 0-based episode index of a project in its series, or -1. */
  episodeIndexOf(seriesId: string, projectId: string): number {
    return this.getEpisodeOrder(seriesId).indexOf(projectId);
  },

  episodeCount(seriesId: string): number {
    return this.getEpisodeOrder(seriesId).length;
  },

  // Arcs -------------------------------------------------------------------
  listArcs(seriesId: string): SeriesArc[] {
    return read<SeriesArc>(ARCS_KEY)
      .filter((a) => a.seriesId === seriesId)
      .sort((a, b) => a.startEpisode - b.startEpisode || a.name.localeCompare(b.name));
  },

  getArc(id: string): SeriesArc | null {
    return read<SeriesArc>(ARCS_KEY).find((a) => a.id === id) || null;
  },

  addArc(seriesId: string, input: Partial<SeriesArc> & { name: string }): SeriesArc {
    const now = Date.now();
    const arc: SeriesArc = {
      id: uid("arc"),
      seriesId,
      kind: input.kind || "plot",
      name: input.name.trim(),
      description: input.description || "",
      characterName: input.characterName,
      startEpisode: input.startEpisode ?? 0,
      endEpisode: input.endEpisode ?? input.startEpisode ?? 0,
      color: input.color,
      createdAt: now,
      updatedAt: now,
    };
    const all = read<SeriesArc>(ARCS_KEY);
    all.push(arc);
    write(ARCS_KEY, all);
    return arc;
  },

  updateArc(id: string, updates: Partial<SeriesArc>): SeriesArc | null {
    const all = read<SeriesArc>(ARCS_KEY);
    const i = all.findIndex((a) => a.id === id);
    if (i < 0) return null;
    all[i] = { ...all[i], ...updates, id: all[i].id, seriesId: all[i].seriesId, updatedAt: Date.now() };
    write(ARCS_KEY, all);
    return all[i];
  },

  deleteArc(id: string): void {
    write(ARCS_KEY, read<SeriesArc>(ARCS_KEY).filter((a) => a.id !== id));
  },

  // Cliffhangers (one per consecutive episode pair, keyed by fromEpisode) ---
  listCliffhangers(seriesId: string): SeriesCliffhanger[] {
    return read<SeriesCliffhanger>(CLIFFHANGERS_KEY)
      .filter((c) => c.seriesId === seriesId)
      .sort((a, b) => a.fromEpisode - b.fromEpisode);
  },

  /** Create or replace the cliffhanger from `fromEpisode` to the next episode. */
  upsertCliffhanger(seriesId: string, fromEpisode: number, description: string): SeriesCliffhanger {
    const all = read<SeriesCliffhanger>(CLIFFHANGERS_KEY);
    const now = Date.now();
    const existing = all.find((c) => c.seriesId === seriesId && c.fromEpisode === fromEpisode);
    if (existing) {
      existing.description = description;
      existing.toEpisode = fromEpisode + 1;
      existing.updatedAt = now;
      write(CLIFFHANGERS_KEY, all);
      return existing;
    }
    const cliff: SeriesCliffhanger = {
      id: uid("cliff"),
      seriesId,
      fromEpisode,
      toEpisode: fromEpisode + 1,
      description,
      createdAt: now,
      updatedAt: now,
    };
    all.push(cliff);
    write(CLIFFHANGERS_KEY, all);
    return cliff;
  },

  removeCliffhanger(seriesId: string, fromEpisode: number): void {
    write(
      CLIFFHANGERS_KEY,
      read<SeriesCliffhanger>(CLIFFHANGERS_KEY).filter((c) => !(c.seriesId === seriesId && c.fromEpisode === fromEpisode)),
    );
  },

  // Storage quota ----------------------------------------------------------
  /** True if a write() has hit the localStorage quota since the last clear. */
  hasStorageQuotaError(): boolean {
    return storageQuotaError;
  },

  clearStorageQuotaError(): void {
    storageQuotaError = false;
  },

  // Reference images (disk-backed) -----------------------------------------
  // Images are NOT stored inline in localStorage (that blows the ~5MB quota once
  // a few base64 blobs accumulate). Instead the packaged (Electron) build writes
  // the full-resolution image to disk and we keep only the referenceFilePath;
  // the browser (no bridge) keeps the inline data url as a fallback.

  /**
   * Persist a record's reference image to disk (Electron) and strip the inline
   * data url from storage, or — in the browser with no bridge — keep the inline
   * data url so browser mode still renders.
   */
  async attachRecordImage(kind: "scene" | "character", id: string, dataUrl: string, mimeType: string): Promise<void> {
    const record = kind === "scene" ? this.getLocation(id) : this.getCharacter(id);
    if (!record) return;
    const filePath = await persistGeneratedImageFile({
      projectId: record.seriesId,
      assetId: id,
      name: record.name,
      mimeType,
      dataUrl,
    });
    if (filePath) {
      // Disk-backed: store the path, drop the inline blob (undefined keys are
      // omitted from JSON.stringify, so it leaves localStorage entirely).
      const updates = { referenceFilePath: filePath, referenceMimeType: mimeType, referenceImageDataUrl: undefined };
      if (kind === "scene") this.updateLocation(id, updates);
      else this.updateCharacter(id, updates);
    } else {
      // Browser, no bridge: keep the inline data url as the only image source.
      const updates = { referenceImageDataUrl: dataUrl, referenceMimeType: mimeType };
      if (kind === "scene") this.updateLocation(id, updates);
      else this.updateCharacter(id, updates);
    }
  },

  /** Clear a record's reference image (inline + disk path + mime). */
  detachRecordImage(kind: "scene" | "character", id: string): void {
    const updates = { referenceImageDataUrl: undefined, referenceFilePath: undefined, referenceMimeType: undefined };
    if (kind === "scene") this.updateLocation(id, updates);
    else this.updateCharacter(id, updates);
  },

  /**
   * One-time migration: move every inline reference image out of localStorage
   * onto disk (Electron), stripping the base64 blob so the payload shrinks and
   * quota is reclaimed. Idempotent via a guard key. Records that already have a
   * disk path just get the redundant inline blob stripped; browser-only records
   * (no bridge, so no filePath) are left untouched. On any unexpected error the
   * guard is NOT set, so it retries on the next launch.
   */
  async migrateWorldImagesToDisk(): Promise<void> {
    if (typeof localStorage === "undefined") return;
    if (localStorage.getItem(MIGRATION_KEY)) return;
    try {
      const migrateOne = async (kind: "scene" | "character", rec: WorldLocation | WorldCharacter): Promise<void> => {
        if (!rec.referenceImageDataUrl) return;
        if (rec.referenceFilePath) {
          // Already on disk — just drop the redundant inline blob.
          if (kind === "scene") this.updateLocation(rec.id, { referenceImageDataUrl: undefined });
          else this.updateCharacter(rec.id, { referenceImageDataUrl: undefined });
          return;
        }
        const filePath = await persistGeneratedImageFile({
          projectId: rec.seriesId,
          assetId: rec.id,
          name: rec.name,
          mimeType: rec.referenceMimeType || "image/png",
          dataUrl: rec.referenceImageDataUrl,
        });
        if (filePath) {
          if (kind === "scene") this.updateLocation(rec.id, { referenceFilePath: filePath, referenceImageDataUrl: undefined });
          else this.updateCharacter(rec.id, { referenceFilePath: filePath, referenceImageDataUrl: undefined });
        }
        // No filePath (browser): leave the record untouched.
      };

      for (const loc of read<WorldLocation>(LOCATIONS_KEY)) {
        if (loc.referenceImageDataUrl) await migrateOne("scene", loc);
      }
      for (const c of read<WorldCharacter>(CHARACTERS_KEY)) {
        if (c.referenceImageDataUrl) await migrateOne("character", c);
      }
      localStorage.setItem(MIGRATION_KEY, "1");
    } catch (err) {
      // Don't set the guard — retry next launch.
      console.warn("WorldState: image migration failed; will retry next launch.", err);
    }
  },
};
