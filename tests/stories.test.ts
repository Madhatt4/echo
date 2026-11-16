import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { addStory, changeStory, loadStories, removeStory, storyView } from '../src/core/stories.ts';
import { EVERYONE } from '../src/shared/people.ts';
import type { Person } from '../src/shared/people.ts';
import { storyProblems } from '../src/shared/stories.ts';

const ADA: Person = { id: 'a', name: 'Ada', relationship: 'daughter', callsMe: 'Dad', mayTalkToEcho: true, addedAt: '2026-11-11T00:00:00.000Z' };
const details = (title: string) => ({ title, prompt: '', audience: EVERYONE, text: '' });
const recording = { mediaId: '00000000-0000-0000-0000-000000000000', mimeType: 'audio/webm', seconds: 61.4 };

function setup(): { dir: string; key: Buffer } {
  return { dir: mkdtempSync(path.join(tmpdir(), 'echo-stories-')), key: randomBytes(32) };
}

test('stories are added, changed and removed, and read back as saved', () => {
  const { dir, key } = setup();
  assert.deepEqual(loadStories(dir, key), []);
  const first = addStory(dir, key, details('  The caravan  '), recording);
  const second = addStory(dir, key, details('My first lorry'), recording);
  assert.equal(first.title, 'The caravan');
  assert.equal(first.seconds, 61);
  assert.deepEqual(loadStories(dir, key).map((s) => s.title), ['The caravan', 'My first lorry']);

  assert.equal(changeStory(dir, key, first.id, { ...details('The caravan'), text: 'It rained all week.', audience: { kind: 'person', personId: 'a' } }), true);
  const changed = loadStories(dir, key)[0]!;
  assert.equal(changed.text, 'It rained all week.');
  assert.deepEqual(changed.audience, { kind: 'person', personId: 'a' });
  assert.equal(changed.mediaId, recording.mediaId); // the recording stays attached

  assert.equal(removeStory(dir, key, second.id)?.title, 'My first lorry');
  assert.equal(removeStory(dir, key, second.id), null);
  assert.equal(changeStory(dir, key, 'no-such-id', details('x')), false);
  assert.deepEqual(loadStories(dir, key).map((s) => s.title), ['The caravan']);
});

test('titles and words are never readable on disk', () => {
  const { dir, key } = setup();
  addStory(dir, key, { ...details('Recognisable title'), text: 'recognisable words' }, recording);
  const onDisk = readFileSync(path.join(dir, 'stories.sealed'), 'utf8');
  assert.ok(!onDisk.includes('Recognisable') && !onDisk.includes('recognisable'));
});

test('a story needs a title, and cannot be for someone who is not in the list', () => {
  assert.equal(storyProblems(details(''), [ADA]).length, 1);
  assert.deepEqual(storyProblems(details('Fine'), [ADA]), []);
  assert.deepEqual(storyProblems({ ...details('Fine'), audience: { kind: 'person', personId: 'a' } }, [ADA]), []);
  assert.equal(storyProblems({ ...details('Fine'), audience: { kind: 'person', personId: 'gone' } }, [ADA]).length, 1);
});


test('a story read back for the screen shows how many pictures it has, and nothing about where they are kept', () => {
  const { dir, key } = setup();
  const picture = { mediaId: '11111111-1111-1111-1111-111111111111', mimeType: 'image/jpeg' };
  const withPictures = addStory(dir, key, details('The old house'), recording, [picture, picture]);
  const without = addStory(dir, key, details('No pictures'), recording);
  assert.deepEqual(loadStories(dir, key)[0]!.pictures, [picture, picture]);
  assert.ok(!('pictures' in without), 'stories without pictures are stored as before');
  const shown = storyView(withPictures);
  assert.equal(shown.pictures, 2);
  assert.ok(!('mediaId' in shown) && !('mimeType' in shown));
  assert.equal(storyView(without).pictures, 0);
});
