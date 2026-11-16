import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { ClaudeAnswer, ClaudeRequest } from '../src/core/anthropic.ts';
import { composeReply } from '../src/core/persona.ts';
import type { Memory } from '../src/shared/memories.ts';
import { EVERYONE } from '../src/shared/people.ts';
import type { Audience, Person } from '../src/shared/people.ts';
import {
  NOTHING_LINE,
  OWNER,
  checkerInstructions,
  checkerMessage,
  choosePassages,
  echoInstructions,
  echoMessages,
  listenerKey,
  openingLine,
  permittedLines,
  permittedPassages,
  readCheck,
  readEchoDraft,
  searchTerms,
} from '../src/shared/persona.ts';
import type { EchoContext } from '../src/shared/persona.ts';
import type { SheetLineView } from '../src/shared/sheets.ts';

const ADA: Person = { id: 'a', name: 'Ada', relationship: 'my daughter', callsMe: 'Dad', mayTalkToEcho: true, addedAt: '2026-11-11T00:00:00.000Z' };
const BEN: Person = { id: 'b', name: 'Ben', relationship: 'son', callsMe: 'Dad', mayTalkToEcho: true, addedAt: '2026-11-11T00:00:00.000Z' };
const PEOPLE = [ADA, BEN];
const FOR_ADA: Audience = { kind: 'person', personId: 'a' };
const TO_ADA = { kind: 'person' as const, personId: 'a' };
const TO_BEN = { kind: 'person' as const, personId: 'b' };

const memory = (id: string, text: string, more: Partial<Memory> = {}): Memory => ({
  id,
  source: { kind: 'story', id: `src-${id}`, title: 'A story' },
  context: '',
  text,
  date: '2026-11-11T10:00:00.000Z',
  people: [],
  audience: EVERYONE,
  ownAudience: false,
  use: 'memory',
  leftOut: false,
  held: false,
  ...more,
});
const line = (id: string, section: string, text: string, more: Partial<SheetLineView> = {}): SheetLineView => ({
  id,
  section,
  text,
  evidence: [],
  audience: EVERYONE,
  origin: 'yours',
  checked: true,
  support: [],
  inUse: true,
  ...more,
});

const STORE = [
  memory('caravan', 'We took the caravan to Cornwall every August.'),
  memory('ada-only', 'I never told your brother, but I was proudest of you.', { audience: FOR_ADA }),
  memory('left-out', 'Something left out.', { leftOut: true }),
  memory('held', 'Something held back.', { held: true }),
  memory('wedding', 'Marry someone who makes you laugh.', { audience: FOR_ADA, use: 'advice-on-the-day' }),
  memory('job', 'It is only a job.', { audience: FOR_ADA, use: 'advice-when-asked', source: { kind: 'advice', id: 'adv', title: 'Losing a job' } }),
];

test('each listener is given only what is in use and meant for them', () => {
  assert.deepEqual(permittedPassages(STORE, OWNER, PEOPLE).map((m) => m.id), ['caravan']);
  assert.deepEqual(permittedPassages(STORE, TO_ADA, PEOPLE).map((m) => m.id), ['caravan', 'ada-only', 'job']);
  assert.deepEqual(permittedPassages(STORE, TO_BEN, PEOPLE).map((m) => m.id), ['caravan']);
  assert.deepEqual(permittedPassages(STORE, { kind: 'person', personId: 'stranger' }, PEOPLE), []);
  assert.deepEqual([listenerKey(OWNER), listenerKey(TO_ADA)], ['owner', 'a']);

  const lines = [line('1', 'voice', 'I talk plainly.'), line('2', 'people', 'I call her kiddo.', { audience: FOR_ADA }), line('3', 'values', 'Not relied on.', { inUse: false })];
  assert.deepEqual(permittedLines(lines, OWNER, PEOPLE).map((l) => l.id), ['1']);
  assert.deepEqual(permittedLines(lines, TO_ADA, PEOPLE).map((l) => l.id), ['1', '2']);
  assert.deepEqual(permittedLines(lines, TO_BEN, PEOPLE).map((l) => l.id), ['1']);
});

test('search terms drop small words and rough endings', () => {
  assert.deepEqual(searchTerms('Do you remember the caravans we took fishing?'), ['caravan', 'took', 'fish']);
});

