import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { readMedia, writeMedia } from '../src/core/media.ts';

const MIB = 1024 * 1024;

function setup(): { dir: string; key: Buffer } {
  return { dir: mkdtempSync(path.join(tmpdir(), 'echo-media-')), key: randomBytes(32) };
}

function onlyFile(dir: string): string {
  const folder = path.join(dir, 'media');
  const files = readdirSync(folder);
  assert.equal(files.length, 1);
  return path.join(folder, files[0]!);
}

test('a recording comes back exactly, whether tiny, empty, or several pieces long', () => {
  const { dir, key } = setup();
  for (const size of [0, 1, 1000, MIB, 2 * MIB + 12345]) {
    const original = randomBytes(size);
    const id = writeMedia(dir, key, original);
    assert.ok(readMedia(dir, key, id).equals(original), `size ${size}`);
  }
});

test('nothing recognisable reaches the disk', () => {
  const { dir, key } = setup();
  const webmStart = Buffer.concat([Buffer.from([0x1a, 0x45, 0xdf, 0xa3]), Buffer.from('a very recognisable recording')]);
  writeMedia(dir, key, webmStart);
  const onDisk = readFileSync(onlyFile(dir));
  assert.ok(!onDisk.includes(Buffer.from('recognisable')));
  assert.ok(!onDisk.includes(Buffer.from([0x1a, 0x45, 0xdf, 0xa3])));
});

test('the wrong key cannot read it', () => {
  const { dir, key } = setup();
  const id = writeMedia(dir, key, randomBytes(5000));
  assert.throws(() => readMedia(dir, randomBytes(32), id));
});

test('changing one byte is detected', () => {
  const { dir, key } = setup();
  const id = writeMedia(dir, key, randomBytes(5000));
  const file = onlyFile(dir);
  const sealed = readFileSync(file);
  sealed[sealed.length - 100] = sealed[sealed.length - 100]! ^ 0xff;
  writeFileSync(file, sealed);
  assert.throws(() => readMedia(dir, key, id));
});

test('cutting the end off is detected, even at a clean piece boundary', () => {
  const { dir, key } = setup();
  const id = writeMedia(dir, key, randomBytes(2 * MIB));
  const file = onlyFile(dir);
  const sealed = readFileSync(file);
  const onePiece = 8 + 16 + 4 + 12 + MIB + 16;
  writeFileSync(file, sealed.subarray(0, onePiece));
  assert.throws(() => readMedia(dir, key, id), /cut short|changed or damaged/);
  writeFileSync(file, sealed.subarray(0, sealed.length - 10));
  assert.throws(() => readMedia(dir, key, id));
});

test('swapping two pieces is detected', () => {
  const { dir, key } = setup();
  const id = writeMedia(dir, key, randomBytes(3 * MIB));
  const file = onlyFile(dir);
  const sealed = readFileSync(file);
  const head = 8 + 16;
  const piece = 4 + 12 + MIB + 16;
  const swapped = Buffer.concat([
    sealed.subarray(0, head),
    sealed.subarray(head + piece, head + 2 * piece),
    sealed.subarray(head, head + piece),
    sealed.subarray(head + 2 * piece),
  ]);
  writeFileSync(file, swapped);
  assert.throws(() => readMedia(dir, key, id));
});

test('a made-up id is refused before any file is touched', () => {
  const { dir, key } = setup();
  assert.throws(() => readMedia(dir, key, '..\\..\\vault.json'));
  assert.throws(() => readMedia(dir, key, '00000000-0000-0000-0000-000000000000'), /not in the archive/);
});
