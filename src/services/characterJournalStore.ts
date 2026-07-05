// Thought journals: the author's user-written, in-character account of a
// character's day during one episode ("method acting for agents"). Private
// interiority — writing passes condition dialogue on them but never quote
// them. Keyed (series, character, episode project).

export interface ThoughtJournal {
  id: string;
  seriesId: string;
  /** Canonical character name (matches WorldCharacter.name when possible). */
  characterName: string;
  /** The episode (project) this journal covers. */
  projectId: string;
  text: string;
  updatedAt: number;
}

const KEY_PREFIX = "lw-thought-journals-";

function key(seriesId: string): string {
  return `${KEY_PREFIX}${seriesId}`;
}

function uid(): string {
  return `tj_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
}

function readAll(seriesId: string): ThoughtJournal[] {
  try {
    const raw = localStorage.getItem(key(seriesId));
    return raw ? (JSON.parse(raw) as ThoughtJournal[]) : [];
  } catch {
    return [];
  }
}

function writeAll(seriesId: string, journals: ThoughtJournal[]): void {
  localStorage.setItem(key(seriesId), JSON.stringify(journals));
}

export class CharacterJournalStore {
  static list(seriesId: string): ThoughtJournal[] {
    return readAll(seriesId);
  }

  static listForProject(seriesId: string, projectId: string): ThoughtJournal[] {
    return readAll(seriesId).filter((j) => j.projectId === projectId && j.text.trim());
  }

  static get(seriesId: string, characterName: string, projectId: string): ThoughtJournal | null {
    const name = characterName.trim().toLowerCase();
    return (
      readAll(seriesId).find((j) => j.projectId === projectId && j.characterName.trim().toLowerCase() === name) || null
    );
  }

  /** Create/update; an empty text deletes the journal. */
  static upsert(seriesId: string, characterName: string, projectId: string, text: string): ThoughtJournal | null {
    const name = characterName.trim();
    if (!name || !projectId) return null;
    const all = readAll(seriesId);
    const idx = all.findIndex((j) => j.projectId === projectId && j.characterName.trim().toLowerCase() === name.toLowerCase());

    if (!text.trim()) {
      if (idx >= 0) {
        all.splice(idx, 1);
        writeAll(seriesId, all);
      }
      return null;
    }

    const journal: ThoughtJournal = {
      id: idx >= 0 ? all[idx].id : uid(),
      seriesId,
      characterName: name,
      projectId,
      text,
      updatedAt: Date.now(),
    };
    if (idx >= 0) all[idx] = journal;
    else all.push(journal);
    writeAll(seriesId, all);
    return journal;
  }

  static remove(seriesId: string, id: string): void {
    writeAll(seriesId, readAll(seriesId).filter((j) => j.id !== id));
  }
}

/**
 * Prompt block for writing passes: every character's private day-of account
 * for this episode. Injected as interiority, with an explicit no-quoting rule.
 */
export function journalsPromptBlock(seriesId: string, projectId: string, maxCharsPerJournal = 1200): string {
  const journals = CharacterJournalStore.listForProject(seriesId, projectId);
  if (journals.length === 0) return "";
  const lines = [
    "=== CHARACTER THOUGHT JOURNALS (private interiority for THIS episode) ===",
    "Each character privately experienced the day like this. Let it color their mood, wants, and subtext. NEVER quote or reference a journal on screen.",
  ];
  for (const j of journals) {
    const text = j.text.length > maxCharsPerJournal ? `${j.text.slice(0, maxCharsPerJournal)}…` : j.text;
    lines.push(`--- ${j.characterName.toUpperCase()} ---\n${text}`);
  }
  return lines.join("\n");
}
