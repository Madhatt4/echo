import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { AUDIT_FILENAME, appendAudit, readAudit } from '../src/core/audit.ts';

function setup(): { dir: string; key: Buffer; file: string } {
  const dir = mkdtempSync(path.join(tmpdir(), 'echo-audit-'));
  return { dir, key: randomBytes(32), file: path.join(dir, AUDIT_FILENAME) };
}

test('an empty archive has an empty, intact audit trail', () => {
  const { dir, key } = setup();
  assert.deepEqual(readAudit(dir, key), { events: [], intact: true });
});

test('entries come back in order with what was recorded', () => {
  const { dir, key } = setup();
  appendAudit(dir, key, 'archive.created');
  appendAudit(dir, key, 'archive.unlocked', { failedAttemptsBefore: 2 });
  const reading = readAudit(dir, key);
  assert.equal(reading.intact, true);
  assert.deepEqual(reading.events.map((e) => [e.seq, e.type]), [[1, 'archive.created'], [2, 'archive.unlocked']]);
  assert.deepEqual(reading.events[1]!.detail, { failedAttemptsBefore: 2 });
});

test('nothing recorded is readable on disk', () => {
  const { dir, key, file } = setup();
  appendAudit(dir, key, 'archive.created', { note: 'a very recognisable phrase' });
  const onDisk = readFileSync(file, 'utf8');
  assert.ok(!onDisk.includes('archive.created'));
  assert.ok(!onDisk.includes('recognisable'));
});

test('the wrong key cannot read the trail', () => {
  const { dir, key } = setup();
  appendAudit(dir, key, 'archive.created');
  const reading = readAudit(dir, randomBytes(32));
  assert.equal(reading.intact, false);
  assert.deepEqual(reading.events, []);
});

test('removing an entry from the middle is detected', () => {
  const { dir, key, file } = setup();
  for (const type of ['one', 'two', 'three']) appendAudit(dir, key, type);
  const lines = readFileSync(file, 'utf8').trim().split('\n');
  writeFileSync(file, `${[lines[0], lines[2]].join('\n')}\n`, 'utf8');
  const reading = readAudit(dir, key);
  assert.equal(reading.intact, false);
  assert.deepEqual(reading.events.map((e) => e.type), ['one']);
});

test('swapping two entries is detected', () => {
  const { dir, key, file } = setup();
  for (const type of ['one', 'two', 'three']) appendAudit(dir, key, type);
  const lines = readFileSync(file, 'utf8').trim().split('\n');
  writeFileSync(file, `${[lines[0], lines[2], lines[1]].join('\n')}\n`, 'utf8');
  assert.equal(readAudit(dir, key).intact, false);
});

test('editing an entry is detected', () => {
  const { dir, key, file } = setup();
  appendAudit(dir, key, 'one');
  appendAudit(dir, key, 'two');
  const lines = readFileSync(file, 'utf8').trim().split('\n');
  const parts = lines[0]!.split('.');
  const body = Buffer.from(parts[3]!, 'base64');
  body[0] = body[0]! ^ 0xff;
  parts[3] = body.toString('base64');
  writeFileSync(file, `${[parts.join('.'), lines[1]].join('\n')}\n`, 'utf8');
  assert.equal(readAudit(dir, key).intact, false);
});
