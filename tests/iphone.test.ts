import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { SMS_FILE, backupFileName, backupFilePath, findBackups, isReadableDatabase, listIphoneThreads, loadContacts, readIphoneThread } from '../src/core/iphone.ts';
import { comparableHandle, messageWords, textFromAttributedBody } from '../src/shared/iphone.ts';
import { localStamp } from '../src/shared/messenger.ts';
import { attributedBody, makeIphoneBackup } from './helpers/iphone-backup.ts';

const T = 1_765_617_300_000;
const ADA = '+44 7700 900123';
const MESSAGES = [
  { chat: '+447700900123', from: '+447700900123', text: 'Morning Dad', at: T },
  { chat: '+447700900123', body: attributedBody('Morning love — how did it go? 🙂'), at: T + 60_000 },
  { chat: '+447700900123', from: '+447700900123', text: '￼', at: T + 90_000 }, // a photo
  { chat: '+447700900123', from: '+447700900123', text: 'Loved “Morning love”', at: T + 100_000, reaction: 2000 },
  { chat: '+447700900123', text: 'Ring me later', at: T + 120_000 },
  { chat: 'chat123456', from: 'vera@example.com', text: 'Who has the key?', at: T + 200_000 },
];

test('the messages database is found by the name Apple gives it, in a new or an old backup', () => {
  assert.equal(backupFileName(SMS_FILE), '3d0d7e5fb2ce288813306e4d4636395e047a3d28');
  const root = mkdtempSync(path.join(tmpdir(), 'echo-iphone-'));
  const sorted = makeIphoneBackup(root, 'new', { messages: MESSAGES });
  const flat = makeIphoneBackup(root, 'old', { messages: MESSAGES, flat: true });
  assert.equal(backupFilePath(sorted, SMS_FILE), path.join(sorted, '3d', '3d0d7e5fb2ce288813306e4d4636395e047a3d28'));
  assert.equal(backupFilePath(flat, SMS_FILE), path.join(flat, '3d0d7e5fb2ce288813306e4d4636395e047a3d28'));
  assert.equal(backupFilePath(root, SMS_FILE), null);
  assert.equal(isReadableDatabase(backupFilePath(sorted, SMS_FILE)!), true);
  writeFileSync(path.join(root, 'scrambled'), Buffer.alloc(4096, 0x5a));
  assert.equal(isReadableDatabase(path.join(root, 'scrambled')), false);
});

test('backups on the computer are listed with the phone they came from, and a missing folder is skipped', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'echo-iphone-'));
  makeIphoneBackup(root, '00008030-A', { messages: MESSAGES, device: "Charles's iPhone" });
  writeFileSync(path.join(root, 'not-a-backup.txt'), 'x');
  const found = findBackups([path.join(root, 'nowhere'), root]);
  assert.deepEqual(found.map((backup) => [path.basename(backup.folder), backup.device, backup.madeAt]), [['00008030-A', "Charles's iPhone", '2026-11-10T08:00:00Z']]);
});

test('the words are read from the packed block newer iPhones use', () => {
  assert.equal(textFromAttributedBody(attributedBody('Morning love — how did it go? 🙂')), 'Morning love — how did it go? 🙂');
  const long = 'A long message. '.repeat(30);
  assert.equal(textFromAttributedBody(attributedBody(long)), long);
  assert.equal(textFromAttributedBody(Buffer.from('nothing like it')), null);
  assert.equal(messageWords('Plain text wins', attributedBody('not this')), 'Plain text wins');
  assert.equal(messageWords(null, attributedBody('  From the block  ')), 'From the block');
  assert.equal(messageWords('￼', null), '');
  assert.equal(messageWords(null, null), '');
});

test('a phone number matches its contact however it was typed', () => {
  assert.equal(comparableHandle('+44 7700 900123'), comparableHandle('07700 900123'));
  assert.equal(comparableHandle('+447700900123'), '700900123');
  assert.equal(comparableHandle(' Vera@Example.com '), 'vera@example.com');
  assert.equal(comparableHandle('60123'), '60123');
});

test('conversations are listed with names from the contacts, and one is read oldest first', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'echo-iphone-'));
  const backup = makeIphoneBackup(root, 'b', { messages: MESSAGES, contacts: [{ first: 'Ada', last: 'Lovelace', value: ADA }], groupNames: { chat123456: 'Garden Club' } });
  const sms = backupFilePath(backup, SMS_FILE)!;
  const contacts = loadContacts(backup);
  assert.equal(contacts.get(comparableHandle('07700 900123')), 'Ada Lovelace');

  const threads = listIphoneThreads(sms, contacts);
  assert.deepEqual(threads.map((thread) => [thread.key, thread.name, thread.messages]), [['+447700900123', 'Ada Lovelace', 5], ['chat123456', 'Garden Club', 1]]);
  assert.equal(listIphoneThreads(backupFilePath(makeIphoneBackup(root, 'unnamed-group', { messages: MESSAGES }), SMS_FILE)!, new Map())[1]!.name, 'Group chat (chat123456)');

  const chat = readIphoneThread(sms, '+447700900123', contacts, 'Charles Babbage');
  assert.deepEqual(chat.messages, [
    { at: localStamp(T), sender: 'Ada Lovelace', text: 'Morning Dad' },
    { at: localStamp(T + 60_000), sender: 'Charles Babbage', text: 'Morning love — how did it go? 🙂' },
    { at: localStamp(T + 120_000), sender: 'Charles Babbage', text: 'Ring me later' },
  ]);
  assert.deepEqual([chat.media, chat.notices], [1, 1]); // the photo, and the tapback
  assert.deepEqual(chat.senders, [{ name: 'Charles Babbage', count: 2 }, { name: 'Ada Lovelace', count: 1 }]);
  assert.equal(chat.owner, 'Charles Babbage');
  // If the owner is given the same name as the other person, the owner is marked so the two stay apart.
  const sameName = readIphoneThread(sms, '+447700900123', contacts, 'Ada Lovelace');
  assert.equal(sameName.owner, 'Ada Lovelace (this iPhone)');
  assert.deepEqual(sameName.messages.map((m) => m.sender), ['Ada Lovelace', 'Ada Lovelace (this iPhone)', 'Ada Lovelace (this iPhone)']);

  // With no contacts in the backup, people are shown by number.
  const bare = makeIphoneBackup(root, 'no-contacts', { messages: MESSAGES });
  assert.equal(loadContacts(bare).size, 0);
  assert.equal(listIphoneThreads(backupFilePath(bare, SMS_FILE)!, new Map())[0]!.name, '+447700900123');
  assert.equal(readIphoneThread(backupFilePath(bare, SMS_FILE)!, 'chat123456', new Map(), 'Me').messages[0]!.sender, 'vera@example.com');
});
