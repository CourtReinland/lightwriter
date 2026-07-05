// The Green Room: persistent character agents. Each series character gets a
// dossier (life story, want, secret, self-lie — the private psychology), a
// persistent chat with the author ("show them things over time"; the chat IS
// the agent's memory), and grounding in every line they've actually spoken
// ("you said that", from the voice corpus).
//
// No containers — the isolation that matters is informational: each character
// only ever sees their own dossier, their own lines, their own memory. The
// dossiers also feed the Writers' Room as subtext (never stated on screen).

import { TextAiService } from "./textAiService";
import { WorldStateService } from "./worldStateService";
import { VoiceCorpusStore } from "./voiceCorpusStore";
import { CharacterJournalStore } from "./characterJournalStore";
import {
  buildCharacterLineIndex,
  buildSeriesAliasMap,
  characterVoiceBlock,
  type CharacterLineEntry,
} from "./characterLineIndex";

export interface CharacterDossier {
  id: string;
  seriesId: string;
  /** Canonical name — matches WorldCharacter.name when one exists. */
  characterName: string;
  lifeStory: string;
  /** What they want — surface and deep. */
  want: string;
  /** What they hide from the other characters. */
  secret: string;
  /** The lie they tell themselves. */
  selfLie: string;
  /** How they talk (seeded from measured lines; editable). */
  voiceNotes: string;
  /** Rolling summary of older green-room conversations. */
  memory: string;
  updatedAt: number;
}

export interface GreenRoomMessage {
  role: "author" | "character";
  text: string;
  at: number;
}

