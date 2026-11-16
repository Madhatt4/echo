import { test } from 'node:test';
import assert from 'node:assert/strict';
import { passphraseProblems } from '../src/shared/passphrase.ts';

test('a long passphrase typed the same twice is accepted', () => {
  assert.deepEqual(passphraseProblems('correct horse battery staple', 'correct horse battery staple'), []);
});

test('a short passphrase is refused', () => {
  assert.equal(passphraseProblems('short', 'short').length, 1);
});

test('a long but trivially repeated passphrase is refused', () => {
  assert.equal(passphraseProblems('aaaaaaaaaaaaaaaa', 'aaaaaaaaaaaaaaaa').length, 1);
});

test('a mismatch between the two entries is reported', () => {
  const problems = passphraseProblems('correct horse battery staple', 'correct horse battery stable');
  assert.deepEqual(problems, ['The two passphrases do not match.']);
});

test('a stray space at either end is reported', () => {
  assert.equal(passphraseProblems(' correct horse battery staple', ' correct horse battery staple').length, 1);
});
