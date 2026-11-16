// The assistant door: what the person's own AI assistant is given.
//
// The assistant never gets the archive's key. Echo writes a small store of its
// own for it, with its own key, and the assistant can read only that. What goes
// in the store is decided here, in one place, so it can be tested.

import { usable } from './memories.ts';
import type { Memory, MemorySourceKind } from './memories.ts';
import type { SheetLineView } from './sheets.ts';

/** One of the person's own passages, as the assistant sees it. */
export interface DoorPassage {
  id: string;
  /** Where the words came from: a story, the interview, advice, a message, a letter. */
  from: MemorySourceKind;
  title: string;
  /** What the words were answering, if anything. */
  context: string;
  text: string;
  date: string;
}

export interface DoorLine {
  section: string;
  text: string;
}

/** Everything the assistant can read. Nothing else about the archive is in reach of it. */
export interface DoorStore {
  version: 1;
  writtenAt: string;
  /** The name on the consent. */
  owner: string;
  passages: DoorPassage[];
  characterSheet: DoorLine[];
  styleProfile: DoorLine[];
  /** The person's AI key, only if they chose to let the assistant's questions to the echo be paid for with it. */
  aiKey?: string;
}

/** What the Setup screen shows about the door. */
export interface DoorStatus {
  on: boolean;
  /** The folder the store and its key are kept in. */
  folder: string;
  turnedOnAt: string | null;
  writtenAt: string | null;
  /** What is in the store now, if the door is on. */
  passages: number;
  sheetLines: number;
  /** What would be put in the store if it were written now. Null while the archive is locked. */
  wouldShare: { passages: number; sheetLines: number } | null;
  /** How many things the assistant has left in the tray for the person to look at. */
  waiting: number;
  /** Whether the assistant's questions to the echo may be paid for with the person's own AI key. */
  sharesAiKey: boolean;
  /** How many questions the assistant has put to the echo today, and how many it may. */
  askedToday: number;
  dailyQuestions: number;
}

/**
 * The passages the assistant may read: the person's own words that the echo
 * itself may use, and that are marked for everyone. Words marked for one
 * person, passages left out or held back, and advice kept for a day that has
 * not come never qualify. Other people's words are never passages at all.
 */
export function doorPassages(memories: readonly Memory[]): DoorPassage[] {
  return memories
    .filter((memory) => usable(memory) && memory.audience.kind === 'everyone')
    .map((memory) => ({
      id: memory.id,
      from: memory.source.kind,
      title: memory.source.title,
      context: memory.context,
      text: memory.words ?? memory.text,
      date: memory.date,
    }));
}

/** The lines of a sheet the assistant may read: in use, and for everyone. */
export function doorLines(lines: readonly SheetLineView[]): DoorLine[] {
  return lines.filter((line) => line.inUse && line.audience.kind === 'everyone').map((line) => ({ section: line.section, text: line.text }));
}

const SMALL_WORDS = new Set(
  'a about after all also am an and any are as at be been but by can could did do does for from had has have he her him his how i if in into is it its just me my no not of on or our she so some that the their them then there they this to too up us was we were what when where which who why will with would you your'.split(' '),
);

