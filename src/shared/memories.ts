// The memory store: the small passages the echo may draw on, each with where
// it came from, when, who is involved and who may hear it.
//
// Passages are cut from what the person captured (stories, interview answers,
// advice). Nothing here is written by an AI. The person can correct a
// passage's words, change who may hear it, or leave it out, and those choices
// are carried over when the store is brought up to date.

import type { Audience, Person } from './people.ts';

export type MemorySourceKind = 'story' | 'interview' | 'advice' | 'message' | 'letter' | 'note';

/** How the echo may use a passage. Advice kept for the day is never used in conversation before the day. */
export type MemoryUse = 'memory' | 'advice-when-asked' | 'advice-on-the-day';

/** One captured item, as the memory store sees it. */
export interface MemorySource {
  kind: MemorySourceKind;
  id: string;
  /** The story's title, the part of the interview, or the occasion. */
  title: string;
  /** What the words answer: the story prompt or the interviewer's question. Empty if none. */
  context: string;
  text: string;
  date: string;
  audience: Audience;
  use: MemoryUse;
}

export interface Memory {
  id: string;
  source: { kind: MemorySourceKind; id: string; title: string };
  context: string;
  /** The passage exactly as it was cut from the source. */
  text: string;
  /** The person's corrected wording, if they changed it. The echo uses this in place of `text`. */
  words?: string;
  date: string;
  /** The people named in the passage, and the person it is for. */
  people: string[];
  audience: Audience;
  /** True if the person set who may hear this passage by hand, so it no longer follows its source. */
  ownAudience: boolean;
  use: MemoryUse;
  /** True if the person has told the echo not to use this passage. */
  leftOut: boolean;
  /**
   * True if the echo must not use this passage until the person has looked at
   * it. Set when a source changes after part of it had been marked by hand,
   * so a private or left-out passage can never come back unnoticed.
   */
  held: boolean;
}

/** What the screen is given. */
export interface MemoryStore {
  memories: Memory[];
  /** Stories that have a recording but no words yet, so the echo cannot draw on them. */
  storiesNotWrittenDown: number;
}

/** A change the person makes to one passage. Only what is given is changed. */
export interface MemoryChange {
  words?: string;
  audience?: Audience;
  leftOut?: boolean;
  /** Only `false` means anything: the person has looked at a held passage and lets the echo use it. */
  held?: false;
}

export const MAX_PASSAGE_WORDS = 120;
export const MAX_PASSAGE_LENGTH = 5_000;

/** The wording the echo uses for a passage. */
export function memoryWords(memory: Memory): string {
  return memory.words ?? memory.text;
}

/** True if the person has marked this passage by hand in any way. */
export function touched(memory: Memory): boolean {
  return memory.leftOut || memory.ownAudience || memory.words !== undefined;
}

/** True if the echo may draw on this passage in conversation at all. Who may hear it is a separate question. */
export function usable(memory: Memory): boolean {
  return !memory.leftOut && !memory.held && memory.use !== 'advice-on-the-day';
}

function wordCount(text: string): number {
  return text.split(/\s+/).filter((word) => word.length > 0).length;
}

/**
 * Cuts text into passages of at most `maxWords` words, breaking at paragraphs
 * and then at sentence ends. The same text always gives the same passages.
 */
