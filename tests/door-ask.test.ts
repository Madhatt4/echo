import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import type { ClaudeAnswer, ClaudeRequest } from '../src/core/anthropic.ts';
import { askTheEcho, askedOn, clearDoorConversations, readDoorConversations } from '../src/core/door-ask.ts';
import { runDoorCommandAsync } from '../src/core/door-commands.ts';
import { createDoorMcp } from '../src/core/door-mcp.ts';
import { openDoor, takeDoorUses, writeDoorStore } from '../src/core/door.ts';
import type { DoorStore } from '../src/shared/door.ts';
import { NOTHING_LINE } from '../src/shared/persona.ts';

const store: DoorStore = {
  version: 1,
  writtenAt: '2026-11-13T09:00:00.000Z',
  owner: 'Ada Lovelace',
  passages: [
    { id: 'caravan', from: 'story', title: 'The caravan', context: '', text: 'We went to the caravan every summer and it always rained.', date: '2026-11-10T09:00:00.000Z' },
    { id: 'lorries', from: 'interview', title: 'Work', context: 'What did you do for a living?', text: 'I drove lorries for thirty years.', date: '2026-11-12T09:00:00.000Z' },
  ],
  characterSheet: [{ section: 'values', text: 'I say what I think.' }],
  styleProfile: [{ section: 'voice', text: 'Plain speaker.' }],
};

function door(contents: DoorStore | null = store): string {
  const folder = path.join(mkdtempSync(path.join(tmpdir(), 'echo-ask-')), 'assistant-door');
  if (contents) {
    openDoor(folder);
    writeDoorStore(folder, contents);
  }
  return folder;
}

const CHECK_OK = '{"ok": true, "problems": []}';
const CHECK_BAD = '{"ok": false, "problems": ["Says something no passage holds."]}';
const reply = (text: string, passages: number[] = [1]) => JSON.stringify({ reply: text, passages });

/** Stands in for Claude: answers each request from a list, in order, and keeps what it was sent. */
function claude(answers: string[]) {
  const sent: { key: string; request: ClaudeRequest }[] = [];
  const ask = async (key: string, request: ClaudeRequest): Promise<ClaudeAnswer> => {
    sent.push({ key, request });
    const next = answers.shift();
    return next === undefined ? { ok: false, problem: 'the stand-in ran out of answers' } : { ok: true, text: next, model: 'test' };
  };
  return { ask, sent };
}

const out = (answer: { output: unknown }) => answer.output as Record<string, any>;
const KEY = { env: { ANTHROPIC_API_KEY: 'key-the-assistant-brought' } };

test('the echo answers the assistant from the store, checked, and is told it is talking to an assistant', async () => {
  const folder = door();
  const { ask, sent } = claude([reply('Thirty years on the lorries, me.', [1]), CHECK_OK]);
  const answer = await askTheEcho(folder, 'What did you do for work?', false, { ask, ...KEY });
  assert.equal(answer.exit, 0);
  assert.equal(out(answer).reply, 'Thirty years on the lorries, me.');
  assert.ok(out(answer).opening.includes('AI echo')); // every conversation opens with the fixed line saying what it is
  assert.ok(out(answer).whatThisIs.includes('It is not Ada Lovelace'));
  assert.deepEqual([out(answer).askedToday, out(answer).dailyLimit], [1, 30]);
  assert.equal(out(answer).drewOn.length, 1);

  assert.equal(sent.length, 2); // the draft, then the checker
  assert.equal(sent[0]!.key, 'key-the-assistant-brought');
  const told = sent[0]!.request.system;
  assert.ok(told.includes('You are the AI echo of Ada Lovelace'));
  assert.ok(told.includes('An AI assistant that works for Ada Lovelace. It is a program, not a person and not one of the family.'));
  assert.ok(told.includes('I drove lorries for thirty years.') && told.includes('I say what I think.'));
  assert.ok(sent[1]!.request.system.includes('You are the checker'));

  // Kept, sealed, for the echo to remember and the owner to read.
  const [session] = readDoorConversations(folder);
  assert.deepEqual(session!.messages.map((message) => [message.role, message.opening === true]), [['echo', true], ['them', false], ['echo', false]]);
  assert.ok(!readFileSync(path.join(folder, 'conversations.sealed'), 'utf8').includes('lorries'));
  // Written down for the activity log without the words.
  assert.deepEqual(takeDoorUses(folder).map((use) => use.command), ['ask']);
});

test('a second question carries on the conversation; --new or half a day starts another', async () => {
  const folder = door();
  let clock = new Date('2026-11-13T10:00:00.000Z');
  const now = () => clock;
  const first = claude([reply('Thirty years on the lorries.'), CHECK_OK]);
  await askTheEcho(folder, 'What did you do for work?', false, { ask: first.ask, now, ...KEY });

  const second = claude([reply('Every summer, and it always rained.'), CHECK_OK]);
  const carried = await askTheEcho(folder, 'And holidays?', false, { ask: second.ask, now, ...KEY });
  assert.equal(out(carried).opening, undefined); // the same conversation: no second opening line
  assert.ok(JSON.stringify(second.sent[0]!.request.messages).includes('What did you do for work?')); // the echo was given what came before
  assert.equal(readDoorConversations(folder).length, 1);

  const third = claude([reply('Thirty years.'), CHECK_OK]);
  const fresh = await askTheEcho(folder, 'Work again?', true, { ask: third.ask, now, ...KEY });
  assert.ok(typeof out(fresh).opening === 'string');
  assert.ok(!JSON.stringify(third.sent[0]!.request.messages).includes('And holidays?')); // not carried into the new conversation as turns
  assert.ok(third.sent[0]!.request.system.includes('And holidays?')); // but the echo remembers what the assistant told it before
  assert.equal(readDoorConversations(folder).length, 2);

  clock = new Date('2026-11-14T08:00:00.000Z'); // the next morning
  const fourth = claude([reply('Thirty years.'), CHECK_OK]);
  assert.ok(typeof out(await askTheEcho(folder, 'Morning. Work?', false, { ask: fourth.ask, now, ...KEY })).opening === 'string');
  assert.equal(readDoorConversations(folder).length, 3);

  clearDoorConversations(folder);
  assert.deepEqual(readDoorConversations(folder), []);
});

