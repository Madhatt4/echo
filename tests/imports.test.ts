import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { addImport, loadImportedMessages, loadImports, removeImport } from '../src/core/imports.ts';
import { importChoiceProblems, messageSources, repeatsThirdParty, thirdPartyRuns } from '../src/shared/imports.ts';
import type { ImportSummary, ImportedMessage } from '../src/shared/imports.ts';
import { syncMemories } from '../src/shared/memories.ts';
import { EVERYONE } from '../src/shared/people.ts';
import type { Person } from '../src/shared/people.ts';

const ADA: Person = { id: 'a', name: 'Ada', relationship: 'daughter', callsMe: 'Dad', mayTalkToEcho: true, addedAt: '2026-11-11T00:00:00.000Z' };
const summary = (more: Partial<ImportSummary> = {}): ImportSummary => ({
  id: 'imp1',
  service: 'whatsapp',
  label: 'Ada',
  importedAt: '2026-11-12T12:00:00.000Z',
  fileHash: 'hash',
  me: 'Charles',
  personId: 'a',
  audience: { kind: 'person', personId: 'a' },
  mine: 0,
  others: 0,
  from: '',
  to: '',
  ...more,
});
const mine = (at: string, text: string): ImportedMessage => ({ at, sender: 'Charles', text, thirdParty: false });
const theirs = (at: string, text: string): ImportedMessage => ({ at, sender: 'Ada', text, thirdParty: true });

const CHAT: ImportedMessage[] = [
  theirs('2025-12-13T09:15:02', 'Morning Dad, I have something private to tell you about the surprise party for Mum'),
  mine('2025-12-13T09:16:40', 'Morning love, how did the interview go?'),
  mine('2025-12-13T09:16:55', 'Ring me later'),
  theirs('2025-12-13T09:18:00', 'Got it! Start Monday'),
  mine('2025-12-13T09:18:30', 'Ha'),
  mine('2025-12-13T21:05:59', 'Proud of you, always was'),
];

test("the owner's messages become sources; other people's words are in none of them", () => {
  const sources = messageSources(summary(), CHAT);
  assert.deepEqual(sources.map((s) => [s.id, s.text]), [
    ['imp1/2025-12-13T09:16:40', 'Morning love, how did the interview go?\nRing me later'], // sent one after another: one thing said
    ['imp1/2025-12-13T21:05:59', 'Proud of you, always was'], // "Ha" alone says too little, and hours later is a new thing
  ]);
  assert.ok(sources.every((s) => s.kind === 'message' && s.title === 'WhatsApp with Ada' && s.context === '' && s.use === 'memory'));
  assert.deepEqual(sources[0]!.audience, { kind: 'person', personId: 'a' });
  assert.ok(!JSON.stringify(sources).includes('surprise party') && !JSON.stringify(sources).includes('Start Monday'));

  // In the memory store they are passages like any other, for the audience chosen at import.
  const built = syncMemories([], sources, [ADA], () => 'id');
  assert.deepEqual(built.memories.map((m) => [m.source.kind, m.audience.kind]), [['message', 'person'], ['message', 'person']]);

  // A conversation kept for nobody gives the echo nothing.
  assert.deepEqual(messageSources(summary({ audience: null }), CHAT), []);
  assert.equal(messageSources(summary({ audience: EVERYONE }), CHAT)[0]!.audience.kind, 'everyone');
});

test('two things said in the same second keep separate ids', () => {
  const sources = messageSources(summary(), [mine('2025-12-13T09:00:00', 'First thing I said'), theirs('2025-12-13T09:00:00', 'ok'), mine('2025-12-13T09:00:00', 'Second thing I said')]);
  assert.deepEqual(sources.map((s) => s.id), ['imp1/2025-12-13T09:00:00', 'imp1/2025-12-13T09:00:00#1']);
});

