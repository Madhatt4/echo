import assert from 'node:assert/strict';
import { test } from 'node:test';
import { discordFileKind, discordLabel, discordMoment, discordWords, findDiscordChannels, nameDiscordChannels, parseCsv, readDiscordMessages } from '../src/shared/discord.ts';
import { localStamp } from '../src/shared/messenger.ts';

test('the channels in a package are found from its file names, with or without the "c", in JSON or CSV', () => {
  const found = findDiscordChannels([
    { name: 'package/messages/index.json', size: 300 },
    { name: 'package/messages/c111/messages.json', size: 5000 },
    { name: 'package/messages/c111/channel.json', size: 80 },
    { name: 'package/Messages/222/messages.csv', size: 9000 },
    { name: 'package/account/user.json', size: 700 },
    { name: 'package/activity/reporting/events.json', size: 99999 },
    { name: '__MACOSX/package/messages/c333/messages.json', size: 10 },
  ]);
  assert.deepEqual(found.threads.map((thread) => [thread.key, thread.name, thread.bytes]), [['222', 'Channel 222', 9000], ['111', 'Channel 111', 5000]]); // biggest first
  assert.deepEqual([...found.filesOf.entries()], [['111', ['package/messages/c111/messages.json']], ['222', ['package/Messages/222/messages.csv']]]);
  assert.equal(found.indexFile, 'package/messages/index.json');
  assert.deepEqual(findDiscordChannels([{ name: 'messages/inbox/ben_1/message_1.json', size: 10 }]).threads, []); // a Messenger download is not a Discord package
});

test('channels are named from the index, and one the index does not name keeps its number', () => {
  const threads = [
    { key: '111', name: 'Channel 111', files: 1, bytes: 10 },
    { key: '222', name: 'Channel 222', files: 1, bytes: 10 },
    { key: '333', name: 'Channel 333', files: 1, bytes: 10 },
  ];
  const named = nameDiscordChannels(threads, JSON.stringify({ '111': 'Direct Message with ada#0001', c222: 'general in Garden Club', '333': null }));
  assert.deepEqual(named.map((thread) => thread.name), ['Direct Message with ada#0001', 'general in Garden Club', 'Channel 333']);
  assert.deepEqual(nameDiscordChannels(threads, 'not json').map((thread) => thread.name), ['Channel 111', 'Channel 222', 'Channel 333']);
  assert.equal(discordLabel('Direct Message with ada#0001'), 'ada#0001');
  assert.equal(discordLabel('x'.repeat(200)).length, 80);
});

test('times are read with or without a zone, and without one are taken as UTC', () => {
  const noon = Date.UTC(2021, 2, 4, 12, 0, 0);
  assert.equal(discordMoment('2021-03-04 12:00:00'), noon);
  assert.equal(discordMoment('2021-03-04T12:00:00Z'), noon);
  assert.equal(discordMoment('2021-03-04 12:00:00.123000+00:00'), noon + 123);
  assert.equal(discordMoment('2021-03-04 14:00:00+02:00'), noon);
  assert.equal(discordMoment('last Tuesday'), null);
  assert.equal(discordMoment(''), null);
  assert.equal(discordMoment(12345), null);
});

test("Discord's own codes are taken out of the words", () => {
  assert.equal(discordWords('<@123456> and <@!789> see <#555> for <@&42> <:thumbsup:99> <a:party:100>'), 'and see for :thumbsup: :party:');
  assert.equal(discordWords('line one\nline two'), 'line one\nline two');
  assert.equal(discordWords(undefined), '');
});

test('CSV with quoted commas, line breaks and doubled quotes is split properly', () => {
  assert.deepEqual(parseCsv('ID,Timestamp,Contents,Attachments\r\n1,2021-03-04 12:00:00,"hello, ""you""\nthere",\r\n2,2021-03-04 12:01:00,plain,http://x\r\n'), [
    ['ID', 'Timestamp', 'Contents', 'Attachments'],
    ['1', '2021-03-04 12:00:00', 'hello, "you"\nthere', ''],
    ['2', '2021-03-04 12:01:00', 'plain', 'http://x'],
  ]);
  assert.deepEqual(parseCsv(''), []);
});

test("a channel's messages are read oldest first, all as the owner; attachments with no words are counted and left out", () => {
  const file = JSON.stringify([
    { ID: '30', Timestamp: '2021-03-04 12:05:00', Contents: '', Attachments: 'https://cdn.example/a.png' },
    { ID: '21', Timestamp: '2021-03-04 12:01:00', Contents: 'second in the same second', Attachments: '' },
    { ID: '20', Timestamp: '2021-03-04 12:01:00', Contents: 'first in the same second', Attachments: '' },
    { ID: '10', Timestamp: '2021-03-04 12:00:00', Contents: 'the very first thing I said', Attachments: '' },
    { ID: '40', Timestamp: '2021-03-04 12:06:00', Contents: '<@99>', Attachments: '' },
    { ID: '50', Timestamp: 'no time', Contents: 'lost', Attachments: '' },
  ]);
  const read = readDiscordMessages(file, 'json', 'Charles Babbage')!;
  assert.deepEqual(read.messages.map((message) => message.text), ['the very first thing I said', 'first in the same second', 'second in the same second']);
  assert.ok(read.messages.every((message) => message.sender === 'Charles Babbage'));
  assert.equal(read.messages[0]!.at, localStamp(Date.UTC(2021, 2, 4, 12, 0, 0)));
  assert.deepEqual(read.senders, [{ name: 'Charles Babbage', count: 3 }]);
  assert.deepEqual([read.media, read.notices, read.notUnderstood], [1, 1, 1]);
});

test('an older package in CSV reads the same, and a file that is not Discord messages is refused', () => {
  const csv = 'ID,Timestamp,Contents,Attachments\n2,2021-03-04 12:01:00.500000+00:00,"well, that went better than expected",\n1,2021-03-04 12:00:00+00:00,morning all,\n';
  const read = readDiscordMessages(csv, 'csv', 'Me')!;
  assert.deepEqual(read.messages.map((message) => message.text), ['morning all', 'well, that went better than expected']);
  assert.equal(discordFileKind('package/messages/c1/messages.csv'), 'csv');
  assert.equal(discordFileKind('messages.json'), 'json');

  assert.equal(readDiscordMessages('{"participants": []}', 'json', 'Me'), null); // not a list
  assert.equal(readDiscordMessages('not json', 'json', 'Me'), null);
  assert.equal(readDiscordMessages('name,age\nada,36\n', 'csv', 'Me'), null); // no Timestamp or Contents column
  assert.equal(readDiscordMessages(JSON.stringify([{ sender_name: 'Ben', content: 'hello' }]), 'json', 'Me'), null); // nothing has a time
  assert.deepEqual(readDiscordMessages('[]', 'json', 'Me')!.messages, []);
});
