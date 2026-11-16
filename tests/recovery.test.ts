import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  WrongPassphraseError,
  WrongRecoveryCodeError,
  createVault,
  generateRecoveryCode,
  hasRecoveryKit,
  setPassphrase,
  setRecoveryCode,
  unlockVault,
  unlockVaultWithRecoveryCode,
} from '../src/core/vault.ts';
import {
  RECOVERY_ALPHABET,
  formatRecoveryCode,
  normaliseGroup,
  normaliseRecoveryCode,
  recoveryGroups,
} from '../src/shared/recovery-code.ts';

const FAST = { N: 2 ** 10, r: 8, p: 1 };
const PASSPHRASE = 'correct horse battery staple';

async function archive(): Promise<{ dir: string; key: Buffer }> {
  const dir = path.join(mkdtempSync(path.join(tmpdir(), 'echo-recovery-')), 'Echo Archive');
  return { dir, key: await createVault(dir, PASSPHRASE, FAST) };
}

test('a generated code is 24 characters from the safe alphabet, and never the same twice', () => {
  const a = generateRecoveryCode();
  const b = generateRecoveryCode();
  assert.equal(a.length, 24);
  assert.ok([...a].every((c) => RECOVERY_ALPHABET.includes(c)));
  assert.notEqual(a, b);
  assert.equal(normaliseRecoveryCode(a), a);
});

test('the printed form splits into six groups of four', () => {
  const code = '0123456789ABCDEFGHJKMNPQ';
  assert.deepEqual(recoveryGroups(code), ['0123', '4567', '89AB', 'CDEF', 'GHJK', 'MNPQ']);
  assert.equal(formatRecoveryCode(code), '0123-4567-89AB-CDEF-GHJK-MNPQ');
});

test('typing is forgiven: case, spaces, dashes and look-alike letters', () => {
  assert.equal(normaliseRecoveryCode('o1i2-l3ab cdef ghjk mnpq rstv'), '011213ABCDEFGHJKMNPQRSTV');
  assert.equal(normaliseGroup(' ab-c0 '), 'ABC0');
});

test('incomplete or invalid codes are rejected', () => {
  assert.equal(normaliseRecoveryCode('0123-4567'), null);
  assert.equal(normaliseRecoveryCode('U'.repeat(24)), null); // U is not in the alphabet
  assert.equal(normaliseGroup('ABC'), null);
});

test('a new archive has no recovery kit until one is made', async () => {
  const { dir, key } = await archive();
  assert.equal(hasRecoveryKit(dir), false);
  await setRecoveryCode(dir, key, generateRecoveryCode(), FAST);
  assert.equal(hasRecoveryKit(dir), true);
});

test('the recovery code opens the archive and gives the same key as the passphrase', async () => {
  const { dir, key } = await archive();
  const code = generateRecoveryCode();
  await setRecoveryCode(dir, key, code, FAST);
  assert.ok((await unlockVaultWithRecoveryCode(dir, formatRecoveryCode(code).toLowerCase())).equals(key));
  assert.ok((await unlockVault(dir, PASSPHRASE)).equals(key));
});

test('a wrong recovery code is refused, and so is any code before a kit exists', async () => {
  const { dir, key } = await archive();
  await assert.rejects(unlockVaultWithRecoveryCode(dir, generateRecoveryCode()), WrongRecoveryCodeError);
  await setRecoveryCode(dir, key, generateRecoveryCode(), FAST);
  await assert.rejects(unlockVaultWithRecoveryCode(dir, generateRecoveryCode()), WrongRecoveryCodeError);
  await assert.rejects(unlockVaultWithRecoveryCode(dir, 'not a code'), WrongRecoveryCodeError);
});

test('the passphrase does not work as a recovery code, nor the code as a passphrase', async () => {
  const { dir, key } = await archive();
  const code = generateRecoveryCode();
  await setRecoveryCode(dir, key, code, FAST);
  await assert.rejects(unlockVault(dir, code), WrongPassphraseError);
  await assert.rejects(unlockVaultWithRecoveryCode(dir, PASSPHRASE), WrongRecoveryCodeError);
});

test('making a new kit stops the old code working', async () => {
  const { dir, key } = await archive();
  const first = generateRecoveryCode();
  const second = generateRecoveryCode();
  await setRecoveryCode(dir, key, first, FAST);
  await setRecoveryCode(dir, key, second, FAST);
  await assert.rejects(unlockVaultWithRecoveryCode(dir, first), WrongRecoveryCodeError);
  assert.ok((await unlockVaultWithRecoveryCode(dir, second)).equals(key));
});

test('changing the passphrase stops the old one, keeps the key, and keeps the recovery code', async () => {
  const { dir, key } = await archive();
  const code = generateRecoveryCode();
  await setRecoveryCode(dir, key, code, FAST);
  await setPassphrase(dir, key, 'a brand new passphrase', FAST);
  await assert.rejects(unlockVault(dir, PASSPHRASE), WrongPassphraseError);
  assert.ok((await unlockVault(dir, 'a brand new passphrase')).equals(key));
  assert.ok((await unlockVaultWithRecoveryCode(dir, code)).equals(key));
});
