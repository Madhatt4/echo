import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { appendAudit, readAudit } from '../src/core/audit.ts';
import { backupArchive, backupDirIn, backupLocationProblems, checkBackup, restoreArchive } from '../src/core/backup.ts';
import { readMedia, writeMedia } from '../src/core/media.ts';
import { addPerson, loadPeople } from '../src/core/people.ts';
import { createVault, unlockVault } from '../src/core/vault.ts';

const FAST = { N: 2 ** 10, r: 8, p: 1 };
const PASSPHRASE = 'correct horse battery staple';

async function setup(): Promise<{ root: string; archive: string; drive: string; backup: string; key: Buffer; mediaId: string }> {
  const root = mkdtempSync(path.join(tmpdir(), 'echo-backup-'));
  const archive = path.join(root, 'pc', 'Echo Archive');
  const drive = path.join(root, 'drive');
  mkdirSync(drive, { recursive: true });
  const key = await createVault(archive, PASSPHRASE, FAST);
  appendAudit(archive, key, 'archive.created');
  addPerson(archive, key, { name: 'Ada', relationship: 'daughter', callsMe: 'Dad', mayTalkToEcho: true });
  const mediaId = writeMedia(archive, key, randomBytes(50_000));
  return { root, archive, drive, backup: backupDirIn(drive), key, mediaId };
}

test('a first backup copies everything, and the copy checks out', async () => {
  const { archive, backup } = await setup();
  const summary = await backupArchive(archive, backup);
  assert.ok(summary.files >= 4);
  assert.equal(summary.copied, summary.files);
  const check = await checkBackup(archive, backup);
  assert.deepEqual([check.ok, check.missing, check.different], [true, [], []]);
});

test('a second backup with nothing changed copies nothing; a change copies only what changed', async () => {
  const { archive, backup, key } = await setup();
  await backupArchive(archive, backup);
  assert.equal((await backupArchive(archive, backup)).copied, 0);
  addPerson(archive, key, { name: 'Ben', relationship: 'son', callsMe: 'Dad', mayTalkToEcho: true });
  assert.equal((await backupArchive(archive, backup)).copied, 1);
  assert.equal((await checkBackup(archive, backup)).ok, true);
});

test('the backup opens with the same passphrase and holds the same things', async () => {
  const { archive, backup, mediaId, key } = await setup();
  await backupArchive(archive, backup);
  const fromBackup = await unlockVault(backup, PASSPHRASE);
  assert.ok(fromBackup.equals(key));
  assert.deepEqual(loadPeople(backup, fromBackup).map((p) => p.name), ['Ada']);
  assert.ok(readMedia(backup, fromBackup, mediaId).equals(readMedia(archive, key, mediaId)));
  assert.equal(readAudit(backup, fromBackup).intact, true);
});

test('a damaged file on the PC does not wipe out the last good copy', async () => {
  const { archive, backup } = await setup();
  await backupArchive(archive, backup);
  const good = readFileSync(path.join(backup, 'people.sealed'), 'utf8');
  writeFileSync(path.join(archive, 'people.sealed'), 'damaged', 'utf8');
  await backupArchive(archive, backup);
  assert.equal(readFileSync(path.join(backup, 'people.sealed.previous'), 'utf8'), good);
});

test('the check notices a missing copy and a copy that does not match', async () => {
  const { archive, backup } = await setup();
  await backupArchive(archive, backup);
  rmSync(path.join(backup, 'audit.log'));
  writeFileSync(path.join(backup, 'people.sealed'), 'tampered', 'utf8');
  const check = await checkBackup(archive, backup);
  assert.equal(check.ok, false);
  assert.deepEqual(check.missing, ['audit.log']);
  assert.deepEqual(check.different, ['people.sealed']);
});

test('restoring gives back a working archive, and will not overwrite anything', async () => {
  const { root, archive, backup, mediaId, key } = await setup();
  await backupArchive(archive, backup);
  const restored = path.join(root, 'new-pc', 'Echo Archive');
  assert.ok((await restoreArchive(backup, restored)) >= 4);
  const restoredKey = await unlockVault(restored, PASSPHRASE);
  assert.deepEqual(loadPeople(restored, restoredKey).map((p) => p.name), ['Ada']);
  assert.ok(readMedia(restored, restoredKey, mediaId).equals(readMedia(archive, key, mediaId)));
  assert.equal(existsSync(path.join(restored, 'backup-info.json')), false);
  await assert.rejects(restoreArchive(backup, restored), /already has files/);
  await assert.rejects(restoreArchive(path.join(root, 'nothing-here'), path.join(root, 'x')), /no Echo backup/);
});

test('one backup folder cannot be shared by two archives', async () => {
  const { archive, backup } = await setup();
  await backupArchive(archive, backup);
  const other = await setup();
  await assert.rejects(backupArchive(other.archive, backup), /different archive/);
});

test('the backup must be somewhere other than the archive, and on another drive', async () => {
  const { archive, drive } = await setup();
  assert.equal(backupLocationProblems(archive, '').length, 1);
  assert.equal(backupLocationProblems(archive, path.join(drive, 'not-there')).length, 1);
  assert.equal(backupLocationProblems(archive, archive, true).length, 1);
  assert.equal(backupLocationProblems(archive, drive).length, 1); // same drive in this test
  assert.deepEqual(backupLocationProblems(archive, drive, true), []);
});
