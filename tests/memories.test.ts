import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { loadMemories, saveMemories } from '../src/core/memories.ts';
import {
  applyMemoryChange,
  memoryChangeProblems,
  memoryWords,
  peopleInvolved,
  splitIntoPassages,
  syncMemories,
  touched,
  usable,
} from '../src/shared/memories.ts';
import type { Memory, MemorySource } from '../src/shared/memories.ts';
import { EVERYONE } from '../src/shared/people.ts';
import type { Person } from '../src/shared/people.ts';

const ADA: Person = { id: 'a', name: 'Ada', relationship: 'daughter', callsMe: 'Dad', mayTalkToEcho: true, addedAt: '2026-11-11T00:00:00.000Z' };
const BEN: Person = { id: 'b', name: 'Ben', relationship: 'son', callsMe: 'Dad', mayTalkToEcho: true, addedAt: '2026-11-11T00:00:00.000Z' };
const PEOPLE = [ADA, BEN];

const counter = () => {
  let next = 0;
  return () => `m${(next += 1)}`;
};
const words = (count: number, word = 'word') => Array.from({ length: count }, () => word).join(' ');
const story = (text: string, more: Partial<MemorySource> = {}): MemorySource => ({
  kind: 'story',
  id: 's1',
  title: 'The caravan',
  context: '',
  text,
  date: '2026-11-11T10:00:00.000Z',
  audience: EVERYONE,
  use: 'memory',
  ...more,
});

test('short text is one passage; paragraphs are kept together where they fit', () => {
  assert.deepEqual(splitIntoPassages('  We went to Cornwall.  '), ['We went to Cornwall.']);
  assert.deepEqual(splitIntoPassages('One.\n\nTwo.\r\n\r\nThree.'), ['One.\n\nTwo.\n\nThree.']);
  assert.deepEqual(splitIntoPassages('   \n\n  '), []);
});

test('long text is cut at sentence ends, never above the limit, and loses no words', () => {
  const sentence = (n: number) => `${words(39, `s${n}`)} end${n}.`;
  const text = [1, 2, 3, 4, 5].map(sentence).join(' ');
  const passages = splitIntoPassages(text, 100);
  assert.equal(passages.length, 3);
  assert.ok(passages.every((passage) => passage.split(' ').length <= 100));
  assert.ok(passages.every((passage) => passage.endsWith('.')));
  assert.equal(passages.join(' '), text);

  // One endless sentence, as speech-to-text can produce, is still cut.
  const endless = splitIntoPassages(words(250), 100);
  assert.deepEqual(endless.map((passage) => passage.split(' ').length), [100, 100, 50]);
  // The same text always gives the same passages.
  assert.deepEqual(splitIntoPassages(text, 100), passages);
});

test('people involved are those named as whole words, and the person it is for', () => {
  assert.deepEqual(peopleInvolved('I took ada and Ben fishing.', EVERYONE, PEOPLE), ['a', 'b']);
  assert.deepEqual(peopleInvolved('We drove to Benidorm in the Lada.', EVERYONE, PEOPLE), []);
  assert.deepEqual(peopleInvolved('Be kind.', { kind: 'person', personId: 'b' }, PEOPLE), ['b']);
  assert.deepEqual(peopleInvolved('Be kind.', { kind: 'person', personId: 'gone' }, PEOPLE), []);
});

test('each source is cut into passages that carry its title, date, audience and use', () => {
  const sources: MemorySource[] = [
    story('We took the caravan to Cornwall with Ada.'),
    { kind: 'interview', id: 'work/1', title: 'Work', context: 'What was your first job?', text: 'I drove lorries.', date: '2026-11-12T10:00:00.000Z', audience: { kind: 'person', personId: 'b' }, use: 'memory' },
    { kind: 'advice', id: 'adv1', title: 'Your wedding day', context: '', text: 'Marry someone who makes you laugh.', date: '2026-11-12T11:00:00.000Z', audience: { kind: 'person', personId: 'a' }, use: 'advice-on-the-day' },
  ];
  const result = syncMemories([], sources, PEOPLE, counter());
  assert.deepEqual([result.added, result.removed, result.held, result.changed], [3, 0, 0, true]);
  const [caravan, job, wedding] = result.memories;
  assert.deepEqual(caravan!.source, { kind: 'story', id: 's1', title: 'The caravan' });
  assert.deepEqual(caravan!.people, ['a']);
  assert.equal(job!.context, 'What was your first job?');
  assert.deepEqual(job!.audience, { kind: 'person', personId: 'b' });
  assert.deepEqual(job!.people, ['b']);
  assert.equal(usable(caravan!), true);
  assert.equal(usable(wedding!), false); // kept for the day: never used in conversation before then

  // Bringing it up to date again changes nothing and keeps the same ids.
  const again = syncMemories(result.memories, sources, PEOPLE, counter());
  assert.equal(again.changed, false);
  assert.deepEqual(again.memories, result.memories);
});