test('everything permitted is sent when it fits; when it does not, what is being talked about comes first', () => {
  const store = [
    memory('shed', 'I built the allotment shed from old pallets.'),
    memory('lorry', 'My first lorry was a Bedford and it leaked.'),
    memory('cornwall', 'We took the caravan to Cornwall every August.'),
    memory('advice', 'It is only a job.', { use: 'advice-when-asked' }),
  ];
  assert.equal(choosePassages(store, 'hello', OWNER).length, 4);
  assert.deepEqual(choosePassages(store, 'Tell me about the allotment shed', OWNER, 150).map((m) => m.id), ['shed']);
  assert.deepEqual(choosePassages(store, 'What was your first lorry like?', OWNER, 150).map((m) => m.id), ['lorry']);
  // With nothing to match on, advice meant to be brought up comes ahead of the rest.
  assert.equal(choosePassages(store, 'hello', OWNER, 150)[0]!.id, 'advice');
  // A passage that involves the listener is lifted.
  const involving = [memory('other', 'A day at the seaside.'), memory('theirs', 'A day at the seaside.', { people: ['a'] })];
  assert.equal(choosePassages(involving, 'seaside', TO_ADA, 150)[0]!.id, 'theirs');
});

const context = (more: Partial<EchoContext> = {}): EchoContext => ({
  ownerName: 'Charles Babbage',
  listener: ADA,
  character: [line('c1', 'values', 'I say what I think.')],
  style: [line('s1', 'voice', 'I talk plainly.'), line('s2', 'people', 'I call her kiddo.', { audience: FOR_ADA })],
  passages: [STORE[0]!, STORE[5]!],
  toldBefore: ['I passed my driving test.'],
  ...more,
});

test('the opening line says it is an AI echo, and the instructions hold the rules', () => {
  const opening = openingLine('Charles Babbage');
  assert.ok(opening.includes('AI echo of Charles Babbage') && opening.includes("I'm not Charles"));

  const told = echoInstructions(context());
  assert.ok(told.includes(opening));
  assert.ok(told.includes('You are an AI echo. You are not Charles'));
  assert.ok(told.includes('may come ONLY from the numbered passages'));
  assert.ok(told.includes('Never fill a gap with an invented memory or fact'));
  assert.ok(told.includes('Ada, Charles\'s daughter.') && told.includes('They call Charles "Dad"'));
  assert.ok(told.includes('- I say what I think.') && told.includes('How I talk to Ada:\n- I call her kiddo.'));
  assert.ok(told.includes('[1] (story: A story; recorded 2026-11-11)\nWe took the caravan to Cornwall every August.'));
  assert.ok(told.includes('[2] (advice for this person, for the occasion: Losing a job; recorded 2026-11-11)\nIt is only a job.'));
  assert.ok(told.includes('WHAT ADA TOLD YOU IN EARLIER CONVERSATIONS') && told.includes('- I passed my driving test.'));
  assert.ok(told.includes('crisis line'));

  const trying = echoInstructions(context({ listener: null, passages: [], toldBefore: [], character: [], style: [] }));
  assert.ok(trying.includes('Charles Babbage themselves, who is trying you out'));
  assert.ok(trying.includes('(There are no passages for this conversation.)') && trying.includes('(Nothing has been written here yet.)'));
  assert.ok(!trying.includes('EARLIER CONVERSATIONS'));
});

test('the conversation is sent as turns, and a redraft is told what was wrong without the person seeing it', () => {
  const turns = [
    { role: 'them' as const, text: 'Hello Dad.' },
    { role: 'echo' as const, text: 'Hello, kiddo.' },
    { role: 'them' as const, text: 'Do you remember Wales?' },
  ];
  assert.deepEqual(echoMessages(turns, null), [
    { role: 'user', content: 'Hello Dad.' },
    { role: 'assistant', content: '{"reply":"Hello, kiddo.","passages":[]}' },
    { role: 'user', content: 'Do you remember Wales?' },
  ]);
  // Two messages in a row from them, as after a failed reply, go as one.
  assert.deepEqual(echoMessages([turns[0]!, turns[2]!], null), [{ role: 'user', content: 'Hello Dad.\n\nDo you remember Wales?' }]);
  const again = echoMessages(turns, { draft: 'We went in 1994.', problems: ['"1994" is in no passage.'] });
  assert.equal(again.length, 5);
  assert.ok(again[4]!.content.includes('NOT shown to them') && again[4]!.content.includes('- "1994" is in no passage.'));
});