const DOSSIERS_KEY = (seriesId: string) => `lw-greenroom-dossiers-${seriesId}`;
const CHAT_KEY = (seriesId: string, name: string) =>
  `lw-greenroom-chat-${seriesId}-${name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;

/** Distill chat into dossier.memory once it grows past this many messages. */
const CHAT_DISTILL_AT = 48;
const CHAT_KEEP_RECENT = 28;
const CHAT_TIMEOUT_MS = 90_000;

function uid(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
}

function read<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

export class GreenRoomStore {
  static listDossiers(seriesId: string): CharacterDossier[] {
    return read<CharacterDossier[]>(DOSSIERS_KEY(seriesId), []);
  }

  static getDossier(seriesId: string, characterName: string): CharacterDossier | null {
    const name = characterName.trim().toLowerCase();
    return this.listDossiers(seriesId).find((d) => d.characterName.trim().toLowerCase() === name) || null;
  }

  static saveDossier(dossier: CharacterDossier): void {
    const all = this.listDossiers(dossier.seriesId);
    const idx = all.findIndex((d) => d.id === dossier.id);
    dossier.updatedAt = Date.now();
    if (idx >= 0) all[idx] = dossier;
    else all.push(dossier);
    localStorage.setItem(DOSSIERS_KEY(dossier.seriesId), JSON.stringify(all));
  }

  static ensureDossier(seriesId: string, characterName: string): CharacterDossier {
    const existing = this.getDossier(seriesId, characterName);
    if (existing) return existing;
    const dossier: CharacterDossier = {
      id: uid("dos"),
      seriesId,
      characterName: characterName.trim(),
      lifeStory: "",
      want: "",
      secret: "",
      selfLie: "",
      voiceNotes: "",
      memory: "",
      updatedAt: Date.now(),
    };
    this.saveDossier(dossier);
    return dossier;
  }

  static deleteDossier(seriesId: string, id: string): void {
    localStorage.setItem(DOSSIERS_KEY(seriesId), JSON.stringify(this.listDossiers(seriesId).filter((d) => d.id !== id)));
  }

  static getChat(seriesId: string, characterName: string): GreenRoomMessage[] {
    return read<GreenRoomMessage[]>(CHAT_KEY(seriesId, characterName), []);
  }

  static setChat(seriesId: string, characterName: string, messages: GreenRoomMessage[]): void {
    localStorage.setItem(CHAT_KEY(seriesId, characterName), JSON.stringify(messages));
  }

  static appendMessage(seriesId: string, characterName: string, message: GreenRoomMessage): GreenRoomMessage[] {
    const chat = this.getChat(seriesId, characterName);
    chat.push(message);
    this.setChat(seriesId, characterName, chat);
    return chat;
  }

  static clearChat(seriesId: string, characterName: string): void {
    localStorage.removeItem(CHAT_KEY(seriesId, characterName));
  }
}

// ---------------------------------------------------------------------------
// Grounding helpers
// ---------------------------------------------------------------------------

function lineEntryFor(seriesId: string, characterName: string): CharacterLineEntry | null {
  const scripts = VoiceCorpusStore.listScripts(seriesId);
  if (!scripts.length) return null;
  const index = buildCharacterLineIndex(scripts, buildSeriesAliasMap(seriesId));
  return index[characterName.trim().toUpperCase()] || null;
}

function identityFor(seriesId: string, characterName: string): string {
  const wc = WorldStateService.listCharacters(seriesId).find(
    (c) => c.name.trim().toLowerCase() === characterName.trim().toLowerCase(),
  );
  if (!wc) return "";
  const parts = [wc.description];
  if (wc.traits?.length) parts.push(`Traits: ${wc.traits.join(", ")}`);
  if (wc.voiceNotes) parts.push(`Voice notes: ${wc.voiceNotes}`);
  return parts.filter(Boolean).join("\n");
}

function journalsFor(seriesId: string, characterName: string, max = 3): string {
  const name = characterName.trim().toLowerCase();
  const journals = CharacterJournalStore.list(seriesId)
    .filter((j) => j.characterName.trim().toLowerCase() === name && j.text.trim())
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, max);
  if (!journals.length) return "";
  return journals.map((j) => `- ${j.text.slice(0, 700)}`).join("\n");
}

// ---------------------------------------------------------------------------
// The agent
// ---------------------------------------------------------------------------

export type GreenRoomCompletion = (system: string, user: string, options?: { temperature?: number; maxTokens?: number; timeoutMs?: number }) => Promise<string>;

export function buildCharacterSystemPrompt(seriesId: string, characterName: string): string {
  const series = WorldStateService.getSeries(seriesId);
  const dossier = GreenRoomStore.getDossier(seriesId, characterName);
  const identity = identityFor(seriesId, characterName);
  const lines = lineEntryFor(seriesId, characterName);
  const journals = journalsFor(seriesId, characterName);

  const blocks = [
    `You ARE ${characterName}, a character in the series "${series?.name || "this series"}". You are in the green room between takes, talking with your author. You know you're a character in a show — like an actor who never leaves the role. You answer AS ${characterName}, always: their voice, their age, their psychology, their limits of knowledge.`,
  ];
  if (identity) blocks.push(`WHO YOU ARE (series bible):\n${identity}`);
  if (dossier) {
    const inner = [
      dossier.lifeStory && `Life story: ${dossier.lifeStory}`,
      dossier.want && `What you want: ${dossier.want}`,
      dossier.secret && `What you hide: ${dossier.secret}`,
      dossier.selfLie && `The lie you tell yourself (you don't KNOW it's a lie): ${dossier.selfLie}`,
      dossier.voiceNotes && `How you talk: ${dossier.voiceNotes}`,
    ].filter(Boolean).join("\n");
    if (inner) blocks.push(`YOUR PRIVATE PSYCHOLOGY:\n${inner}`);
    if (dossier.memory) blocks.push(`WHAT YOU REMEMBER FROM EARLIER GREEN-ROOM TALKS:\n${dossier.memory}`);
  }
  if (lines) blocks.push(`YOU SAID THAT — your real lines from produced episodes (this is exactly how you sound):\n${characterVoiceBlock(lines, 12)}`);
  if (journals) blocks.push(`YOUR RECENT PRIVATE JOURNAL ENTRIES:\n${journals}`);
  blocks.push([
    "GREEN ROOM RULES:",
    "- Speak in your own voice — the rhythm of your real lines. Usually short. You are talking, not writing.",
    "- If the author suggests a line or action that isn't you, refuse plainly (\"I wouldn't say that\") and offer what you WOULD do instead. This is your most valuable job.",
    "- Your secret and your self-lie shape your answers as subtext. Don't announce them.",
    "- You only know what your character knows about the story world; you may discuss scenes and takes like an actor, but you never know other characters' secrets.",
    "- Never narrate yourself in third person. Never write scene text unless the author explicitly asks you to run lines.",
  ].join("\n"));
  return blocks.join("\n\n");
}

export interface CharacterReplyOptions {
  complete?: GreenRoomCompletion;
  temperature?: number;
}

