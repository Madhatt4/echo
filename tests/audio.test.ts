import { test } from 'node:test';
import assert from 'node:assert/strict';
import { joinTranscripts, mixToMono, splitAtQuietPoints } from '../src/shared/audio.ts';

test('two channels are averaged into one; one channel is left alone', () => {
  const left = new Float32Array([1, 0, -1]);
  const right = new Float32Array([0, 0, 1]);
  assert.deepEqual([...mixToMono([left, right])], [0.5, 0, 0]);
  assert.equal(mixToMono([left]), left);
  assert.equal(mixToMono([]).length, 0);
});

test('a short recording is not cut', () => {
  const samples = new Float32Array(1000).fill(0.5);
  const parts = splitAtQuietPoints(samples, 100, 20, 5);
  assert.equal(parts.length, 1);
  assert.equal(parts[0]!.length, 1000);
});

test('a long recording is cut into parts that keep every sample, each within the limit', () => {
  const rate = 100;
  const samples = new Float32Array(100 * rate).fill(0.5); // 100 seconds
  const parts = splitAtQuietPoints(samples, rate, 30, 10);
  assert.ok(parts.length >= 4);
  assert.equal(parts.reduce((total, part) => total + part.length, 0), samples.length);
  for (const part of parts) assert.ok(part.length <= 30 * rate);
});

test('cuts land in the quiet, not in the middle of speech', () => {
  const rate = 100;
  const samples = new Float32Array(50 * rate).fill(0.8); // loud throughout...
  samples.fill(0, 26 * rate, 28 * rate); // ...except a pause from 26s to 28s
  const parts = splitAtQuietPoints(samples, rate, 30, 10);
  assert.equal(parts.length, 2);
  const cutAt = parts[0]!.length / rate;
  assert.ok(cutAt >= 26 && cutAt <= 28, `cut at ${cutAt}s`);
});

test('transcripts from parts are joined with single spaces, skipping empty ones', () => {
  assert.equal(joinTranscripts([' It rained. ', '', '  All week.']), 'It rained. All week.');
});
