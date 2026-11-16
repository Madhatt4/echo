import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { DOOR_HELP, defaultDoorFolder, runDoorCommand, suggestWords } from '../src/core/door-commands.ts';
import { closeDoor, openDoor, readDoorStore, readTray, takeDoorUses, writeDoorStore } from '../src/core/door.ts';
import { searchPassages, summariseDoorUses } from '../src/shared/door.ts';
import type { DoorPassage, DoorStore } from '../src/shared/door.ts';

const passages: DoorPassage[] = [
  { id: 'caravan', from: 'story', title: 'The caravan', context: '', text: 'We went to the caravan every summer and it always rained.', date: '2026-11-10T09:00:00.000Z' },
  { id: 'lorries', from: 'interview', title: 'Work', context: 'What did you do for a living?', text: 'I drove lorries for thirty years, summer and winter.', date: '2026-11-12T09:00:00.000Z' },
  { id: 'letter', from: 'letter', title: 'About the clock', context: '', text: 'The grandfather clock in the hall is yours.', date: '2026-11-11T09:00:00.000Z' },
];
const store: DoorStore = { version: 1, writtenAt: '2026-11-13T09:00:00.000Z', owner: 'Ada Lovelace', passages, characterSheet: [{ section: 'How I talk', text: 'Plain speaker' }], styleProfile: [{ section: 'Words', text: 'Says "right then" a lot' }] };

function doorWith(contents: DoorStore | null): string {
  const folder = path.join(mkdtempSync(path.join(tmpdir(), 'echo-door-')), 'assistant-door');
  if (contents) {
    openDoor(folder);
    writeDoorStore(folder, contents);
  }
  return folder;
}

const out = (answer: { output: unknown }) => answer.output as Record<string, any>;

test('search ranks by how many different words of the question a passage holds; small words do not count', () => {
  assert.deepEqual(searchPassages(passages, 'what was the caravan like in summer', 10).map((p) => p.id), ['caravan', 'lorries']); // two words beat one
  assert.deepEqual(searchPassages(passages, 'SUMMER', 10).map((p) => p.id), ['lorries', 'caravan']); // a tie goes to the newer
  assert.deepEqual(searchPassages(passages, 'living', 10).map((p) => p.id), ['lorries']); // what the words were answering counts too
  assert.deepEqual(searchPassages(passages, 'the and what', 10), []); // only small words
  assert.deepEqual(searchPassages(passages, 'submarine', 10), []);
  assert.equal(searchPassages(passages, 'summer', 1).length, 1);
});

test('with the door off, status says so and nothing else is answered', () => {
  const folder = doorWith(null);
  const status = runDoorCommand(['status'], folder);
  assert.deepEqual([status.exit, out(status).on, out(status).passages], [0, false, 0]);
  assert.ok(String(out(status).problem).includes('turns it on inside Echo'));
  for (const command of [['search', 'caravan'], ['read'], ['sheets']]) assert.equal(runDoorCommand(command, folder).exit, 1);
  assert.ok(!existsSync(folder)); // asking never creates anything
});

test('status, search, read and sheets answer from the store', () => {
  const folder = doorWith(store);
  const status = out(runDoorCommand(['status'], folder));
  assert.deepEqual([status.on, status.owner, status.passages, status.characterSheetLines, status.styleProfileLines], [true, 'Ada Lovelace', 3, 1, 1]);

  const found = runDoorCommand(['search', 'caravan', 'summer', '--limit', '1'], folder);
  assert.deepEqual([found.exit, out(found).found, out(found).passages[0].id], [0, 1, 'caravan']);

  const all = out(runDoorCommand(['read'], folder));
  assert.deepEqual([all.total, all.passages.map((p: DoorPassage) => p.id)], [3, ['lorries', 'letter', 'caravan']]); // newest first
  assert.deepEqual(out(runDoorCommand(['read', '--from', 'letter'], folder)).passages.map((p: DoorPassage) => p.id), ['letter']);
  assert.deepEqual(out(runDoorCommand(['read', '--limit', '1', '--offset', '1'], folder)).passages.map((p: DoorPassage) => p.id), ['letter']);
  assert.equal(out(runDoorCommand(['read', '--id', 'caravan'], folder)).passages[0].text, 'We went to the caravan every summer and it always rained.');
  assert.equal(runDoorCommand(['read', '--id', 'no-such'], folder).exit, 1);

  const sheets = out(runDoorCommand(['sheets'], folder));
  assert.deepEqual([sheets.characterSheet, sheets.styleProfile], [store.characterSheet, store.styleProfile]);
});

