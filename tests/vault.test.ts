import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  VAULT_FILENAME,
  VaultExistsError,
  VaultMissingError,
  WrongPassphraseError,
  clearFailedAttempts,
  createVault,
  failedAttempts,
  purposeKey,
  readVault,
  recordFailedAttempt,
  unlockVault,
} from '../src/core/vault.ts';

// A light work factor so the tests run fast. The app uses DEFAULT_KDF.
const FAST = { N: 2 ** 10, r: 8, p: 1 };
const PASSPHRASE = 'correct horse battery staple';

function emptyFolder(): string {
  return path.join(mkdtempSync(path.join(tmpdir(), 'echo-vault-')), 'Echo Archive');
}

test('the right passphrase opens the archive and gives back the same key', async () => {
  const dir = emptyFolder();
  const created = await createVault(dir, PASSPHRASE, FAST);
  const opened = await unlockVault(dir, PASSPHRASE);
  assert.equal(created.length, 32);
  assert.ok(created.equals(opened));
});

test('a wrong passphrase is refused', async () => {
  const dir = emptyFolder();
  await createVault(dir, PASSPHRASE, FAST);
  await assert.rejects(unlockVault(dir, 'correct horse battery stable'), WrongPassphraseError);
});

test('the key is never written to disk in the clear', async () => {
  const dir = emptyFolder();
  const key = await createVault(dir, PASSPHRASE, FAST);
  const onDisk = readFileSync(path.join(dir, VAULT_FILENAME), 'utf8');
  assert.ok(!onDisk.includes(key.toString('base64')));
  assert.ok(!onDisk.includes(key.toString('hex')));
  assert.ok(!onDisk.includes(PASSPHRASE));
});

test('creating an archive where one already exists is refused', async () => {
  const dir = emptyFolder();
  await createVault(dir, PASSPHRASE, FAST);
  await assert.rejects(createVault(dir, 'another passphrase entirely', FAST), VaultExistsError);
});

test('unlocking a folder with no archive says so', async () => {
  await assert.rejects(unlockVault(emptyFolder(), PASSPHRASE), VaultMissingError);
});

test('a tampered key slot does not open, even with the right passphrase', async () => {
  const dir = emptyFolder();
  await createVault(dir, PASSPHRASE, FAST);
  const file = path.join(dir, VAULT_FILENAME);
  const vault = readVault(dir);
  assert.ok(vault);
  const wrapped = Buffer.from(vault.slots[0]!.wrappedKey, 'base64');
  wrapped[0] = wrapped[0]! ^ 0xff;
  vault.slots[0]!.wrappedKey = wrapped.toString('base64');
  writeFileSync(file, JSON.stringify(vault), 'utf8');
  await assert.rejects(unlockVault(dir, PASSPHRASE), WrongPassphraseError);
});

test('two archives with the same passphrase get different keys', async () => {
  const a = await createVault(emptyFolder(), PASSPHRASE, FAST);
  const b = await createVault(emptyFolder(), PASSPHRASE, FAST);
  assert.ok(!a.equals(b));
});

test('purpose keys differ from each other and from the master key', async () => {
  const key = await createVault(emptyFolder(), PASSPHRASE, FAST);
  const audit = purposeKey(key, 'echo/audit/v1');
  const other = purposeKey(key, 'echo/other/v1');
  assert.ok(!audit.equals(other));
  assert.ok(!audit.equals(key));
  assert.ok(audit.equals(purposeKey(key, 'echo/audit/v1')));
});

test('failed unlock attempts are counted and can be cleared', async () => {
  const dir = emptyFolder();
  await createVault(dir, PASSPHRASE, FAST);
  assert.equal(failedAttempts(dir), 0);
  recordFailedAttempt(dir);
  assert.equal(recordFailedAttempt(dir), 2);
  assert.equal(failedAttempts(dir), 2);
  clearFailedAttempts(dir);
  assert.equal(failedAttempts(dir), 0);
});
