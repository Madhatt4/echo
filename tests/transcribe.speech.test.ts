// A real end-to-end check of speech-to-text. It needs the model and a spoken
// recording, so it only runs where ECHO_SPEECH_WAV points at one (the Windows
// checks synthesise it). Everywhere else it is skipped.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { mixToMono, SPEECH_RATE } from '../src/shared/audio.ts';
import { loadTranscriber, modelIsDownloaded } from '../src/core/transcribe.ts';

const wavFile = process.env.ECHO_SPEECH_WAV;
const modelDir = process.env.ECHO_MODEL_DIR ?? path.join(mkdtempSync(path.join(tmpdir(), 'echo-model-')), 'models');

/** Reads a 16-bit PCM WAV file into one channel at 16,000 samples a second. */
function readSpeech(file: string): Float32Array {
  const wav = readFileSync(file);
  assert.equal(wav.toString('ascii', 0, 4), 'RIFF');
  let offset = 12;
  let channels = 1;
  let rate = SPEECH_RATE;
  let data: Buffer | null = null;
  while (offset + 8 <= wav.length) {
    const id = wav.toString('ascii', offset, offset + 4);
    const size = wav.readUInt32LE(offset + 4);
    if (id === 'fmt ') {
      assert.equal(wav.readUInt16LE(offset + 8), 1, 'the test recording must be plain PCM');
      channels = wav.readUInt16LE(offset + 10);
      rate = wav.readUInt32LE(offset + 12);
      assert.equal(wav.readUInt16LE(offset + 22), 16, 'the test recording must be 16-bit');
    } else if (id === 'data') {
      data = wav.subarray(offset + 8, Math.min(wav.length, offset + 8 + size));
    }
    offset += 8 + size + (size % 2);
  }
  assert.ok(data, 'the test recording has no sound in it');
  const frames = Math.floor(data.length / 2 / channels);
  const separate = Array.from({ length: channels }, () => new Float32Array(frames));
  for (let frame = 0; frame < frames; frame += 1) {
    for (let channel = 0; channel < channels; channel += 1) {
      separate[channel]![frame] = data.readInt16LE((frame * channels + channel) * 2) / 32768;
    }
  }
  const mono = mixToMono(separate);
  if (rate === SPEECH_RATE) return mono;
  // Simple resampling by averaging, which is enough for clean synthesised speech.
  const step = rate / SPEECH_RATE;
  const resampled = new Float32Array(Math.floor(mono.length / step));
  for (let i = 0; i < resampled.length; i += 1) {
    const from = Math.floor(i * step);
    const to = Math.min(mono.length, Math.max(from + 1, Math.floor((i + 1) * step)));
    let sum = 0;
    for (let j = from; j < to; j += 1) sum += mono[j]!;
    resampled[i] = sum / (to - from);
  }
  return resampled;
}

test('spoken English is written down correctly, on this computer', { skip: !wavFile, timeout: 600_000 }, async () => {
  let sawProgress = false;
  const transcriber = await loadTranscriber(modelDir, (progress) => {
    sawProgress = true;
    assert.ok(progress.percent >= 0 && progress.percent <= 100);
  });
  assert.equal(modelIsDownloaded(modelDir), true);
  const modelBytes = readdirSync(modelDir, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .reduce((total, entry) => total + statSync(path.join(entry.parentPath, entry.name)).size, 0);
  console.log(`model ready: ${Math.round(modelBytes / (1024 * 1024))} MB on disk; download progress reported: ${sawProgress}`);

  const started = Date.now();
  const samples = readSpeech(wavFile!);
  const text = (await transcriber.transcribe(samples)).toLowerCase();
  const seconds = samples.length / SPEECH_RATE;
  console.log(`transcribed ${seconds.toFixed(1)}s of speech in ${((Date.now() - started) / 1000).toFixed(1)}s: "${text}"`);

  for (const word of ['grandmother', 'chickens', 'garden', 'fox', 'dog']) {
    assert.ok(text.includes(word), `the transcript is missing "${word}": ${text}`);
  }
  assert.equal(await transcriber.transcribe(new Float32Array(0)), '');
});
