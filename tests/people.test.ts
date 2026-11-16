import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { addPerson, changePerson, loadPeople, removePerson } from '../src/core/people.ts';
import { EVERYONE, audienceLabel, mayHear, onlyWhatTheyMayHear, personProblems } from '../src/shared/people.ts';
import type { Audience, Person } from '../src/shared/people.ts';

const details = (name: string, extra: Partial<Person> = {}) => ({
  name,
  relationship: 'daughter',
  callsMe: 'Dad',
  mayTalkToEcho: true,
  ...extra,
});

function setup(): { dir: string; key: Buffer } {
  return { dir: mkdtempSync(path.join(tmpdir(), 'echo-people-')), key: randomBytes(32) };
}

test('people can be added, changed and removed, and survive being read back', () => {
  const { dir, key } = setup();
  assert.deepEqual(loadPeople(dir, key), []);
  const ada = addPerson(dir, key, details('  Ada  '));
  const ben = addPerson(dir, key, details('Ben', { relationship: 'son' }));
  assert.equal(ada.name, 'Ada');
  assert.notEqual(ada.id, ben.id);
  assert.deepEqual(loadPeople(dir, key).map((p) => p.name), ['Ada', 'Ben']);

  assert.equal(changePerson(dir, key, ada.id, details('Ada', { callsMe: 'Pops' })), true);
  assert.equal(loadPeople(dir, key)[0]!.callsMe, 'Pops');
  assert.equal(loadPeople(dir, key)[0]!.id, ada.id);

  assert.equal(removePerson(dir, key, ben.id), true);
  assert.deepEqual(loadPeople(dir, key).map((p) => p.name), ['Ada']);
  assert.equal(removePerson(dir, key, ben.id), false);
  assert.equal(changePerson(dir, key, 'no-such-id', details('X')), false);
});

test('names are never readable on disk', () => {
  const { dir, key } = setup();
  addPerson(dir, key, details('Recognisable Name'));
  assert.ok(!readFileSync(path.join(dir, 'people.sealed'), 'utf8').includes('Recognisable'));
});

test('a name is required, and two people cannot share one', () => {
  const { dir, key } = setup();
  const ada = addPerson(dir, key, details('Ada'));
  assert.equal(personProblems(details(''), []).length, 1);
  assert.equal(personProblems(details('ada '), [ada]).length, 1);
  assert.deepEqual(personProblems(details('Ada B'), [ada]), []);
});

const person = (id: string, name: string): Person => ({ id, ...details(name), addedAt: '2026-11-11T00:00:00.000Z' });
const ADA = person('a', 'Ada');
const BEN = person('b', 'Ben');
const forAda: Audience = { kind: 'person', personId: 'a' };

test('something for everyone reaches every person in the list, and nobody outside it', () => {
  assert.equal(mayHear(EVERYONE, 'a', [ADA, BEN]), true);
  assert.equal(mayHear(EVERYONE, 'b', [ADA, BEN]), true);
  assert.equal(mayHear(EVERYONE, 'stranger', [ADA, BEN]), false);
  assert.equal(mayHear(EVERYONE, 'a', []), false);
});

test('something for one person reaches that person only', () => {
  assert.equal(mayHear(forAda, 'a', [ADA, BEN]), true);
  assert.equal(mayHear(forAda, 'b', [ADA, BEN]), false);
  assert.equal(mayHear(forAda, 'stranger', [ADA, BEN]), false);
});

test('if the person it was for is removed, it reaches nobody, and never falls back to everyone', () => {
  assert.equal(mayHear(forAda, 'b', [BEN]), false);
  assert.equal(mayHear(forAda, 'a', [BEN]), false);
  assert.equal(audienceLabel(forAda, [BEN]).startsWith('Nobody'), true);
});

test('filtering a list keeps order and drops only what the listener may not hear', () => {
  const items = [
    { text: 'for all', audience: EVERYONE },
    { text: 'for Ada', audience: forAda },
    { text: 'for Ben', audience: { kind: 'person', personId: 'b' } as Audience },
    { text: 'also for all', audience: EVERYONE },
  ];
  assert.deepEqual(onlyWhatTheyMayHear(items, 'a', [ADA, BEN]).map((i) => i.text), ['for all', 'for Ada', 'also for all']);
  assert.deepEqual(onlyWhatTheyMayHear(items, 'b', [ADA, BEN]).map((i) => i.text), ['for all', 'for Ben', 'also for all']);
  assert.deepEqual(onlyWhatTheyMayHear(items, 'stranger', [ADA, BEN]), []);
});

test('labels say who something is for', () => {
  assert.equal(audienceLabel(EVERYONE, [ADA]), 'Everyone');
  assert.equal(audienceLabel(forAda, [ADA]), 'Only Ada');
});