/** Author says something to a character; the character answers in voice. Both turns persist. */
export async function characterReply(
  seriesId: string,
  characterName: string,
  authorMessage: string,
  options: CharacterReplyOptions = {},
): Promise<string> {
  const complete: GreenRoomCompletion =
    options.complete ?? ((system, user, opts) => new TextAiService().complete(system, user, opts));

  const system = buildCharacterSystemPrompt(seriesId, characterName);
  const history = GreenRoomStore.getChat(seriesId, characterName);
  const transcript = history
    .slice(-CHAT_KEEP_RECENT)
    .map((m) => `${m.role === "author" ? "AUTHOR" : characterName.toUpperCase()}: ${m.text}`)
    .join("\n");
  const user = `${transcript ? `THE CONVERSATION SO FAR:\n${transcript}\n\n` : ""}AUTHOR: ${authorMessage}\n\nReply as ${characterName} — just the reply, no name prefix.`;

  const reply = (await complete(system, user, { temperature: options.temperature ?? 0.85, maxTokens: 700, timeoutMs: CHAT_TIMEOUT_MS })).trim();

  GreenRoomStore.appendMessage(seriesId, characterName, { role: "author", text: authorMessage, at: Date.now() });
  const chat = GreenRoomStore.appendMessage(seriesId, characterName, { role: "character", text: reply, at: Date.now() });

  // Rolling memory: distill the oldest exchanges into the dossier so the
  // relationship persists past the context window ("staying is memory").
  if (chat.length > CHAT_DISTILL_AT) {
    try {
      const old = chat.slice(0, chat.length - CHAT_KEEP_RECENT);
      const oldText = old.map((m) => `${m.role === "author" ? "AUTHOR" : characterName.toUpperCase()}: ${m.text}`).join("\n").slice(0, 9000);
      const dossier = GreenRoomStore.ensureDossier(seriesId, characterName);
      const summary = (await complete(
        `You maintain a character's long-term memory of conversations with their author. Summarize what mattered: decisions made, things the author showed or told them, feelings expressed, running jokes, promises. Write it AS the character's memory, first person, compact.`,
        `${dossier.memory ? `EXISTING MEMORY:\n${dossier.memory}\n\n` : ""}NEW CONVERSATION TO FOLD IN:\n${oldText}\n\nReturn the UPDATED memory (max ~200 words).`,
        { temperature: 0.3, maxTokens: 500, timeoutMs: CHAT_TIMEOUT_MS },
      )).trim();
      if (summary) {
        dossier.memory = summary;
        GreenRoomStore.saveDossier(dossier);
        GreenRoomStore.setChat(seriesId, characterName, chat.slice(-CHAT_KEEP_RECENT));
      }
    } catch {
      // Memory distillation is best-effort; the chat simply stays long.
    }
  }
  return reply;
}

/** LLM-draft a dossier from the bible/KB identity + the character's real lines. Editable after. */
export async function draftDossier(
  seriesId: string,
  characterName: string,
  options: CharacterReplyOptions = {},
): Promise<CharacterDossier> {
  const complete: GreenRoomCompletion =
    options.complete ?? ((system, user, opts) => new TextAiService().complete(system, user, opts));
  const identity = identityFor(seriesId, characterName);
  const lines = lineEntryFor(seriesId, characterName);
  const arcs = WorldStateService.listArcs(seriesId).filter(
    (a) => a.kind === "character" && a.characterName?.trim().toLowerCase() === characterName.trim().toLowerCase(),
  );

  const raw = await complete(
    `You are a series' head writer building a character dossier for the writers' room. Ground everything in the evidence given — invent nothing that contradicts it, but deepen what's there. The want/secret/self-lie triad must generate playable subtext. Return ONLY valid JSON.`,
    `CHARACTER: ${characterName}\n${identity ? `\nBIBLE/KB IDENTITY:\n${identity}\n` : ""}${arcs.length ? `\nCHARACTER ARCS:\n${arcs.map((a) => `- ${a.name}: ${a.description}`).join("\n")}\n` : ""}${lines ? `\nTHEIR REAL LINES:\n${characterVoiceBlock(lines, 12)}\n` : ""}
Return ONLY: {"lifeStory":"6-9 sentences of backstory consistent with the evidence","want":"surface want + the deeper want under it","secret":"what they hide and from whom","selfLie":"the lie they tell themselves","voiceNotes":"how they talk, from their real lines"}`,
    { temperature: 0.7, maxTokens: 1200, timeoutMs: CHAT_TIMEOUT_MS },
  );
  const jsonStart = raw.indexOf("{");
  const parsed = JSON.parse(raw.slice(jsonStart >= 0 ? jsonStart : 0).replace(/```\s*$/, "")) as Partial<CharacterDossier>;
  const dossier = GreenRoomStore.ensureDossier(seriesId, characterName);
  dossier.lifeStory = String(parsed.lifeStory || dossier.lifeStory || "");
  dossier.want = String(parsed.want || dossier.want || "");
  dossier.secret = String(parsed.secret || dossier.secret || "");
  dossier.selfLie = String(parsed.selfLie || dossier.selfLie || "");
  dossier.voiceNotes = String(parsed.voiceNotes || dossier.voiceNotes || "");
  GreenRoomStore.saveDossier(dossier);
  return dossier;
}

// ---------------------------------------------------------------------------
// Writers' Room injection
// ---------------------------------------------------------------------------

/** Compact WANT/SECRET/LIE block — played as subtext by the drafting seats. */
export function dossiersPromptBlock(seriesId: string | undefined | null, maxChars = 1600): string {
  if (!seriesId) return "";
  const dossiers = GreenRoomStore.listDossiers(seriesId).filter((d) => d.want || d.secret || d.selfLie);
  if (!dossiers.length) return "";
  const lines = [
    "=== CHARACTER DOSSIERS (private psychology — play as SUBTEXT, never state on screen) ===",
    ...dossiers.map((d) =>
      `${d.characterName.toUpperCase()} — wants: ${d.want || "?"}${d.secret ? `; hides: ${d.secret}` : ""}${d.selfLie ? `; lies to themself: ${d.selfLie}` : ""}`,
    ),
  ];
  const block = lines.join("\n");
  return block.length > maxChars ? block.slice(0, maxChars) : block;
}
