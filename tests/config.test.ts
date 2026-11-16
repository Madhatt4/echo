import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { loadConfig, saveConfig } from '../src/core/config.ts';

test('settings survive being saved and loaded, including a new folder', () => {
  const file = path.join(mkdtempSync(path.join(tmpdir(), 'echo-config-')), 'nested', 'config.json');
  assert.deepEqual(loadConfig(file), {});
  saveConfig(file, { archivePath: 'D:\\Echo Archive' });
  assert.deepEqual(loadConfig(file), { archivePath: 'D:\\Echo Archive' });
});

test('a damaged settings file is treated as no settings', () => {
  const file = path.join(mkdtempSync(path.join(tmpdir(), 'echo-config-')), 'config.json');
  writeFileSync(file, '{ not json', 'utf8');
  assert.deepEqual(loadConfig(file), {});
});
