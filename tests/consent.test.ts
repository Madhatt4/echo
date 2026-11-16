import { test } from 'node:test';
import assert from 'node:assert/strict';
import { consentWording, nameProblems, spokenDate } from '../src/shared/consent.ts';

test('the statement carries the person\'s own name and the date, and every promise in the spec', () => {
  const text = consentWording('  Ada Lovelace ', new Date(2026, 10, 11));
  assert.ok(text.startsWith('I, Ada Lovelace, on 11 November 2026, am creating an AI echo of myself.'));
  for (const promise of [
    'my face, my voice and my personality',
    'my named family members can talk to after my death',
    'always be presented as an AI echo and never as me being alive',
    'withdraw this consent at any time while I am alive',
    'my nominated heir can pause or delete it',
  ]) {
    assert.ok(text.includes(promise), promise);
  }
});

test('the date is written the way it is said', () => {
  assert.equal(spokenDate(new Date(2027, 0, 3)), '3 January 2027');
});

test('a name is required', () => {
  assert.equal(nameProblems('').length, 1);
  assert.equal(nameProblems(' A ').length, 1);
  assert.deepEqual(nameProblems('Ada Lovelace'), []);
});
