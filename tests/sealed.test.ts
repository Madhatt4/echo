import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { readSealedFile, writeSealedFile } from '../src/core/sealed.ts';
import { loadSettings, saveSettings } from '../src/core/settings.ts';

const file = () => path.join(mkdtempSync(path.join(tmpdir(), 'echo-sealed-')), 'thing.sealed');

test('what is written comes back, and is unreadable on disk', () => {
  const f = file();
  const key = randomBytes(32);
  writeSealedFile(f, key, 'echo/test/v1', { secret: 'a very recognisable value' });
  assert.deepEqual(readSealedFile(f, key, 'echo/test/v1'), { secret: 'a very recognisable value' });
  assert.ok(!readFileSync(f, 'utf8').includes('recognisable'));
});

test('a missing file reads as nothing', () => {
  assert.equal(readSealedFile(file(), randomBytes(32), 'echo/test/v1'), null);
});

test('the wrong key, the wrong purpose, or an edited file are all refused', () => {
  const f = file();
  const key = randomBytes(32);
  writeSealedFile(f, key, 'echo/test/v1', { a: 1 });
  assert.throws(() => readSealedFile(f, randomBytes(32), 'echo/test/v1'));
  assert.throws(() => readSealedFile(f, key, 'echo/other/v1'));
  const parts = readFileSync(f, 'utf8').trim().split('.');
  const body = Buffer.from(parts[2]!, 'base64');
  body[0] = body[0]! ^ 0xff;
  parts[2] = body.toString('base64');
  writeFileSync(f, parts.join('.'), 'utf8');
  assert.throws(() => readSealedFile(f, key, 'echo/test/v1'));
});

test('archive settings start empty and keep what is saved', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'echo-settings-'));
  const key = randomBytes(32);
  assert.deepEqual(loadSettings(dir, key), {});
  const settings = { aiKey: { provider: 'anthropic' as const, key: 'sk-ant-abc', testedAt: '2026-11-11T00:00:00.000Z' } };
  saveSettings(dir, key, settings);
  assert.deepEqual(loadSettings(dir, key), settings);
});