test('a command that is not understood says what is wrong, and help lists the commands', () => {
  const folder = doorWith(store);
  assert.equal(runDoorCommand([], folder).exit, 2);
  assert.deepEqual([runDoorCommand(['help'], folder).exit, runDoorCommand(['help'], folder).output], [0, DOOR_HELP]);
  assert.equal(runDoorCommand(['delete', 'everything'], folder).exit, 2); // there is no command that changes anything
  assert.equal(runDoorCommand(['search'], folder).exit, 2);
  assert.equal(runDoorCommand(['search', 'clock', '--limit'], folder).exit, 2);
  assert.equal(runDoorCommand(['read', '--limit', 'ten'], folder).exit, 2);
  assert.equal(runDoorCommand(['read', '--from', 'diary'], folder).exit, 2);
  assert.equal(out(runDoorCommand(['read', '--limit', '9999'], folder)).passages.length, 3); // a huge limit is cut down, not refused
});

test('each use is written down without any words, and handed to Echo once', () => {
  const folder = doorWith(store);
  runDoorCommand(['status'], folder);
  runDoorCommand(['search', 'grandfather', 'clock'], folder);
  runDoorCommand(['search', 'submarine'], folder);
  runDoorCommand(['read', '--from', 'story'], folder);
  runDoorCommand(['sheets'], folder);
  runDoorCommand(['read', '--limit', 'ten'], folder); // not understood: nothing was read, nothing is written down

  const written = readFileSync(path.join(folder, 'door-uses.jsonl'), 'utf8');
  assert.ok(!written.includes('grandfather') && !written.includes('submarine') && !written.includes('caravan'));
  const uses = takeDoorUses(folder);
  assert.deepEqual(uses.map((use) => [use.command, use.results]), [['status', 0], ['search', 1], ['search', 0], ['read', 1], ['sheets', 2]]);
  assert.deepEqual(takeDoorUses(folder), []); // taken once
  const day = uses[0]!.at.slice(0, 10);
  assert.deepEqual(summariseDoorUses(uses), [
    { day, command: 'read', times: 1, results: 1 },
    { day, command: 'search', times: 2, results: 1 },
    { day, command: 'sheets', times: 1, results: 2 },
    { day, command: 'status', times: 1, results: 0 },
  ]);
  closeDoor(folder);
  assert.equal(runDoorCommand(['search', 'clock'], folder).exit, 1);
  assert.ok(!existsSync(folder)); // a use after the door is shut leaves nothing behind
});

test('the door is looked for beside the settings unless told otherwise', () => {
  assert.equal(defaultDoorFolder({ APPDATA: path.join('C:', 'Users', 'Ada', 'AppData', 'Roaming') }), path.join('C:', 'Users', 'Ada', 'AppData', 'Roaming', 'Echo', 'assistant-door'));
  assert.equal(defaultDoorFolder({ ECHO_DOOR_FOLDER: '/somewhere/else', APPDATA: '/ignored' }), '/somewhere/else');
});

test('the echo-door command itself prints JSON and sets its exit code', () => {
  const folder = doorWith(store);
  const run = (...args: string[]) => spawnSync(process.execPath, ['--no-warnings', path.join('src', 'core', 'door-cli.ts'), ...args], { env: { ...process.env, ECHO_DOOR_FOLDER: folder }, encoding: 'utf8' });
  const found = run('search', 'lorries');
  assert.equal(found.status, 0);
  assert.equal(JSON.parse(found.stdout).passages[0].id, 'lorries');
  assert.ok(run('help').stdout.includes('echo-door search'));
  assert.equal(run('nonsense').status, 2);
  closeDoor(folder);
  assert.equal(run('search', 'lorries').status, 1);
});

