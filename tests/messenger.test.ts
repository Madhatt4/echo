import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { namesInZip, readManyFromZip } from '../src/core/zip.ts';
import { findThreads, localStamp, mergeMessengerFiles, readMessengerFile, repairText } from '../src/shared/messenger.ts';
import { makeZip } from './helpers/zip.ts';

/** Writes text the broken way older exports do: each UTF-8 byte as a character of its own. */
const broken = (text: string) => Buffer.from(text, 'utf8').toString('latin1');

const T = 1_765_617_300_000; // one moment in December 2025, in milliseconds
const STANDARD = {
  participants: [{ name: 'Ada Lovelace' }, { name: broken('Charles Babbagé') }],
  messages: [
    { sender_name: broken('Charles Babbagé'), timestamp_ms: T + 120_000, content: broken('Proud of you — always was 🙂'), type: 'Generic' },
    { sender_name: 'Ada Lovelace', timestamp_ms: T + 60_000, photos: [{ uri: 'messages/inbox/ada/photos/1.jpg' }], type: 'Generic' },
    { sender_name: 'Ada Lovelace', timestamp_ms: T + 50_000, content: 'Ada Lovelace sent an attachment.', type: 'Share' },
    { sender_name: 'Ada Lovelace', timestamp_ms: T + 40_000, content: 'Ada missed your call.', type: 'Call' },
    { sender_name: 'Ada Lovelace', timestamp_ms: T + 30_000, content: 'unsent', is_unsent: true, type: 'Generic' },
    { sender_name: 'Ada Lovelace', timestamp_ms: T, content: 'Morning Dad', type: 'Generic' },
  ],
  title: 'Ada Lovelace',
  thread_path: 'inbox/adalovelace_1015812345',
};
const ENCRYPTED = {
  participants: ['Ada Lovelace', 'Charles Babbage'],
  threadName: 'Ada Lovelace_12',
  messages: [
    { isUnsent: false, media: [], reactions: [], senderName: 'Ada Lovelace', text: 'Are you up?', timestamp: T + 200_000, type: 'text' },
    { isUnsent: false, media: [{ uri: './media/1.jpg' }], reactions: [], senderName: 'Ada Lovelace', text: '', timestamp: T + 210_000, type: 'media' },
    { isUnsent: true, media: [], reactions: [], senderName: 'Charles Babbage', text: '', timestamp: T + 215_000, type: 'text' },
    { isUnsent: false, media: [], reactions: [], senderName: 'Charles Babbage', text: 'Always, for you.', timestamp: T + 220_000, type: 'text' },
  ],
};

test('text written the broken way is put right, and text that is already right is left alone', () => {
  assert.equal(repairText(broken('Radosław — 🙂')), 'Radosław — 🙂');
  assert.equal(repairText('Radosław — 🙂'), 'Radosław — 🙂');
  assert.equal(repairText('café'), 'café'); // a plain accented letter is not a broken one
  assert.equal(repairText('plain'), 'plain');
});

test('a standard export is read: oldest first, names and words repaired, and what has no words left out', () => {
  const chat = mergeMessengerFiles([readMessengerFile(STANDARD)!]);
  assert.equal(chat.title, 'Ada Lovelace');
  assert.deepEqual(chat.messages, [
    { at: localStamp(T), sender: 'Ada Lovelace', text: 'Morning Dad' },
    { at: localStamp(T + 120_000), sender: 'Charles Babbagé', text: 'Proud of you — always was 🙂' },
  ]);
  assert.deepEqual([chat.media, chat.notices], [1, 3]);
  assert.deepEqual(chat.senders.map((s) => s.name).sort(), ['Ada Lovelace', 'Charles Babbagé']);
  assert.match(localStamp(T), /^2025-12-1[23]T\d\d:\d\d:\d\d$/);
});

