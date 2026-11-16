// What the assistant can ask the door for, as plain functions: arguments in,
// an exit code and something to print out. The same functions sit behind the
// shell commands and, later, the MCP server.
//
// The door can only read its own store. It has no way to reach the archive.

import os from 'node:os';
import path from 'node:path';
import { existsSync } from 'node:fs';
import { TRAY_SERVICES, searchPassages, trayProblems } from '../shared/door.ts';
import type { DoorPassage, DoorUseKind, TrayItem, TrayService } from '../shared/door.ts';
import { askTheEcho } from './door-ask.ts';
import type { AskDeps } from './door-ask.ts';
import { DOOR_FOLDER_NAME, addTrayItem, doorTurnedOnAt, noteDoorUse, readDoorStore, readTray, removeTrayItem } from './door.ts';

export interface DoorAnswer {
  /** 0 worked, 1 the door is off or has nothing, 2 the command was not understood. */
  exit: 0 | 1 | 2;
  output: unknown;
}

const KINDS = ['story', 'interview', 'advice', 'message', 'letter', 'note'];
const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 50;

export const DOOR_HELP = [
  'echo-door: read what the owner of an Echo archive has shared with their own AI assistant.',
  '',
  'Commands (each prints JSON):',
  '  echo-door status                     Whether the door is on, and how much is behind it.',
  '  echo-door search <words> [--limit N] The passages that best match the words, best first.',
  '  echo-door read [--from KIND] [--limit N] [--offset N]',
  '                                       Passages in order, newest first. KIND is one of:',
  `                                       ${KINDS.join(', ')}.`,
  '  echo-door read --id ID               One passage by its id.',
  '  echo-door sheets                     The character sheet and the style profile.',
  '',
  'Asking the owner\'s echo (an AI that answers in their voice, from what they recorded):',
  '  echo-door ask <question> [--new yes] Put a question to the echo. It carries on the last conversation',
  '                                       unless --new yes is given or half a day has passed. Each question',
  '                                       spends an AI key and counts against a daily limit.',
  '',
  'Leaving things for the owner (nothing reaches their echo until they approve it inside Echo):',
  '  echo-door suggest-file <path> [--as KIND] [--note TEXT]',
  '                                       Point out a file on this computer worth importing. KIND is one',
  `                                       of: ${TRAY_SERVICES.join(', ')}.`,
  '  echo-door suggest-words --title TITLE [--text TEXT] [--note TEXT]',
  '                                       Leave a draft of something the owner told you, in their words.',
  '                                       Without --text the words are read from standard input.',
  '  echo-door tray                       What you have left that the owner has not dealt with yet.',
  '  echo-door withdraw <id>              Take back something you left.',
  '',
  '  echo-door mcp                        Stay running as an MCP server on standard input and output,',
  '                                       offering the same things as tools.',
  '',
  'Everything read is the owner\'s own words, marked by them for everyone to hear.',
  'The door is turned on and off by the owner, inside Echo, in Setup.',
].join('\n');

/** Where the door's folder is when nothing says otherwise: beside Echo's settings. */
export function defaultDoorFolder(env: NodeJS.ProcessEnv = process.env): string {
  if (env.ECHO_DOOR_FOLDER) return env.ECHO_DOOR_FOLDER;
  const settings = env.APPDATA ?? path.join(os.homedir(), '.config');
  return path.join(settings, 'Echo', DOOR_FOLDER_NAME);
}

function options(args: readonly string[]): { words: string[]; named: Map<string, string>; problem: string | null } {
  const words: string[] = [];
  const named = new Map<string, string>();
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i] ?? '';
    if (!arg.startsWith('--')) {
      words.push(arg);
      continue;
    }
    const value = args[i + 1];
    if (value === undefined || value.startsWith('--')) return { words, named, problem: `${arg} needs a value after it.` };
    named.set(arg.slice(2), value);
    i += 1;
  }
  return { words, named, problem: null };
}

function wholeNumber(text: string | undefined, fallback: number, most: number): number | null {
  if (text === undefined) return fallback;
  if (!/^\d+$/.test(text)) return null;
  return Math.min(Number(text), most);
}

const OFF = 'The assistant door is off. Its owner turns it on inside Echo, in Setup.';

function trayLine(item: TrayItem): Record<string, string | null> {
  return item.kind === 'file' ? { id: item.id, kind: 'file', leftAt: item.at, path: item.path, as: item.service, note: item.note } : { id: item.id, kind: 'words', leftAt: item.at, title: item.title, note: item.note };
}