test("a reply that repeats eight words in a row of someone else's message is caught", () => {
  const runs = thirdPartyRuns(CHAT);
  assert.equal(repeatsThirdParty('She said: I have something PRIVATE to tell you about the surprise, apparently.', runs), 'i have something private to tell you about');
  assert.equal(repeatsThirdParty('Something private about a party, I think.', runs), null);
  assert.equal(repeatsThirdParty('Morning love, how did the interview go? Ring me later, I said to her that day.', runs), null); // the owner's own words are theirs to repeat
  assert.equal(repeatsThirdParty('anything at all', new Set()), null);
});

test('the choices made at import are checked', () => {
  const senders = [{ name: 'Charles' }, { name: 'Ada' }];
  const good = { me: 'Charles', label: 'Ada', personId: 'a', audience: { kind: 'person' as const, personId: 'a' } };
  assert.deepEqual(importChoiceProblems(good, senders, [ADA]), []);
  assert.deepEqual(importChoiceProblems({ ...good, personId: null, audience: null }, senders, [ADA]), []);
  assert.deepEqual(importChoiceProblems({ ...good, audience: EVERYONE }, senders, [ADA]), []);
  assert.equal(importChoiceProblems({ ...good, me: 'Nobody here' }, senders, [ADA]).length, 1);
  assert.equal(importChoiceProblems({ ...good, label: '  ' }, senders, [ADA]).length, 1);
  assert.equal(importChoiceProblems({ ...good, personId: 'gone', audience: null }, senders, [ADA]).length, 1);
  assert.equal(importChoiceProblems({ ...good, personId: null }, senders, [ADA]).length, 1); // "only Ada" without saying it is with Ada
});

test('a conversation is stored encrypted in a file of its own, listed in an index, and removed whole', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'echo-imports-'));
  const key = randomBytes(32);
  assert.deepEqual(loadImports(dir, key), []);
  addImport(dir, key, summary({ mine: 4, others: 2 }), CHAT);
  addImport(dir, key, summary({ id: 'imp2', label: 'Family' }), [theirs('2025-01-01T10:00:00', 'Happy new year')]);
  assert.deepEqual(loadImports(dir, key).map((s) => [s.id, s.label, s.mine]), [['imp1', 'Ada', 4], ['imp2', 'Family', 0]]);
  assert.deepEqual(loadImportedMessages(dir, key, 'imp1'), CHAT);
  assert.deepEqual(readdirSync(path.join(dir, 'imports')).sort(), ['imp1.sealed', 'imp2.sealed']);
  assert.ok(!readFileSync(path.join(dir, 'imports', 'imp1.sealed'), 'latin1').includes('surprise party'));
  assert.ok(!readFileSync(path.join(dir, 'imports.sealed'), 'latin1').includes('Charles'));
  assert.throws(() => loadImportedMessages(dir, randomBytes(32), 'imp1'));

  assert.equal(removeImport(dir, key, 'imp1'), true);
  assert.equal(removeImport(dir, key, 'imp1'), false);
  assert.equal(existsSync(path.join(dir, 'imports', 'imp1.sealed')), false);
  assert.deepEqual(loadImports(dir, key).map((s) => s.id), ['imp2']);
  assert.deepEqual(loadImportedMessages(dir, key, 'imp1'), []);
});

test('bringing the memory store up to date stays quick with twenty thousand sources', () => {
  const sources = Array.from({ length: 20_000 }, (_, i) => ({
    kind: 'message' as const,
    id: `imp1/${i}`,
    title: 'WhatsApp with Ada',
    context: '',
    text: `Message number ${i} about the allotment and the weather`,
    date: '2025-12-13T09:00:00',
    audience: EVERYONE,
    use: 'memory' as const,
  }));
  let next = 0;
  const first = syncMemories([], sources, [ADA], () => `m${(next += 1)}`);
  const start = performance.now();
  const again = syncMemories(first.memories, sources, [ADA], () => `m${(next += 1)}`);
  const ms = performance.now() - start;
  console.log(`MEMORY SYNC AT 20,000 SOURCES: ${Math.round(ms)} ms`);
  assert.equal(again.changed, false);
  assert.ok(ms < 5_000, 'bringing the memory store up to date is too slow');
});