test('replies and verdicts are read strictly', () => {
  assert.deepEqual(readEchoDraft('{"reply": " Hello, kiddo. ", "passages": [1, 1, 3, "x"]}', 2), { reply: 'Hello, kiddo.', passages: [0] });
  assert.deepEqual(readEchoDraft('Hello, kiddo.', 2), { reply: 'Hello, kiddo.', passages: [] });
  assert.equal(readEchoDraft('{"reply": ""}', 2), null);
  assert.equal(readEchoDraft('   ', 2), null);

  assert.deepEqual(readCheck('{"ok": true, "problems": []}'), { ok: true, problems: [] });
  assert.deepEqual(readCheck('Verdict: {"ok": false, "problems": ["Invents a trip to Wales."]}'), { ok: false, problems: ['Invents a trip to Wales.'] });
  assert.equal(readCheck('{"ok": false}')!.ok, false);
  assert.deepEqual(readCheck('{"ok": true, "problems": ["but it invents Wales"]}'), { ok: false, problems: ['but it invents Wales'] }); // says ok while listing a problem: not ok
  assert.equal(readCheck('looks fine to me'), null);
  assert.ok(checkerInstructions('Charles Babbage').includes('never makes up Charles'));
  assert.ok(checkerMessage([STORE[0]!], [{ role: 'them', text: 'Hi' }], 'A draft.').endsWith('DRAFT REPLY TO CHECK\nA draft.'));
});

/** A stand-in for Claude that gives each answer in turn and notes what it was asked. */
function script(answers: (string | ClaudeAnswer)[]) {
  const asked: ClaudeRequest[] = [];
  const ask = async (request: ClaudeRequest): Promise<ClaudeAnswer> => {
    asked.push(request);
    const next = answers.shift();
    if (next === undefined) throw new Error('Claude was asked more often than expected');
    return typeof next === 'string' ? { ok: true, text: next, model: 'test' } : next;
  };
  return { ask, asked };
}
const TURNS = [{ role: 'them' as const, text: 'Where did we go on holiday?' }];
const GOOD = '{"reply": "Cornwall, every August, in the caravan.", "passages": [1]}';
const INVENTED = '{"reply": "Wales, in 1994. It rained all week.", "passages": []}';
const OK = '{"ok": true, "problems": []}';
const NOT_OK = '{"ok": false, "problems": ["Wales in 1994 is in no passage."]}';

test('a reply that passes the check goes out with the passages it drew on', async () => {
  const { ask, asked } = script([GOOD, OK]);
  assert.deepEqual(await composeReply(ask, context(), TURNS), { ok: true, reply: 'Cornwall, every August, in the caravan.', sources: ['caravan'], check: 'passed', rejected: [] });
  assert.equal(asked.length, 2);
  assert.ok(asked[1]!.system.includes('You are the checker') && asked[1]!.messages[0]!.content.includes('Cornwall, every August, in the caravan.'));
});

test('a draft that invents a memory is never shown: it is redrafted once, then replaced by the "nothing" line', async () => {
  const redrafted = script([INVENTED, NOT_OK, '{"reply": "I never got round to telling Echo where else we went.", "passages": []}', OK]);
  assert.deepEqual(await composeReply(redrafted.ask, context(), TURNS), {
    ok: true,
    reply: 'I never got round to telling Echo where else we went.',
    sources: [],
    check: 'redrafted',
    rejected: ['Wales in 1994 is in no passage.'],
  });
  assert.ok(redrafted.asked[2]!.messages.at(-1)!.content.includes('Wales in 1994 is in no passage.'));

  const stubborn = script([INVENTED, NOT_OK, INVENTED, NOT_OK]);
  const fallback = await composeReply(stubborn.ask, context(), TURNS);
  assert.deepEqual([fallback.ok && fallback.reply, fallback.ok && fallback.check], [NOTHING_LINE, 'fallback']);

  // A checker that cannot be read is treated as a failed check, never as a pass.
  const unreadable = script([GOOD, 'looks fine', GOOD, 'still fine']);
  const untrusted = await composeReply(unreadable.ask, context(), TURNS);
  assert.equal(untrusted.ok && untrusted.check, 'fallback');
});

test('if Claude cannot be reached at either step, nothing is shown and the reason is given', async () => {
  const down: ClaudeAnswer = { ok: false, problem: 'Echo could not reach Anthropic.' };
  assert.deepEqual(await composeReply(script([down]).ask, context(), TURNS), { ok: false, problem: 'Echo could not reach Anthropic.' });
  assert.deepEqual(await composeReply(script([GOOD, down]).ask, context(), TURNS), { ok: false, problem: 'Echo could not reach Anthropic.' });
});