const WAITS = 'It is waiting in the tray. Nothing has been added to the archive: the owner has to open Echo, look at it and approve it.';

/** Points out a file worth importing. The door records where it is and nothing else: it never reads or copies the file. */
export function suggestFile(folder: string, given: { path: string; service: string | null; note: string }): DoorAnswer {
  if (!doorTurnedOnAt(folder)) return { exit: 1, output: { problem: OFF } };
  const where = path.resolve(given.path.trim());
  const problems = trayProblems({ kind: 'file', path: given.path, service: given.service, note: given.note }, readTray(folder).length);
  if (problems.length === 0 && !existsSync(where)) problems.push(`There is no file or folder at ${where}.`);
  if (problems.length > 0) return { exit: 1, output: { problem: problems.join(' ') } };
  const left = addTrayItem(folder, { kind: 'file', path: where, service: given.service as TrayService | null, note: given.note.trim() });
  if (!left) return { exit: 1, output: { problem: OFF } };
  noteDoorUse(folder, { at: new Date().toISOString(), command: 'suggest', results: 1 });
  return { exit: 0, output: { left: trayLine(left), waiting: readTray(folder).length, what_happens_next: WAITS } };
}

/** Leaves a draft of something the owner said. It is a draft until the owner reads it in Echo and says it is theirs. */
export function suggestWords(folder: string, given: { title: string; text: string; note: string }): DoorAnswer {
  if (!doorTurnedOnAt(folder)) return { exit: 1, output: { problem: OFF } };
  const problems = trayProblems({ kind: 'words', ...given }, readTray(folder).length);
  if (problems.length > 0) return { exit: 1, output: { problem: problems.join(' ') } };
  const left = addTrayItem(folder, { kind: 'words', title: given.title.trim(), text: given.text.trim(), note: given.note.trim() });
  if (!left) return { exit: 1, output: { problem: OFF } };
  noteDoorUse(folder, { at: new Date().toISOString(), command: 'suggest', results: 1 });
  return { exit: 0, output: { left: trayLine(left), waiting: readTray(folder).length, what_happens_next: WAITS } };
}

/** What the assistant has left that the owner has not dealt with. Drafts are listed by title, not shown in full. */
export function listTray(folder: string): DoorAnswer {
  if (!doorTurnedOnAt(folder)) return { exit: 1, output: { problem: OFF } };
  const waiting = readTray(folder);
  noteDoorUse(folder, { at: new Date().toISOString(), command: 'tray', results: waiting.length });
  return { exit: 0, output: { waiting: waiting.length, items: waiting.map(trayLine) } };
}

/** Takes back something the assistant left, before the owner has dealt with it. */
export function withdrawFromTray(folder: string, id: string): DoorAnswer {
  if (!doorTurnedOnAt(folder)) return { exit: 1, output: { problem: OFF } };
  if (!removeTrayItem(folder, id)) return { exit: 1, output: { problem: 'There is nothing with that id in the tray. The owner may already have dealt with it.' } };
  noteDoorUse(folder, { at: new Date().toISOString(), command: 'withdraw', results: 1 });
  return { exit: 0, output: { withdrawn: id, waiting: readTray(folder).length } };
}

