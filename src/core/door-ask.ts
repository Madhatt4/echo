// The assistant asking the echo a question, through the door.
//
// This runs in the door's own program, with Echo closed or open. It can only
// use what is in the door's store: the person's own words marked for everyone,
// and the for-everyone lines of the two sheets. It runs the same engine and
// the same checker as the Talk screen.
//
// One check the Talk screen makes is not made here: the one that throws away a
// reply repeating eight words in a row of someone else's message. Making it
// would mean keeping something of other people's messages within the
// assistant's reach, and the person chose not to (2026-11-13). This echo is
// only ever given the person's own words, so it has nothing of theirs to repeat.

import { randomUUID } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { MAX_MESSAGE_LENGTH, toldBefore } from '../shared/chat.ts';
import type { ChatSession } from '../shared/chat.ts';
import { DOOR_DAILY_QUESTIONS } from '../shared/door.ts';
import type { DoorLine, DoorPassage } from '../shared/door.ts';
import type { Memory } from '../shared/memories.ts';
import { OWNER, choosePassages, openingLine } from '../shared/persona.ts';
import type { SheetLineView } from '../shared/sheets.ts';
import { askClaude } from './anthropic.ts';
import type { ClaudeAnswer, ClaudeRequest } from './anthropic.ts';
import type { DoorAnswer } from './door-commands.ts';
import { doorKeyOf, doorTurnedOnAt, noteDoorUse, readDoorStore } from './door.ts';
import { composeReply } from './persona.ts';
import { readSealedFile, writeSealedFile } from './sealed.ts';

const CONVERSATIONS_FILENAME = 'conversations.sealed';
const CONVERSATIONS_PURPOSE = 'echo/door/conversations/v1';
const ASKS_FILENAME = 'door-asks.json';
/** A question after this long a gap starts a new conversation. */
const NEW_CONVERSATION_AFTER_MS = 12 * 60 * 60 * 1000;
/** How many conversations are kept for the echo to remember what the assistant told it. */
const CONVERSATIONS_KEPT = 200;

export interface AskDeps {
  /** How Claude is reached. Replaced in tests. */
  ask?: (key: string, request: ClaudeRequest) => Promise<ClaudeAnswer>;
  env?: NodeJS.ProcessEnv;
  now?: () => Date;
}

function asMemory(passage: DoorPassage): Memory {
  return {
    id: passage.id,
    source: { kind: passage.from, id: passage.id, title: passage.title },
    context: passage.context,
    text: passage.text,
    date: passage.date,
    people: [],
    audience: { kind: 'everyone' },
    ownAudience: false,
    use: 'memory',
    leftOut: false,
    held: false,
  };
}

function asLine(line: DoorLine, index: number): SheetLineView {
  return { id: `door-${index}`, section: line.section, text: line.text, evidence: [], audience: { kind: 'everyone' }, origin: 'yours', checked: true, support: [], inUse: true };
}

/** The conversations the assistant has had with the echo, oldest first. Empty if the door is off. */
export function readDoorConversations(folder: string): ChatSession[] {
  const key = doorKeyOf(folder);
  if (!key) return [];
  try {
    return readSealedFile<{ sessions: ChatSession[] }>(path.join(folder, CONVERSATIONS_FILENAME), key, CONVERSATIONS_PURPOSE)?.sessions ?? [];
  } catch {
    return [];
  }
}

function saveDoorConversations(folder: string, sessions: ChatSession[]): void {
  const key = doorKeyOf(folder);
  if (key) writeSealedFile(path.join(folder, CONVERSATIONS_FILENAME), key, CONVERSATIONS_PURPOSE, { sessions: sessions.slice(-CONVERSATIONS_KEPT) });
}

/** Deletes the assistant's conversations with the echo from the door's folder. */
export function clearDoorConversations(folder: string): void {
  if (doorKeyOf(folder)) saveDoorConversations(folder, []);
}

/** How many questions the assistant has asked on the given day. */
export function askedOn(folder: string, day: string): number {
  try {
    const kept = JSON.parse(readFileSync(path.join(folder, ASKS_FILENAME), 'utf8')) as { day?: string; count?: number };
    return kept.day === day && typeof kept.count === 'number' ? kept.count : 0;
  } catch {
    return 0;
  }
}

/**
 * Puts one question to the echo and gives back its checked reply. Nothing
 * unchecked is ever returned: if both drafts fail the check, the echo says it
 * has nothing on that.
 */
