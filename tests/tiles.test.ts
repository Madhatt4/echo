import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TILES, statusLabel, nextStep } from '../src/shared/tiles.ts';

test('every tile has a unique id', () => {
  const ids = TILES.map((t) => t.id);
  assert.equal(new Set(ids).size, ids.length);
});

test('every tile has a title, a description and a build step from the plan', () => {
  for (const tile of TILES) {
    assert.ok(tile.title.length > 0, `${tile.id} has no title`);
    assert.ok(tile.description.length > 0, `${tile.id} has no description`);
    assert.ok(
      Number.isInteger(tile.arrivesAtStep) && tile.arrivesAtStep >= 2 && tile.arrivesAtStep <= 22,
      `${tile.id} points at step ${tile.arrivesAtStep}, which is not in the plan`,
    );
  }
});

test('every tile has been built and says so', () => {
  assert.deepEqual(TILES.filter((t) => !t.ready).map((t) => t.id), []);
});

test('consent comes before every capture tile on the home screen', () => {
  const order = TILES.map((t) => t.id);
  const consent = order.indexOf('consent');
  for (const id of ['stories', 'face', 'voice', 'interview', 'advice', 'messages'] as const) {
    assert.ok(consent < order.indexOf(id), `consent must come before ${id}`);
  }
});

test('status label says which step switches a tile on', () => {
  const tile = TILES.find((t) => t.id === 'messages');
  assert.ok(tile);
  assert.equal(statusLabel({ ...tile, ready: false }), 'Arrives at build step 15');
  assert.equal(statusLabel(tile), 'Ready');
  assert.equal(statusLabel(tile, 'Half done'), 'Half done');
});

test('the next thing to do follows what depends on what: consent, the AI key, some words, then talking', () => {
  assert.deepEqual([nextStep({ consent: 'none', aiKeySaved: true, passages: 9 }).id, nextStep({ consent: 'none', aiKeySaved: true, passages: 9 }).opens], ['consent', 'consent']);
  assert.deepEqual([nextStep({ consent: 'withdrawn', aiKeySaved: true, passages: 9 }).id, nextStep({ consent: 'withdrawn', aiKeySaved: true, passages: 9 }).opens], ['consent-again', 'consent']);
  assert.deepEqual([nextStep({ consent: 'given', aiKeySaved: false, passages: 9 }).id, nextStep({ consent: 'given', aiKeySaved: false, passages: 9 }).opens], ['ai-key', 'setup']);
  assert.deepEqual([nextStep({ consent: 'given', aiKeySaved: true, passages: 0 }).id, nextStep({ consent: 'given', aiKeySaved: true, passages: 0 }).opens], ['words', 'interview']);
  assert.deepEqual([nextStep({ consent: 'given', aiKeySaved: true, passages: 3 }).id, nextStep({ consent: 'given', aiKeySaved: true, passages: 3 }).opens], ['talk', 'chat']);
});
