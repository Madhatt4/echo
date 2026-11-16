import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { loadSheet, saveSheet } from '../src/core/sheets.ts';
import type { Memory } from '../src/shared/memories.ts';
import { EVERYONE } from '../src/shared/people.ts';
import type { Audience, Person } from '../src/shared/people.ts';
import {
  EMPTY_SHEET,
  SHEET_SECTIONS,
  draftInstructions,
  draftMessage,
  lineProblems,
  measureStyle,
  mergeDraft,
  passagesForEveryone,
  passagesForPerson,
  readDraft,
  viewLines,
  withinBudget,
} from '../src/shared/sheets.ts';
import type { Sheet, SheetLine } from '../src/shared/sheets.ts';

const ADA: Person = { id: 'a', name: 'Ada', relationship: 'daughter', callsMe: 'Dad', mayTalkToEcho: true, addedAt: '2026-11-11T00:00:00.000Z' };
const FOR_ADA: Audience = { kind: 'person', personId: 'a' };
const memory = (id: string, text: string, more: Partial<Memory> = {}): Memory => ({
  id,
  source: { kind: 'interview', id: `src-${id}`, title: 'Work' },
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
const line = (id: string, text: string, more: Partial<SheetLine> = {}): SheetLine => ({ id, section: 'values', text, evidence: ['m1'], audience: EVERYONE, origin: 'drafted', checked: false, ...more });
const counter = () => {
  let next = 0;
  return () => `l${(next += 1)}`;
};

test('the two documents have their sections, and only the style profile has one about each person', () => {
  assert.deepEqual(SHEET_SECTIONS.character.map((s) => s.id), ['values', 'beliefs', 'humour', 'temperament', 'never']);
  assert.deepEqual(SHEET_SECTIONS.style.map((s) => s.id), ['voice', 'phrases', 'greetings', 'people']);
});

test('general drafts are made only from passages meant for everyone and in use', () => {
  const all = [
    memory('m1', 'for everyone'),
    memory('m2', 'for Ada alone', { audience: FOR_ADA }),
    memory('m3', 'left out', { leftOut: true }),
    memory('m4', 'held back', { held: true }),
    memory('m5', 'kept for the day', { audience: FOR_ADA, use: 'advice-on-the-day' }),
  ];
  assert.deepEqual(passagesForEveryone(all).map((m) => m.id), ['m1']);
  assert.deepEqual(passagesForPerson(all, 'a').map((m) => m.id), ['m2']);
  assert.deepEqual(passagesForPerson(all, 'b'), []);
});

test('only as many passages as fit are sent, newest first', () => {
  const all = [memory('old', 'x'.repeat(500), { date: '2020-01-01T00:00:00.000Z' }), memory('new', 'y'.repeat(500), { date: '2026-01-01T00:00:00.000Z' })];
  assert.deepEqual(withinBudget(all, 700).map((m) => m.id), ['new']);
  assert.deepEqual(withinBudget(all, 5000).map((m) => m.id), ['new', 'old']);
});

test('Claude is told to rest every line on passages, and what the person struck out', () => {
  const general = draftInstructions('character', 'Ada Lovelace', null);
  assert.ok(general.includes('Ada Lovelace') && general.includes('"values"') && general.includes('"never"'));
  assert.ok(general.includes('A line with no passage behind it must not be written'));
  assert.ok(!general.includes('"people"'));
  assert.ok(!draftInstructions('style', 'Ada Lovelace', null).includes('"people"'));
  const personal = draftInstructions('style', 'Charles', ADA);
  assert.ok(personal.includes('"people"') && personal.includes('Ada (daughter)') && !personal.includes('"voice"'));

  const message = draftMessage([memory('m1', 'I drove lorries.', { context: 'What was your first job?' }), memory('m2', 'corrected', { words: 'I never lie.' })], ['I love golf.'], measureStyle(['One two three. Four five!']));
  assert.ok(message.includes('[1] (interview: Work; they were asked: What was your first job?)\nI drove lorries.'));
  assert.ok(message.includes('[2] (interview: Work)\nI never lie.')); // the corrected wording is what is sent
  assert.ok(message.includes('NOT them') && message.includes('- I love golf.'));
  assert.ok(message.includes('5 words in 2 sentences, 2.5 words to a sentence'));
});

test('a draft is read strictly: no passage behind a line, no line', () => {
  const reply = `Here you go:\n${JSON.stringify({
    lines: [
      { section: 'values', text: '  I say what   I think. ', passages: [1, 2, 2] },
      { section: 'values', text: 'No passage behind this.', passages: [] },
      { section: 'values', text: 'Cites a passage that was never sent.', passages: [9] },
      { section: 'people', text: 'Not a section of this draft.', passages: [1] },
      { section: 'humour', text: 'x'.repeat(401), passages: [1] },
      { section: 'humour', text: '', passages: [1] },
      'nonsense',
    ],
  })}`;
  assert.deepEqual(readDraft(reply, ['values', 'humour'], 2), [{ section: 'values', text: 'I say what I think.', passages: [0, 1] }]);
  assert.equal(readDraft('I could not do that.', ['values'], 2), null);
  assert.equal(readDraft('{"lines": "none"}', ['values'], 2), null);
  const many = JSON.stringify({ lines: Array.from({ length: 14 }, (_, i) => ({ section: 'values', text: `Line ${i}`, passages: [1] })) });
  assert.equal(readDraft(many, ['values'], 1)!.length, 10);
});

test('a new draft keeps what the person wrote or confirmed, and never brings back what they struck out', () => {
  const sheet: Sheet = {
    ...EMPTY_SHEET,
    rejected: ['I love golf.'],
    lines: [
      line('mine', 'I keep my word.', { origin: 'yours', checked: true, evidence: [] }),
      line('confirmed', 'I hate waste.', { checked: true }),
      line('unconfirmed', 'I am patient.'),
      line('for-ada', 'I call her kiddo.', { section: 'people', audience: FOR_ADA }),
    ],
  };
  const drafted = [
    { section: 'values', text: 'I keep my word', evidence: ['m2'], audience: EVERYONE }, // repeats a kept line
    { section: 'values', text: 'I LOVE golf', evidence: ['m2'], audience: EVERYONE }, // struck out before
    { section: 'humour', text: 'I laugh at myself first.', evidence: ['m2'], audience: EVERYONE },
  ];
  const merged = mergeDraft(sheet, drafted, EVERYONE, counter());
  assert.deepEqual(merged.map((l) => l.text), ['I keep my word.', 'I hate waste.', 'I call her kiddo.', 'I laugh at myself first.']);
  assert.deepEqual(merged.at(-1), { id: 'l1', section: 'humour', text: 'I laugh at myself first.', evidence: ['m2'], audience: EVERYONE, origin: 'drafted', checked: false });

  // A draft about Ada replaces only the unconfirmed lines about Ada.
  const aboutAda = mergeDraft(sheet, [{ section: 'people', text: 'I tease her about her driving.', evidence: ['m3'], audience: FOR_ADA }], FOR_ADA, counter());
  assert.deepEqual(aboutAda.map((l) => l.text), ['I keep my word.', 'I hate waste.', 'I am patient.', 'I tease her about her driving.']);
});

test('a drafted line is only in use while a passage still stands behind it', () => {
  const memories = [memory('m1', 'I say what I think.'), memory('m2', 'private to Ada', { audience: FOR_ADA }), memory('m3', 'left out', { leftOut: true })];
  const [supported, lostSupport, privateBehindGeneral, forAda, mine, confirmed] = viewLines(
    [
      line('1', 'supported'),
      line('2', 'its passage was left out', { evidence: ['m3', 'gone'] }),
      line('3', 'a general line cannot rest on a private passage', { evidence: ['m2'] }),
      line('4', 'about Ada', { section: 'people', audience: FOR_ADA, evidence: ['m2', 'm1'] }),
      line('5', 'written by the person', { origin: 'yours', checked: true, evidence: [] }),
      line('6', 'confirmed by the person, passage since removed', { checked: true, evidence: ['gone'] }),
    ],
    memories,
  );
  assert.deepEqual([supported!.inUse, supported!.support.map((s) => s.memoryId)], [true, ['m1']]);
  assert.deepEqual([lostSupport!.inUse, lostSupport!.support], [false, []]);
  assert.equal(privateBehindGeneral!.inUse, false);
  assert.deepEqual([forAda!.inUse, forAda!.support.map((s) => s.memoryId)], [true, ['m2', 'm1']]);
  assert.equal(mine!.inUse, true);
  assert.equal(confirmed!.inUse, true);
});

test('sentence length is measured from the words, and a line must have words', () => {
  assert.deepEqual(measureStyle([]), { words: 0, sentences: 0, averageSentenceWords: 0 });
  assert.deepEqual(measureStyle(['I drove lorries. For thirty years!', 'Why?\nBecause I liked it']), { words: 11, sentences: 4, averageSentenceWords: 2.8 });
  assert.equal(lineProblems('  ').length, 1);
  assert.equal(lineProblems('x'.repeat(401)).length, 1);
  assert.deepEqual(lineProblems('I keep my word.'), []);
});

test('each document is its own encrypted file', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'echo-sheets-'));
  const key = randomBytes(32);
  assert.deepEqual(loadSheet(dir, key, 'character'), EMPTY_SHEET);
  saveSheet(dir, key, 'character', { ...EMPTY_SHEET, lines: [line('1', 'a recognisable character line')] });
  saveSheet(dir, key, 'style', { ...EMPTY_SHEET, lines: [line('2', 'a recognisable style line', { section: 'voice' })] });
  assert.equal(loadSheet(dir, key, 'character').lines[0]!.text, 'a recognisable character line');
  assert.equal(loadSheet(dir, key, 'style').lines[0]!.text, 'a recognisable style line');
  assert.ok(!readFileSync(path.join(dir, 'character.sealed'), 'latin1').includes('recognisable'));
  assert.throws(() => loadSheet(dir, randomBytes(32), 'style'));
});