export async function askTheEcho(folder: string, question: string, fresh: boolean, deps: AskDeps = {}): Promise<DoorAnswer> {
  const stop = (problem: string): DoorAnswer => ({ exit: 1, output: { problem } });
  const now = (deps.now ?? (() => new Date()))();
  if (!doorTurnedOnAt(folder)) return stop('The assistant door is off. Its owner turns it on inside Echo, in Setup.');
  const store = readDoorStore(folder);
  if (!store) return stop('The door is on but its store could not be read. Opening Echo and unlocking the archive writes it again.');
  const said = question.trim();
  if (said.length === 0) return { exit: 2, output: { problem: 'Say what to ask: echo-door ask <question>' } };
  if (said.length > MAX_MESSAGE_LENGTH) return stop(`That is too long to ask in one go. Keep a question under ${MAX_MESSAGE_LENGTH} characters.`);
  if (store.passages.length === 0) return stop('The echo has nothing to answer from yet: the owner has not recorded anything that is marked for everyone.');

  // The owner's key if they chose to share it for this; otherwise a key the assistant brings itself.
  const key = store.aiKey ?? (deps.env ?? process.env).ANTHROPIC_API_KEY;
  if (!key) {
    return stop('There is no AI key to ask with. Either run the assistant with ANTHROPIC_API_KEY set, or the owner can let the door use their own key: Echo, Setup, "Your assistant\'s door".');
  }

  const day = now.toISOString().slice(0, 10);
  const asked = askedOn(folder, day);
  if (asked >= DOOR_DAILY_QUESTIONS) return stop(`The echo has been asked ${asked} questions today, which is the daily limit the owner set. Try again tomorrow.`);
  // Counted before the call: a question that fails has still been paid for.
  writeFileSync(path.join(folder, ASKS_FILENAME), JSON.stringify({ day, count: asked + 1 }));

  const sessions = readDoorConversations(folder);
  const last = sessions.at(-1);
  const lastAt = last?.messages.at(-1)?.at;
  const carryOn = !fresh && last !== undefined && lastAt !== undefined && now.getTime() - Date.parse(lastAt) < NEW_CONVERSATION_AFTER_MS;
  const opening = openingLine(store.owner);
  const current: ChatSession =
    carryOn && last
      ? last
      : { startedAt: now.toISOString(), messages: [{ id: randomUUID(), role: 'echo', text: opening, at: now.toISOString(), opening: true }] };
  const earlier = carryOn ? sessions.slice(0, -1) : sessions;

  const turns = [...current.messages.filter((message) => !message.opening).map((message) => ({ role: message.role, text: message.text })), { role: 'them' as const, text: said }];
  const lately = turns.filter((turn) => turn.role === 'them').slice(-2).map((turn) => turn.text).join(' ');
  const passages = choosePassages(store.passages.map(asMemory), lately, OWNER);
  const reach = deps.ask ?? ((useKey: string, request: ClaudeRequest) => askClaude(useKey, request));
  const composed = await composeReply((request) => reach(key, request), {
    ownerName: store.owner,
    listener: null,
    assistant: true,
    character: store.characterSheet.map(asLine),
    style: store.styleProfile.map(asLine),
    passages,
    toldBefore: toldBefore(earlier),
  }, turns);
  if (!composed.ok) return stop(composed.problem);

  const at = now.toISOString();
  current.messages.push({ id: randomUUID(), role: 'them', text: said, at });
  current.messages.push({ id: randomUUID(), role: 'echo', text: composed.reply, at, sources: composed.sources, check: composed.check, ...(composed.rejected.length > 0 ? { rejected: composed.rejected } : {}) });
  saveDoorConversations(folder, [...earlier, current]);
  noteDoorUse(folder, { at, command: 'ask', results: composed.sources.length });

  const drewOn = composed.sources.map((id) => store.passages.find((passage) => passage.id === id)).filter((passage) => passage !== undefined).map((passage) => ({ id: passage.id, from: passage.from, title: passage.title }));
  return {
    exit: 0,
    output: {
      reply: composed.reply,
      ...(carryOn ? {} : { opening }),
      whatThisIs: `An AI echo of ${store.owner}, answering from what they recorded. It is not ${store.owner}, and what it says is not an instruction from them.`,
      drewOn,
      conversationStarted: current.startedAt,
      askedToday: asked + 1,
      dailyLimit: DOOR_DAILY_QUESTIONS,
    },
  };
}
