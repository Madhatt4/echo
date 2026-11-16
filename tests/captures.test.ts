import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { addCapture, loadCaptures, removeCapture } from '../src/core/captures.ts';
import {
  FACE_VIDEO_CUES,
  FACE_VIDEO_SECONDS,
  SELFIE_POSES,
  VOICE_PASSAGES,
  VOICE_TARGET_SECONDS,
  cueAt,
} from '../src/shared/capture-guides.ts';

const MEDIA = '00000000-0000-0000-0000-000000000000';

test('captures are added and removed, and read back as saved', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'echo-captures-'));
  const key = randomBytes(32);
  assert.deepEqual(loadCaptures(dir, key), []);
  const photo = addCapture(dir, key, { group: 'face-photo', label: 'front-neutral', seconds: 0, mediaId: MEDIA, mimeType: 'image/jpeg' });
  const voice = addCapture(dir, key, { group: 'voice', label: 'read-plain', seconds: 61.6, mediaId: MEDIA, mimeType: 'audio/webm' });
  assert.equal(voice.seconds, 62);
  assert.deepEqual(loadCaptures(dir, key).map((c) => c.group), ['face-photo', 'voice']);
  assert.equal(removeCapture(dir, key, photo.id)?.label, 'front-neutral');
  assert.equal(removeCapture(dir, key, photo.id), null);
  assert.deepEqual(loadCaptures(dir, key).map((c) => c.id), [voice.id]);
});

test('every pose and passage has a unique id and real guidance', () => {
  for (const list of [SELFIE_POSES, VOICE_PASSAGES]) {
    const ids = list.map((item) => item.id);
    assert.equal(new Set(ids).size, ids.length);
  }
  for (const pose of SELFIE_POSES) assert.ok(pose.title.length > 0 && pose.instruction.length > 20);
  for (const passage of VOICE_PASSAGES) assert.ok(passage.title.length > 0 && passage.text.length > 60);
  assert.ok(VOICE_PASSAGES.some((p) => p.kind === 'read') && VOICE_PASSAGES.some((p) => p.kind === 'talk'));
  assert.equal(VOICE_TARGET_SECONDS, 1800);
});

test('the video guide runs in order, covers two minutes, and always has a cue to show', () => {
  const times = FACE_VIDEO_CUES.map((cue) => cue.at);
  assert.deepEqual(times, [...times].sort((a, b) => a - b));
  assert.equal(times[0], 0);
  assert.ok(times.includes(FACE_VIDEO_SECONDS));
  assert.equal(cueAt(0), FACE_VIDEO_CUES[0]!.cue);
  assert.equal(cueAt(14.9), FACE_VIDEO_CUES[0]!.cue);
  assert.equal(cueAt(15), FACE_VIDEO_CUES[1]!.cue);
  assert.equal(cueAt(9999), FACE_VIDEO_CUES.at(-1)!.cue);
});