test('the assistant can leave a file or a draft in the tray, see what it has left, and take one back; nothing else changes', () => {
  const folder = doorWith(store);
  const before = JSON.stringify(readDoorStore(folder));
  const here = path.join(path.dirname(folder), 'export.zip');
  writeFileSync(here, 'not a real export');

  const file = runDoorCommand(['suggest-file', here, '--as', 'whatsapp', '--note', 'Your chat with Ben, exported last week'], folder);
  assert.equal(file.exit, 0);
  assert.deepEqual([out(file).left.kind, out(file).left.path, out(file).left.as, out(file).waiting], ['file', here, 'whatsapp', 1]);
  assert.ok(String(out(file).what_happens_next).includes('Nothing has been added to the archive'));

  const words = runDoorCommand(['suggest-words', '--title', 'The caravan at Skegness'], folder, 'We went every August. Dad drove the whole way without stopping.\n');
  assert.deepEqual([words.exit, out(words).left.kind, out(words).left.title, out(words).waiting], [0, 'words', 'The caravan at Skegness', 2]);
  assert.equal(out(words).left.text, undefined); // the answer does not hand the draft back

  const tray = runDoorCommand(['tray'], folder);
  assert.deepEqual([tray.exit, out(tray).waiting, out(tray).items.map((item: { kind: string }) => item.kind)], [0, 2, ['file', 'words']]);
  assert.deepEqual(readTray(folder).map((item) => (item.kind === 'words' ? item.text : item.path)), [here, 'We went every August. Dad drove the whole way without stopping.']);
  assert.equal(out(runDoorCommand(['status'], folder)).waitingInTray, 2);

  // The tray is sealed like the store, and the store itself is untouched.
  for (const name of readdirSync(path.join(folder, 'tray'))) assert.ok(!readFileSync(path.join(folder, 'tray', name), 'utf8').includes('Skegness'));
  assert.equal(JSON.stringify(readDoorStore(folder)), before);

  const id = out(words).left.id as string;
  assert.deepEqual([runDoorCommand(['withdraw', id], folder).exit, out(runDoorCommand(['tray'], folder)).waiting], [0, 1]);
  assert.equal(runDoorCommand(['withdraw', id], folder).exit, 1); // already gone
  assert.equal(runDoorCommand(['withdraw', '../door-key.json'], folder).exit, 1); // an id is only ever an id

  const uses = takeDoorUses(folder).map((use) => use.command);
  assert.deepEqual(uses, ['suggest', 'suggest', 'tray', 'status', 'withdraw', 'tray']);
});

test('what cannot be left is refused in plain words', () => {
  const folder = doorWith(store);
  assert.ok(String(out(runDoorCommand(['suggest-file', path.join(folder, 'no-such-file.zip')], folder)).problem).includes('There is no file or folder'));
  const here = path.join(path.dirname(folder), 'export.zip');
  writeFileSync(here, 'x');
  assert.ok(String(out(runDoorCommand(['suggest-file', here, '--as', 'telegram'], folder)).problem).includes('must be one of'));
  assert.equal(runDoorCommand(['suggest-file'], folder).exit, 2);
  assert.equal(runDoorCommand(['suggest-words', '--text', 'no title'], folder).exit, 2);
  assert.ok(String(out(runDoorCommand(['suggest-words', '--title', 'Empty'], folder, '   ')).problem).includes('no words'));
  assert.ok(String(out(runDoorCommand(['suggest-words', '--title', 'Long', '--text', 'x'.repeat(20_001)], folder)).problem).includes('too long'));
  assert.equal(readTray(folder).length, 0);

  // A full tray takes no more.
  for (let i = 0; i < 50; i += 1) assert.equal(suggestWords(folder, { title: `Draft ${i}`, text: 'Some words.', note: '' }).exit, 0);
  const full = suggestWords(folder, { title: 'One too many', text: 'Some words.', note: '' });
  assert.ok(full.exit === 1 && String(out(full).problem).includes('The tray is full'));

  // With the door off nothing can be left.
  const off = doorWith(null);
  assert.equal(suggestWords(off, { title: 'T', text: 'Words.', note: '' }).exit, 1);
  assert.equal(runDoorCommand(['tray'], off).exit, 1);
  assert.ok(!existsSync(off));
});