test('nothing unchecked is ever returned: two failed drafts give the fixed line that it has nothing on that', async () => {
  const folder = door();
  const { ask, sent } = claude([reply('I once sailed to Peru.'), CHECK_BAD, reply('I flew to Peru.'), CHECK_BAD]);
  const answer = await askTheEcho(folder, 'Did you ever go abroad?', false, { ask, ...KEY });
  assert.deepEqual([answer.exit, out(answer).reply, sent.length], [0, NOTHING_LINE, 4]);
  assert.ok(!JSON.stringify(answer.output).includes('Peru')); // the drafts that failed are not handed to the assistant
});

test("whose key pays: the owner's if they chose to share it, otherwise one the assistant brings, otherwise nothing is asked", async () => {
  const none = claude([]);
  const refused = await askTheEcho(door(), 'Work?', false, { ask: none.ask, env: {} });
  assert.ok(refused.exit === 1 && String(out(refused).problem).includes('ANTHROPIC_API_KEY') && none.sent.length === 0);

  const shared = claude([reply('Thirty years.'), CHECK_OK]);
  await askTheEcho(door({ ...store, aiKey: 'key-the-owner-shared' }), 'Work?', false, { ask: shared.ask, ...KEY });
  assert.equal(shared.sent[0]!.key, 'key-the-owner-shared');
});

test('the daily limit holds, counts failures too, and starts again the next day', async () => {
  const folder = door();
  let clock = new Date('2026-11-13T10:00:00.000Z');
  const now = () => clock;
  const failing = async (): Promise<ClaudeAnswer> => ({ ok: false, problem: 'The AI service could not be reached.' });
  const failed = await askTheEcho(folder, 'Work?', false, { ask: failing, now, ...KEY });
  assert.ok(failed.exit === 1 && String(out(failed).problem).includes('could not be reached'));
  assert.equal(askedOn(folder, '2026-11-13'), 1); // a failed question has still been paid for
  assert.deepEqual(readDoorConversations(folder), []); // and nothing is kept of it

  for (let i = 0; i < 29; i += 1) await askTheEcho(folder, 'Work?', true, { ask: failing, now, ...KEY });
  const { ask, sent } = claude([reply('x'), CHECK_OK]);
  const over = await askTheEcho(folder, 'Work?', false, { ask, now, ...KEY });
  assert.ok(over.exit === 1 && String(out(over).problem).includes('daily limit') && sent.length === 0);

  clock = new Date('2026-11-14T10:00:00.000Z');
  assert.equal((await askTheEcho(folder, 'Work?', false, { ask, now, ...KEY })).exit, 0);
});

test('what cannot be asked is refused before anything is spent', async () => {
  const { ask, sent } = claude([]);
  assert.equal((await askTheEcho(door(null), 'Work?', false, { ask, ...KEY })).exit, 1); // door off
  assert.equal((await askTheEcho(door(), '   ', false, { ask, ...KEY })).exit, 2);
  assert.equal((await askTheEcho(door(), 'x'.repeat(4001), false, { ask, ...KEY })).exit, 1);
  assert.ok(String(out(await askTheEcho(door({ ...store, passages: [] }), 'Work?', false, { ask, ...KEY })).problem).includes('nothing to answer from'));
  assert.equal(sent.length, 0);
});

test('asking works as a shell command and as an MCP tool', async () => {
  const folder = door();
  const shell = claude([reply('Thirty years on the lorries.'), CHECK_OK]);
  const answer = await runDoorCommandAsync(['ask', 'What', 'did', 'you', 'do?', '--new', 'yes'], folder, '', { ask: shell.ask, ...KEY });
  assert.deepEqual([answer.exit, out(answer).reply], [0, 'Thirty years on the lorries.']);
  assert.equal((await runDoorCommandAsync(['ask', 'x', '--new', 'maybe'], folder, '', { ask: shell.ask, ...KEY })).exit, 2);
  assert.equal((await runDoorCommandAsync(['status'], folder)).exit, 0); // everything else still answers

  const tool = claude([reply('Every summer.'), CHECK_OK]);
  const server = createDoorMcp(folder, '1.0.0', { ask: tool.ask, ...KEY });
  server.handle(JSON.stringify({ jsonrpc: '2.0', id: 0, method: 'initialize', params: { protocolVersion: '2025-06-18' } }));
  const pending = server.handle(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'echo_ask', arguments: { question: 'Holidays?' } } }));
  assert.ok(pending instanceof Promise);
  const done = JSON.parse((await pending) ?? '{}');
  assert.deepEqual([done.id, done.result.isError, JSON.parse(done.result.content[0].text).reply], [1, false, 'Every summer.']);
  const wrong = server.handle(JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'echo_ask', arguments: {} } }));
  assert.ok(typeof wrong === 'string' && JSON.parse(wrong).error.code === -32602);
});