test('a secure storage download is read, and a conversation split over several files is put back together', () => {
  const encrypted = mergeMessengerFiles([readMessengerFile(ENCRYPTED)!]);
  assert.equal(encrypted.title, 'Ada Lovelace_12');
  assert.deepEqual(encrypted.messages.map((m) => [m.sender, m.text]), [['Ada Lovelace', 'Are you up?'], ['Charles Babbage', 'Always, for you.']]);
  assert.deepEqual([encrypted.media, encrypted.notices], [1, 1]);

  const older = { ...STANDARD, messages: [{ sender_name: 'Ada Lovelace', timestamp_ms: T - 86_400_000, content: 'The day before', type: 'Generic' }] };
  const both = mergeMessengerFiles([readMessengerFile(STANDARD)!, readMessengerFile(older)!]);
  assert.deepEqual(both.messages.map((m) => m.text), ['The day before', 'Morning Dad', 'Proud of you — always was 🙂']);

  // Very old exports give the time in seconds.
  const seconds = readMessengerFile({ messages: [{ sender_name: 'Ada', timestamp: 1_524_558_089, content: 'Old one' }] })!;
  assert.equal(seconds.messages[0]!.at, localStamp(1_524_558_089_000));
});

test('a file that is not a conversation is seen as one', () => {
  assert.equal(readMessengerFile({ autofill: { name: 'x' } }), null);
  assert.equal(readMessengerFile([1, 2, 3]), null);
  assert.equal(readMessengerFile('text'), null);
  assert.equal(readMessengerFile({ messages: [{ something: 'else' }, { another: 'thing' }] }), null);
  assert.deepEqual(readMessengerFile({ title: 'Empty', messages: [] })!.messages, []);
});

test('conversations are found in both kinds of download, biggest first', () => {
  const standard = findThreads([
    { name: 'your_facebook_activity/messages/inbox/adalovelace_1015812345/message_1.json', size: 9000 },
    { name: 'your_facebook_activity/messages/inbox/adalovelace_1015812345/message_2.json', size: 4000 },
    { name: 'your_facebook_activity/messages/inbox/adalovelace_1015812345/photos/1.jpg', size: 500_000 },
    { name: 'your_facebook_activity/messages/archived_threads/benbabbage_22/message_1.json', size: 20_000 },
    { name: 'your_facebook_activity/messages/autofill_information.json', size: 100 },
    { name: 'profile_information/profile_information.json', size: 100 },
  ]);
  assert.deepEqual(standard.threads.map((t) => [t.name, t.files, t.bytes]), [['benbabbage', 1, 20_000], ['adalovelace', 2, 13_000]]);
  assert.equal(standard.filesOf.get(standard.threads[1]!.key)!.length, 2);

  const encrypted = findThreads([
    { name: 'messages/Ada Lovelace_12.json', size: 3000 },
    { name: 'messages/Ben Babbage_37.json', size: 8000 },
    { name: 'messages/media/photo.json', size: 99_999 },
    { name: 'messages/media/1.jpg', size: 500_000 },
  ]);
  assert.deepEqual(encrypted.threads.map((t) => [t.name, t.files]), [['Ben Babbage', 1], ['Ada Lovelace', 1]]);
  assert.deepEqual(findThreads([{ name: 'photo.jpg', size: 1 }]).threads, []);
});

test('files are read out of an ordinary ZIP and out of a big one', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'echo-messenger-'));
  const files = [
    { name: 'messages/inbox/ada_1/message_1.json', contents: Buffer.from(JSON.stringify(STANDARD)), deflate: true },
    { name: 'messages/inbox/ada_1/photos/1.jpg', contents: Buffer.alloc(3000, 9) },
    { name: 'messages/inbox/ada_1/message_2.json', contents: Buffer.from(JSON.stringify(ENCRYPTED)) },
  ];
  for (const big of [false, true]) {
    const zipPath = path.join(dir, big ? 'big.zip' : 'ordinary.zip');
    writeFileSync(zipPath, makeZip(files, big));
    assert.deepEqual(namesInZip(zipPath).map((entry) => [entry.name, entry.size]), files.map((file) => [file.name, file.contents.length]));
    const [second, first] = readManyFromZip(zipPath, [files[2]!.name, files[0]!.name], 1_000_000);
    assert.equal(JSON.parse(first!.toString('utf8')).title, 'Ada Lovelace');
    assert.equal(JSON.parse(second!.toString('utf8')).threadName, 'Ada Lovelace_12');
    assert.throws(() => readManyFromZip(zipPath, [files[0]!.name, files[1]!.name], 2000), /too big/);
    assert.throws(() => readManyFromZip(zipPath, ['not-there.json'], 1000), /no longer holds/);
  }
});
