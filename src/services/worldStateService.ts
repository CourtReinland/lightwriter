// Portable "World State": locations (and later props/world rules) that persist
// ACROSS scripts grouped into a named Series — so the family kitchen in script 1
// is the same kitchen, with the same reference image and ScriptToScreen id, in
// script 2. A Project opts into a Series via Project.seriesId.

export interface Series {
  id: string;
  name: string;
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
  /** Stable key carried into the ScriptToScreen manifest's locations{}. */
  stsLocationKey: string;
  createdAt: number;
  updatedAt: number;
}

const SERIES_KEY = "lw-series";
const LOCATIONS_KEY = "lw-world-locations";

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

function write<T>(key: string, value: T[]): void {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* quota — best effort */
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
    const series: Series = { id: uid("series"), name: name.trim() || "Untitled Series", createdAt: now, updatedAt: now };
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
};
