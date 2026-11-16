import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { cryptoSelfCheck, passwordKey, readKeyBag, removeLeftoverCopies, saysItIsEncrypted, unlockBackup, unwrapKey, withDecrypted } from '../src/core/iphone-encrypted.ts';
import { SMS_FILE, backupFilePath, isReadableDatabase, listIphoneThreads, loadContactsFrom, readIphoneThread } from '../src/core/iphone.ts';
import { isPlistUid, readBinaryPlist } from '../src/shared/bplist.ts';
import { Uid, writeBinaryPlist } from './helpers/bplist-writer.ts';
import { attributedBody, makeEncryptedIphoneBackup } from './helpers/iphone-backup.ts';

const T = 1_765_617_300_000;
const OPTIONS = {
  device: "Charles's iPhone",
  contacts: [{ first: 'Ada', last: 'Lovelace', value: '07700 900123' }],
  messages: [
    { chat: '+447700900123', from: '+447700900123', text: 'Morning Dad', at: T },
    { chat: '+447700900123', body: attributedBody('Morning love, how did it go?'), at: T + 60_000 },
  ],
};
const leftovers = () => readdirSync(tmpdir()).filter((name) => name.startsWith('echo-backup-'));

test("Apple's binary property lists are read: every kind of value a backup uses", () => {
  const long = 'x'.repeat(40);
  const plist = readBinaryPlist(
    writeBinaryPlist({ flag: true, off: false, nothing: null, count: 100000, name: 'Ada', accented: 'Babbagé', long, data: Buffer.from([1, 2, 3]), list: [1, 'two', new Uid(2)], inner: { deep: 'yes' } }),
  ) as Record<string, unknown>;
  assert.deepEqual([plist.flag, plist.off, plist.nothing, plist.count, plist.name, plist.accented, plist.long], [true, false, null, 100000, 'Ada', 'Babbagé', long]);
  assert.deepEqual([...(plist.data as Uint8Array)], [1, 2, 3]);
  assert.deepEqual(plist.list, [1, 'two', { UID: 2 }]);
  assert.deepEqual(plist.inner, { deep: 'yes' });
  assert.equal(isPlistUid({ UID: 2 }), true);
  assert.equal(isPlistUid({ UID: 2, other: 1 }), false);
  assert.throws(() => readBinaryPlist(Buffer.from('<?xml version="1.0"?><plist></plist>            ')), /not a property list/);
  assert.throws(() => readBinaryPlist(Buffer.concat([Buffer.from('bplist00'), Buffer.alloc(40, 0xff)])), /damaged/);
});

test('an encrypted backup is unlocked with its password, and with nothing else', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'echo-encrypted-'));
  const folder = makeEncryptedIphoneBackup(root, 'ENC', 'correct horse', OPTIONS);
  assert.equal(isReadableDatabase(backupFilePath(folder, SMS_FILE)!), false); // scrambled as it sits on disk
  assert.equal(saysItIsEncrypted(folder), true);
  assert.equal(saysItIsEncrypted(root), false);

  const wrong = await unlockBackup(folder, 'wrong password');
  assert.ok(!wrong.ok && wrong.wrongPassword === true && wrong.problem.includes('not the password'));

  const unlocked = await unlockBackup(folder, 'correct horse');
  assert.ok(unlocked.ok && unlocked.sms && unlocked.contacts);

  // The messages and contacts are read from a decrypted copy that exists only while they are being read.
  const before = leftovers().length;
  const contacts = withDecrypted(unlocked.contacts, (copy) => loadContactsFrom(copy));
  const { threads, during } = withDecrypted(unlocked.sms, (copy) => {
    assert.equal(isReadableDatabase(copy), true);
    return { threads: listIphoneThreads(copy, contacts), during: leftovers().length };
  });
  assert.deepEqual(threads.map((thread) => [thread.name, thread.messages]), [['Ada Lovelace', 2]]);
  const chat = withDecrypted(unlocked.sms, (copy) => readIphoneThread(copy, '+447700900123', contacts, 'Charles Babbage'));
  assert.deepEqual(chat.messages.map((m) => [m.sender, m.text]), [['Ada Lovelace', 'Morning Dad'], ['Charles Babbage', 'Morning love, how did it go?']]);
  assert.equal(during, before + 1);
  assert.equal(leftovers().length, before); // and it is gone afterwards

  // The copy is deleted even when reading it goes wrong.
  assert.throws(() => withDecrypted(unlocked.sms!, () => { throw new Error('reading failed'); }), /reading failed/);
  assert.equal(leftovers().length, before);
});

test('a backup from before the second round of key stretching is unlocked too', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'echo-encrypted-'));
  const folder = makeEncryptedIphoneBackup(root, 'OLD', 'pass', { ...OPTIONS, oldStyle: true });
  const unlocked = await unlockBackup(folder, 'pass');
  assert.ok(unlocked.ok && unlocked.sms);
  assert.equal((await unlockBackup(folder, 'Pass')).ok, false);
});

test('key unwrapping matches the published test vector, and password stretching matches a known answer', async () => {
  assert.equal(await cryptoSelfCheck(), null);
});

test('the key bag and key unwrapping behave as the format says', async () => {
  const bag = readKeyBag(Buffer.alloc(0));
  assert.deepEqual([bag.iterations, bag.wrappedClassKeys.size], [0, 0]);
  assert.equal(unwrapKey(randomBytes(32), randomBytes(40)), null); // the wrong key is noticed, not silently accepted
  const key = await passwordKey('pw', { salt: Buffer.from('salt'), iterations: 10, firstSalt: Buffer.from('first'), firstIterations: 10, wrappedClassKeys: new Map() });
  assert.equal(key.length, 32);
  assert.notDeepEqual(key, await passwordKey('pw', { salt: Buffer.from('salt'), iterations: 10, firstSalt: null, firstIterations: 0, wrappedClassKeys: new Map() }));
});

test('a folder that is not an encrypted backup is refused in plain words, and leftovers from a crash are cleared', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'echo-encrypted-'));
  const refused = await unlockBackup(root, 'anything');
  assert.ok(!refused.ok && refused.problem.length > 0);

  const stale = mkdtempSync(path.join(tmpdir(), 'echo-backup-'));
  removeLeftoverCopies();
  assert.equal(existsSync(stale), false);
});