test('what the person did to a passage survives; an untouched passage follows its source', () => {
  const text = `${words(100, 'first')}.\n\n${words(100, 'second')}.`;
  const built = syncMemories([], [story(text)], PEOPLE, counter()).memories;
  assert.equal(built.length, 2);
  const marked = [built[0]!, applyMemoryChange(built[1]!, { audience: { kind: 'person', personId: 'a' }, words: 'the second part, corrected' }, PEOPLE)];
  assert.equal(touched(marked[0]!), false);
  assert.equal(touched(marked[1]!), true);
  assert.equal(memoryWords(marked[1]!), 'the second part, corrected');
  assert.equal(marked[1]!.text, `${words(100, 'second')}.`); // the original wording is kept underneath

  // The story is renamed and made private to Ben at its source.
  const result = syncMemories(marked, [story(text, { title: 'Cornwall', audience: { kind: 'person', personId: 'b' } })], PEOPLE, counter());
  assert.deepEqual([result.added, result.removed, result.held], [0, 0, 0]);
  assert.equal(result.memories[0]!.source.title, 'Cornwall');
  assert.deepEqual(result.memories[0]!.audience, { kind: 'person', personId: 'b' }); // follows the source
  assert.deepEqual(result.memories[1]!.audience, { kind: 'person', personId: 'a' }); // keeps what the person set
  assert.equal(result.memories[1]!.words, 'the second part, corrected');
});

test('when a source changes under a passage the person had marked, the new passages are held back', () => {
  const first = `${words(100, 'first')}.`;
  const second = `${words(100, 'second')}.`;
  const built = syncMemories([], [story(`${first}\n\n${second}`)], PEOPLE, counter()).memories;
  const marked = [built[0]!, applyMemoryChange(built[1]!, { leftOut: true }, PEOPLE)];

  // A typo is fixed in the passage that had been left out.
  const fixed = syncMemories(marked, [story(`${first}\n\n${second} Fixed.`)], PEOPLE, counter());
  assert.deepEqual([fixed.added, fixed.removed, fixed.held], [1, 1, 1]);
  assert.equal(fixed.memories[0]!.held, false); // the untouched, unchanged passage carries on
  assert.equal(fixed.memories[1]!.held, true);
  assert.equal(usable(fixed.memories[1]!), false);
  assert.equal(usable(applyMemoryChange(fixed.memories[1]!, { held: false }, PEOPLE)), true);

  // The same fix in a story nobody had marked holds nothing back.
  const plain = syncMemories(built, [story(`${first}\n\n${second} Fixed.`)], PEOPLE, counter());
  assert.deepEqual([plain.added, plain.removed, plain.held], [1, 1, 0]);
});

test('passages go when their source goes', () => {
  const built = syncMemories([], [story('One story.'), story('Another.', { id: 's2' })], PEOPLE, counter()).memories;
  const result = syncMemories(built, [story('Another.', { id: 's2' })], PEOPLE, counter());
  assert.deepEqual([result.added, result.removed], [0, 1]);
  assert.deepEqual(result.memories.map((memory) => memory.text), ['Another.']);
});

test('changes to a passage are checked, and correcting it back to the original clears the correction', () => {
  assert.equal(memoryChangeProblems({ words: '   ' }, PEOPLE).length, 1);
  assert.equal(memoryChangeProblems({ words: 'x'.repeat(5001) }, PEOPLE).length, 1);
  assert.equal(memoryChangeProblems({ audience: { kind: 'person', personId: 'gone' } }, PEOPLE).length, 1);
  assert.deepEqual(memoryChangeProblems({ audience: EVERYONE, leftOut: true, words: 'Fine.' }, PEOPLE), []);

  const memory = syncMemories([], [story('We went to Cornwall.')], PEOPLE, counter()).memories[0]!;
  const corrected = applyMemoryChange(memory, { words: 'We went to Cornwall with Ben.' }, PEOPLE);
  assert.deepEqual(corrected.people, ['b']);
  const back = applyMemoryChange(corrected, { words: 'We went to Cornwall.' }, PEOPLE);
  assert.equal('words' in back, false);
  assert.equal(touched(back), false);
});

test('the store is encrypted on disk and stays quick at 50,000 passages', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'echo-memories-'));
  const key = randomBytes(32);
  assert.deepEqual(loadMemories(dir, key), []);

  const many: Memory[] = Array.from({ length: 50_000 }, (_, index) => ({
    id: `id-${index}`,
    source: { kind: 'story', id: `s-${index % 500}`, title: 'A story' },
    context: '',
    text: `Passage ${index}: ${index === 31_337 ? 'the one about the allotment shed' : 'we talked about the weather and the football and what was for tea that night'}.`,
    date: '2026-11-11T10:00:00.000Z',
    people: ['a'],
    audience: EVERYONE,
    ownAudience: false,
    use: 'memory',
    leftOut: false,
    held: false,
  }));

  const startSave = performance.now();
  saveMemories(dir, key, many);
  const saveMs = performance.now() - startSave;
  const startLoad = performance.now();
  const loaded = loadMemories(dir, key);
  const loadMs = performance.now() - startLoad;
  const startSearch = performance.now();
  const found = loaded.filter((memory) => memory.text.toLowerCase().includes('allotment'));
  const searchMs = performance.now() - startSearch;

  const megabytes = (statSync(path.join(dir, 'memories.sealed')).size / (1024 * 1024)).toFixed(1);
  console.log(`MEMORY STORE AT 50,000 PASSAGES: ${megabytes} MB on disk, save ${Math.round(saveMs)} ms, load ${Math.round(loadMs)} ms, search ${Math.round(searchMs)} ms`);

  assert.equal(loaded.length, 50_000);
  assert.deepEqual(found.map((memory) => memory.id), ['id-31337']);
  assert.ok(saveMs < 5_000 && loadMs < 5_000 && searchMs < 500, 'the memory store is too slow at 50,000 passages');
  assert.ok(!readFileSync(path.join(dir, 'memories.sealed'), 'latin1').includes('allotment'));
  assert.throws(() => loadMemories(dir, randomBytes(32)));
});