/** Carries out one command against the door's folder. `input` is what arrived on standard input, for commands that take words that way. */
export function runDoorCommand(args: readonly string[], folder: string, input = ''): DoorAnswer {
  const [command, ...rest] = args;
  if (command === undefined || command === 'help' || command === '--help' || command === '-h') return { exit: command === undefined ? 2 : 0, output: DOOR_HELP };
  if (command === 'ask') return { exit: 2, output: { problem: 'Asking the echo takes a moment and cannot be done from here.' } };
  if (!['status', 'search', 'read', 'sheets', 'suggest-file', 'suggest-words', 'tray', 'withdraw'].includes(command)) {
    return { exit: 2, output: { problem: `There is no "${command}" command. Run "echo-door help" for the list.` } };
  }
  const { words, named, problem } = options(rest);
  if (problem) return { exit: 2, output: { problem } };

  if (command === 'suggest-file') {
    if (words.length !== 1) return { exit: 2, output: { problem: 'Say where the one file is: echo-door suggest-file <path>. Put the path in quotes if it has spaces.' } };
    return suggestFile(folder, { path: words[0] ?? '', service: named.get('as') ?? null, note: named.get('note') ?? '' });
  }
  if (command === 'suggest-words') {
    const title = named.get('title');
    if (title === undefined) return { exit: 2, output: { problem: 'Give the words a title: echo-door suggest-words --title "..."' } };
    return suggestWords(folder, { title, text: named.get('text') ?? input, note: named.get('note') ?? '' });
  }
  if (command === 'tray') return listTray(folder);
  if (command === 'withdraw') {
    if (words.length !== 1) return { exit: 2, output: { problem: 'Say which one: echo-door withdraw <id>' } };
    return withdrawFromTray(folder, words[0] ?? '');
  }

  const turnedOnAt = doorTurnedOnAt(folder);
  const store = turnedOnAt ? readDoorStore(folder) : null;
  const note = (results: number) => noteDoorUse(folder, { at: new Date().toISOString(), command: command as DoorUseKind, results });

  if (command === 'status') {
    if (turnedOnAt) note(0);
    return {
      exit: 0,
      output: {
        on: turnedOnAt !== null,
        turnedOnAt,
        writtenAt: store?.writtenAt ?? null,
        owner: store?.owner ?? null,
        passages: store?.passages.length ?? 0,
        characterSheetLines: store?.characterSheet.length ?? 0,
        styleProfileLines: store?.styleProfile.length ?? 0,
        waitingInTray: turnedOnAt ? readTray(folder).length : 0,
        ...(turnedOnAt ? {} : { problem: OFF }),
      },
    };
  }
  if (!turnedOnAt) return { exit: 1, output: { problem: OFF } };
  if (!store) return { exit: 1, output: { problem: 'The door is on but its store could not be read. Opening Echo and unlocking the archive writes it again.' } };

  if (command === 'sheets') {
    note(store.characterSheet.length + store.styleProfile.length);
    return { exit: 0, output: { owner: store.owner, writtenAt: store.writtenAt, characterSheet: store.characterSheet, styleProfile: store.styleProfile } };
  }

  const limit = wholeNumber(named.get('limit'), DEFAULT_LIMIT, MAX_LIMIT);
  if (limit === null) return { exit: 2, output: { problem: '--limit needs a whole number.' } };

  if (command === 'search') {
    const question = words.join(' ').trim();
    if (question.length === 0) return { exit: 2, output: { problem: 'Say what to search for: echo-door search <words>' } };
    const found = searchPassages(store.passages, question, limit);
    note(found.length);
    return { exit: 0, output: { owner: store.owner, writtenAt: store.writtenAt, found: found.length, passages: found } };
  }

  // read
  const id = named.get('id');
  if (id !== undefined) {
    const one = store.passages.find((passage) => passage.id === id);
    if (!one) return { exit: 1, output: { problem: 'There is no passage with that id behind the door.' } };
    note(1);
    return { exit: 0, output: { owner: store.owner, writtenAt: store.writtenAt, passages: [one] } };
  }
  const from = named.get('from');
  if (from !== undefined && !KINDS.includes(from)) return { exit: 2, output: { problem: `--from must be one of: ${KINDS.join(', ')}.` } };
  const offset = wholeNumber(named.get('offset'), 0, Number.MAX_SAFE_INTEGER);
  if (offset === null) return { exit: 2, output: { problem: '--offset needs a whole number.' } };
  const matching: DoorPassage[] = store.passages.filter((passage) => from === undefined || passage.from === from).sort((a, b) => b.date.localeCompare(a.date));
  const page = matching.slice(offset, offset + limit);
  note(page.length);
  return { exit: 0, output: { owner: store.owner, writtenAt: store.writtenAt, total: matching.length, offset, passages: page } };
}

/**
 * Carries out one command, including the one that takes time: asking the
 * echo. Everything else is answered at once by runDoorCommand.
 */
export async function runDoorCommandAsync(args: readonly string[], folder: string, input = '', deps: AskDeps = {}): Promise<DoorAnswer> {
  if (args[0] !== 'ask') return runDoorCommand(args, folder, input);
  const { words, named, problem } = options(args.slice(1));
  if (problem) return { exit: 2, output: { problem } };
  const fresh = named.get('new');
  if (fresh !== undefined && fresh !== 'yes' && fresh !== 'no') return { exit: 2, output: { problem: '--new takes yes or no.' } };
  return askTheEcho(folder, words.length > 0 ? words.join(' ') : input, fresh === 'yes', deps);
}