export function splitIntoPassages(text: string, maxWords = MAX_PASSAGE_WORDS): string[] {
  const paragraphs = text
    .replace(/\r\n?/g, '\n')
    .split(/\n\s*\n/)
    .map((paragraph) => paragraph.replace(/\s+/g, ' ').trim())
    .filter((paragraph) => paragraph.length > 0);

  // Units are whole paragraphs where they fit, else sentences, else runs of words.
  const units: { text: string; paragraph: number }[] = [];
  paragraphs.forEach((paragraph, index) => {
    if (wordCount(paragraph) <= maxWords) {
      units.push({ text: paragraph, paragraph: index });
      return;
    }
    const sentences = paragraph.match(/[^.!?]+(?:[.!?]+["')\]]*|$)\s*/g) ?? [paragraph];
    for (const sentence of sentences.map((s) => s.trim()).filter((s) => s.length > 0)) {
      const words = sentence.split(' ');
      for (let start = 0; start < words.length; start += maxWords) {
        units.push({ text: words.slice(start, start + maxWords).join(' '), paragraph: index });
      }
    }
  });

  const passages: string[] = [];
  let current = '';
  let currentParagraph = -1;
  for (const unit of units) {
    if (current.length > 0 && wordCount(current) + wordCount(unit.text) > maxWords) {
      passages.push(current);
      current = '';
    }
    current = current.length === 0 ? unit.text : `${current}${unit.paragraph === currentParagraph ? ' ' : '\n\n'}${unit.text}`;
    currentParagraph = unit.paragraph;
  }
  if (current.length > 0) passages.push(current);
  return passages;
}

function escapeForPattern(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * The people involved in a passage: anyone in the list whose name appears in
 * it as a whole word, and the person it is for. Names only; nothing is guessed.
 */
export function peopleInvolved(text: string, audience: Audience, people: readonly Person[]): string[] {
  const involved = people
    .filter((person) => {
      const name = person.name.trim();
      if (name.length === 0) return false;
      return new RegExp(`(?<![\\p{L}\\p{N}])${escapeForPattern(name)}(?![\\p{L}\\p{N}])`, 'iu').test(text);
    })
    .map((person) => person.id);
  if (audience.kind === 'person' && people.some((person) => person.id === audience.personId) && !involved.includes(audience.personId)) {
    involved.push(audience.personId);
  }
  return involved;
}

export interface SyncResult {
  memories: Memory[];
  added: number;
  removed: number;
  /** New passages held back for the person to look at. */
  held: number;
  /** False if the store was already up to date. */
  changed: boolean;
}

/**
 * Brings the memory store up to date with what has been captured.
 *
 * - A source with no passages yet is cut into passages.
 * - A passage whose source text still contains it, word for word, is kept
 *   with everything the person did to it.
 * - A passage whose source text no longer contains it is removed. If the
 *   person had marked any such passage by hand, the new passages from that
 *   source are held back until they have looked at them.
 * - A passage whose source is gone is removed.
 */
export function syncMemories(existing: readonly Memory[], sources: readonly MemorySource[], people: readonly Person[], newId: () => string): SyncResult {
  const memories: Memory[] = [];
  let added = 0;
  let held = 0;
  const kept = new Set<string>();
  // Passages are looked up by their source, so a store of many thousands stays quick.
  const sourceKey = (kind: string, id: string) => `${kind}\u0000${id}`;
  const bySource = new Map<string, Memory[]>();
  for (const memory of existing) {
    const key = sourceKey(memory.source.kind, memory.source.id);
    const list = bySource.get(key);
    if (list) list.push(memory);
    else bySource.set(key, [memory]);
  }

  for (const source of sources) {
    const old = bySource.get(sourceKey(source.kind, source.id)) ?? [];
    const pieces = splitIntoPassages(source.text);
    const matches = pieces.map((piece) => {
      const match = old.find((memory) => memory.text === piece && !kept.has(memory.id));
      if (match) kept.add(match.id);
      return match;
    });
    const lostMarkedPassage = old.some((memory) => !kept.has(memory.id) && touched(memory));

    pieces.forEach((piece, index) => {
      const match = matches[index];
      const audience = match?.ownAudience ? match.audience : source.audience;
      const memory: Memory = {
        id: match?.id ?? newId(),
        source: { kind: source.kind, id: source.id, title: source.title },
        context: source.context,
        text: piece,
        ...(match?.words !== undefined ? { words: match.words } : {}),
        date: source.date,
        people: peopleInvolved(match?.words ?? piece, audience, people),
        audience,
        ownAudience: match?.ownAudience ?? false,
        use: source.use,
        leftOut: match?.leftOut ?? false,
        held: match ? match.held : lostMarkedPassage,
      };
      if (!match) {
        added += 1;
        if (memory.held) held += 1;
      }
      memories.push(memory);
    });
  }

  const removed = existing.filter((memory) => !kept.has(memory.id)).length;
  const changed = added > 0 || removed > 0 || JSON.stringify(memories) !== JSON.stringify(existing);
  return { memories, added, removed, held, changed };
}

/** Plain-English problems with a change to a passage. An empty list means it is fine. */
export function memoryChangeProblems(change: MemoryChange, people: readonly Person[]): string[] {
  const problems: string[] = [];
  if (change.words !== undefined) {
    if (change.words.trim().length === 0) problems.push('A passage cannot be empty. To stop your echo using it, leave it out instead.');
    if (change.words.length > MAX_PASSAGE_LENGTH) problems.push('That is too long for one passage.');
  }
  const audience = change.audience;
  if (audience?.kind === 'person' && !people.some((person) => person.id === audience.personId)) {
    problems.push('The person this is for is no longer in your list. Choose again.');
  }
  return problems;
}

/** Applies a change the person made. The original wording is always kept underneath. */
export function applyMemoryChange(memory: Memory, change: MemoryChange, people: readonly Person[]): Memory {
  const next: Memory = { ...memory };
  if (change.words !== undefined) {
    const words = change.words.trim();
    if (words === memory.text) delete next.words;
    else next.words = words;
  }
  if (change.audience !== undefined) {
    next.audience = change.audience;
    next.ownAudience = true;
  }
  if (change.leftOut !== undefined) next.leftOut = change.leftOut;
  if (change.held === false) next.held = false;
  next.people = peopleInvolved(memoryWords(next), next.audience, people);
  return next;
}

export function memoryUseLabel(use: MemoryUse): string {
  if (use === 'advice-when-asked') return 'Advice, said when they ask';
  if (use === 'advice-on-the-day') return 'Advice, kept for the day';
  return 'Memory';
}

export function memorySourceLabel(kind: MemorySourceKind): string {
  if (kind === 'story') return 'Story';
  if (kind === 'interview') return 'Interview';
  if (kind === 'message') return 'Message';
  if (kind === 'letter') return 'Letter';
  if (kind === 'note') return 'Approved from your assistant';
  return 'Advice';
}
