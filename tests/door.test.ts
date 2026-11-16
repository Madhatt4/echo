import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { closeDoor, doorFolder, doorTurnedOnAt, openDoor, readDoorStore, writeDoorStore } from '../src/core/door.ts';
import { doorLines, doorPassages } from '../src/shared/door.ts';
import type { DoorStore } from '../src/shared/door.ts';
import type { Memory } from '../src/shared/memories.ts';
import type { SheetLineView } from '../src/shared/sheets.ts';

const passage = (id: string, change: Partial<Memory> = {}): Memory => ({
  id,
  source: { kind: 'story', id: `source-${id}`, title: 'The caravan' },
  context: '',
  text: `words of ${id}`,
  date: '2026-11-13T09:00:00.000Z',
  people: [],
  audience: { kind: 'everyone' },
  ownAudience: false,
  use: 'memory',
  leftOut: false,
  held: false,
  ...change,
});

test('the assistant is given only passages the echo may use and that are marked for everyone', () => {
  const given = doorPassages([
    passage('plain'),
    passage('corrected', { words: 'the corrected wording' }),
    passage('for-one', { audience: { kind: 'person', personId: 'p1' } }),
    passage('left-out', { leftOut: true }),
    passage('held', { held: true }),
    passage('for-the-day', { use: 'advice-on-the-day' }),
  ]);
  assert.deepEqual(given.map((item) => item.id), ['plain', 'corrected']);
  assert.deepEqual(given[0], { id: 'plain', from: 'story', title: 'The caravan', context: '', text: 'words of plain', date: '2026-11-13T09:00:00.000Z' });
  assert.equal(given[1]!.text, 'the corrected wording'); // the wording the echo itself would use
});

test('the assistant is given only sheet lines that are in use and for everyone', () => {
  const line = (text: string, change: Partial<SheetLineView> = {}): SheetLineView => ({ id: text, section: 'How I talk', text, evidence: [], audience: { kind: 'everyone' }, origin: 'yours', checked: true, support: [], inUse: true, ...change });
  assert.deepEqual(doorLines([line('Plain speaker'), line('Not in use', { inUse: false }), line('About one person', { audience: { kind: 'person', personId: 'p1' } })]), [{ section: 'How I talk', text: 'Plain speaker' }]);
});

test('the door has a key of its own; off means the store and the key are gone', () => {
  const folder = doorFolder(path.join(mkdtempSync(path.join(tmpdir(), 'echo-door-')), 'config.json'));
  const store: DoorStore = { version: 1, writtenAt: '2026-11-13T09:00:00.000Z', owner: 'Ada Lovelace', passages: [{ id: 'a', from: 'story', title: 'The caravan', context: '', text: 'We went every summer.', date: '2026-11-13' }], characterSheet: [], styleProfile: [] };

  assert.equal(path.basename(folder), 'assistant-door');
  assert.equal(doorTurnedOnAt(folder), null);
  writeDoorStore(folder, store); // off: nothing is written
  assert.ok(!existsSync(folder));
  assert.equal(readDoorStore(folder), null);

  openDoor(folder);
  const turnedOnAt = doorTurnedOnAt(folder);
  assert.ok(turnedOnAt !== null);
  const key = JSON.parse(readFileSync(path.join(folder, 'door-key.json'), 'utf8')).key as string;
  assert.equal(Buffer.from(key, 'base64').length, 32);
  openDoor(folder); // already on: the key is not replaced
  assert.equal(JSON.parse(readFileSync(path.join(folder, 'door-key.json'), 'utf8')).key, key);
  assert.equal(readDoorStore(folder), null); // on, but nothing written yet

  writeDoorStore(folder, store);
  assert.deepEqual(readDoorStore(folder), store);
  assert.ok(!readFileSync(path.join(folder, 'store.sealed'), 'utf8').includes('We went every summer'));

  // A damaged key file means the door is off, not that something half-works.
  writeFileSync(path.join(folder, 'door-key.json'), '{"version":1,"key":"too short"}');
  assert.equal(doorTurnedOnAt(folder), null);
  assert.equal(readDoorStore(folder), null);

  closeDoor(folder);
  assert.ok(!existsSync(folder));
  closeDoor(folder); // already off
});
