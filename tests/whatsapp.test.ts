import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { readFromZip } from '../src/core/zip.ts';
import { chatNameFromFile, parseWhatsApp } from '../src/shared/whatsapp.ts';
import { makeZip as zip } from './helpers/zip.ts';

const IPHONE = [
  '‎[11/12/2025, 18:03:11] Ada: ‎Messages and calls are end-to-end encrypted.',
  '[13/12/2025, 09:15:02] Ada: Morning Dad',
  '[13/12/2025, 09:16:40] Charles Babbage: Morning love.',
  'How did the interview go?',
  '',
  'Ring me later.',
  '[13/12/2025, 09:17:05] Ada: ‎image omitted',
  '[13/12/2025, 09:18:00] Ada: Got it! Start Monday <This message was edited>',
  '[13/12/2025, 09:18:30] Charles Babbage: ‎This message was deleted.',
  '[13/12/2025, 09:19:00] ‎Ada changed the group name',
  '[13/12/2025, 21:05:59] Charles Babbage: Proud of you: always was.',
].join('\r\n');

test('an iPhone export is read: senders, times, messages over several lines, and what has no words is left out', () => {
  const chat = parseWhatsApp(IPHONE);
  assert.deepEqual(chat.messages, [
    { at: '2025-12-13T09:15:02', sender: 'Ada', text: 'Morning Dad' },
    { at: '2025-12-13T09:16:40', sender: 'Charles Babbage', text: 'Morning love.\nHow did the interview go?\n\nRing me later.' },
    { at: '2025-12-13T09:18:00', sender: 'Ada', text: 'Got it! Start Monday' },
    { at: '2025-12-13T21:05:59', sender: 'Charles Babbage', text: 'Proud of you: always was.' },
  ]);
  assert.deepEqual(chat.senders, [{ name: 'Ada', count: 2 }, { name: 'Charles Babbage', count: 2 }]);
  assert.deepEqual([chat.dateOrder, chat.dateOrderCertain, chat.media, chat.notices, chat.notUnderstood], ['day-first', true, 1, 3, 0]);
});

test('an Android export is read, with am and pm times', () => {
  const chat = parseWhatsApp(['12/13/25, 9:15 AM - Ada: Morning Dad', '12/13/25, 12:05 AM - Ada: Still up?', '12/13/25, 9:16 PM - Charles Babbage: <Media omitted>', '12/13/25, 9:17 PM - Charles Babbage: Night.'].join('\n'));
  assert.deepEqual(chat.messages.map((m) => [m.at, m.sender, m.text]), [
    ['2025-12-13T09:15:00', 'Ada', 'Morning Dad'],
    ['2025-12-13T00:05:00', 'Ada', 'Still up?'],
    ['2025-12-13T21:17:00', 'Charles Babbage', 'Night.'],
  ]);
  assert.deepEqual([chat.dateOrder, chat.dateOrderCertain, chat.media], ['month-first', true, 1]);
});

test('year-first dates are read, and a file with only low day numbers is taken as day-first and says it is unsure', () => {
  const iso = parseWhatsApp('[2024-03-15, 10:22:04] +27 82 555 1234: Hello everyone');
  assert.deepEqual([iso.messages[0]!.at, iso.messages[0]!.sender, iso.dateOrder, iso.dateOrderCertain], ['2024-03-15T10:22:04', '+27 82 555 1234', 'year-first', true]);
  const unsure = parseWhatsApp('03/04/2025, 10:00 - Ada: Hello\n05/04/2025, 10:00 - Ada: Again');
  assert.deepEqual([unsure.messages[0]!.at, unsure.dateOrder, unsure.dateOrderCertain], ['2025-04-03T10:00:00', 'day-first', false]);
  const dotted = parseWhatsApp('[13.12.25, 09:15:02] Ada: Hallo');
  assert.equal(dotted.messages[0]!.at, '2025-12-13T09:15:02');
});

test('a message that starts with a date is not mistaken for a new message, and a file that is not a chat is seen as one', () => {
  const chat = parseWhatsApp('[13/12/2025, 09:15:02] Ada: See you on\n14/12/2025, 10:00 at the station');
  assert.equal(chat.messages.length, 1);
  assert.equal(chat.messages[0]!.text, 'See you on\n14/12/2025, 10:00 at the station');
  const notAChat = parseWhatsApp('Shopping list\nmilk\neggs');
  assert.deepEqual([notAChat.messages.length, notAChat.notUnderstood], [0, 3]);
});

test('the conversation is named from the file name', () => {
  assert.equal(chatNameFromFile('WhatsApp Chat - Ada.zip'), 'Ada');
  assert.equal(chatNameFromFile('WhatsApp Chat with Ada Lovelace (1).txt'), 'Ada Lovelace');
  assert.equal(chatNameFromFile('_chat.txt'), '');
  assert.equal(chatNameFromFile('Family.zip'), 'Family');
});

test('the chat text is read out of a ZIP without unpacking the photos beside it', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'echo-zip-'));
  const file = path.join(dir, 'WhatsApp Chat - Ada.zip');
  writeFileSync(file, zip([
    { name: 'IMG-0001.jpg', contents: Buffer.alloc(5000, 7), deflate: false },
    { name: '_chat.txt', contents: Buffer.from(IPHONE, 'utf8'), deflate: true },
  ]));
  const pick = (names: string[]) => names.find((name) => name.toLowerCase().endsWith('.txt')) ?? null;
  const found = readFromZip(file, pick, 1_000_000);
  assert.equal(found.name, '_chat.txt');
  assert.equal(parseWhatsApp(found.contents.toString('utf8')).messages.length, 4);

  // Stored without packing is read too.
  writeFileSync(file, zip([{ name: 'chat.txt', contents: Buffer.from('plain', 'utf8'), deflate: false }]));
  assert.equal(readFromZip(file, pick, 1_000_000).contents.toString('utf8'), 'plain');

  // Not a ZIP, no text file inside, and a file that unpacks too big are all refused in plain words.
  writeFileSync(file, 'this is not a zip at all, just some words in a file');
  assert.throws(() => readFromZip(file, pick, 1_000_000), /not a ZIP/);
  writeFileSync(file, zip([{ name: 'photo.jpg', contents: Buffer.alloc(10), deflate: false }]));
  assert.throws(() => readFromZip(file, pick, 1_000_000), /no chat text file/);
  writeFileSync(file, zip([{ name: '_chat.txt', contents: Buffer.alloc(50_000, 65), deflate: true }]));
  assert.throws(() => readFromZip(file, pick, 10_000), /too big/);
});