function wordsOf(text: string): string[] {
  return text.toLowerCase().match(/[\p{L}\p{N}']+/gu) ?? [];
}

/**
 * The passages that best match what was asked for, best first. A passage
 * scores by how many different words of the question it holds; small words
 * like "the" and "what" do not count. Ties go to the newer passage.
 */
export function searchPassages(passages: readonly DoorPassage[], question: string, limit: number): DoorPassage[] {
  const wanted = [...new Set(wordsOf(question).filter((word) => word.length > 1 && !SMALL_WORDS.has(word)))];
  if (wanted.length === 0) return [];
  return passages
    .map((passage) => {
      const held = new Set(wordsOf(`${passage.title} ${passage.context} ${passage.text}`));
      return { passage, score: wanted.filter((word) => held.has(word)).length };
    })
    .filter((scored) => scored.score > 0)
    .sort((a, b) => b.score - a.score || b.passage.date.localeCompare(a.passage.date))
    .slice(0, Math.max(0, limit))
    .map((scored) => scored.passage);
}

export const DOOR_USE_KINDS = ['status', 'search', 'read', 'sheets', 'suggest', 'tray', 'withdraw', 'ask'] as const;

/** How many questions a day the assistant may put to the echo. Each one spends the AI key. Marc's choice, 2026-11-13. */
export const DOOR_DAILY_QUESTIONS = 30;
export type DoorUseKind = (typeof DOOR_USE_KINDS)[number];

/** One use of the door by the assistant, as it is written down: when, what kind, and how much came back. Never any words. */
export interface DoorUse {
  at: string;
  command: DoorUseKind;
  results: number;
}

/** Door uses gathered by day and kind, for the activity log. */
export function summariseDoorUses(uses: readonly DoorUse[]): { day: string; command: string; times: number; results: number }[] {
  const byKey = new Map<string, { day: string; command: string; times: number; results: number }>();
  for (const use of uses) {
    const day = use.at.slice(0, 10);
    const key = `${day} ${use.command}`;
    const entry = byKey.get(key) ?? { day, command: use.command, times: 0, results: 0 };
    entry.times += 1;
    entry.results += use.results;
    byKey.set(key, entry);
  }
  return [...byKey.values()].sort((a, b) => a.day.localeCompare(b.day) || a.command.localeCompare(b.command));
}

// ---------- the tray ----------
//
// The assistant cannot add anything to the archive. It can leave things in a
// tray. Nothing in the tray reaches the echo until the person has looked at it
// inside Echo and said it is theirs.

/** The kinds of export a suggested file can be opened as. */
export const TRAY_SERVICES = ['whatsapp', 'messenger', 'discord', 'email'] as const;
export type TrayService = (typeof TRAY_SERVICES)[number];

export type TrayItem =
  /** "Here is a file of yours worth importing." Only where it is: the door never reads or copies the file. */
  | { id: string; at: string; kind: 'file'; path: string; service: TrayService | null; note: string }
  /** "Here is something you told me, written up." A draft: it becomes the person's only if they approve it. */
  | { id: string; at: string; kind: 'words'; title: string; text: string; note: string };

export const MAX_TRAY_ITEMS = 50;
export const MAX_TRAY_WORDS = 20_000;
export const MAX_TRAY_NOTE = 500;

/** Plain-English problems with something the assistant wants to leave. An empty list means it can go in the tray. */
export function trayProblems(item: { kind: 'file'; path: string; service: string | null; note: string } | { kind: 'words'; title: string; text: string; note: string }, waiting: number): string[] {
  const problems: string[] = [];
  if (waiting >= MAX_TRAY_ITEMS) problems.push(`The tray is full: ${waiting} things are already waiting for the owner to look at. Withdraw some, or wait.`);
  if (item.note.length > MAX_TRAY_NOTE) problems.push(`Keep the note under ${MAX_TRAY_NOTE} characters.`);
  if (item.kind === 'file') {
    if (item.path.trim().length === 0) problems.push('Say where the file is.');
    if (item.service !== null && !(TRAY_SERVICES as readonly string[]).includes(item.service)) problems.push(`The kind of file must be one of: ${TRAY_SERVICES.join(', ')}.`);
  } else {
    if (item.title.trim().length === 0) problems.push('Give the words a short title.');
    if (item.title.trim().length > 120) problems.push('Keep the title to a few words.');
    if (item.text.trim().length === 0) problems.push('There are no words to leave.');
    if (item.text.length > MAX_TRAY_WORDS) problems.push(`That is too long to leave in one piece. Keep it under ${MAX_TRAY_WORDS} characters.`);
  }
  return problems;
}
