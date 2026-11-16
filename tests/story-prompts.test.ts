import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PROMPT_STAGES, promptsFor, relationshipKind, suggestPrompt } from '../src/shared/story-prompts.ts';
import type { Person } from '../src/shared/people.ts';

const person = (id: string, name: string, relationship: string): Person => ({
  id,
  name,
  relationship,
  callsMe: 'Dad',
  mayTalkToEcho: true,
  addedAt: '2026-11-14T00:00:00.000Z',
});
const JULIE = person('j', 'Julie', 'my wife');
const SAM = person('s', 'Sam', 'eldest son');
const DAVE = person('d', 'Dave', 'best mate');
const ROSE = person('r', 'Rose', 'granddaughter');

const all = (groups: ReturnType<typeof promptsFor>) => groups.flatMap((group) => group.prompts);

test('the deck covers a whole life with plenty to ask', () => {
  assert.ok(PROMPT_STAGES.length >= 8);
  const plain = PROMPT_STAGES.flatMap((stage) => stage.prompts).filter((prompt) => prompt.about === undefined);
  assert.ok(plain.length >= 60, `only ${plain.length} prompts that need nobody named`);
  // The same words may be asked of two kinds of people ("How did you meet {name}?"), never twice of one.
  const keys = PROMPT_STAGES.flatMap((stage) => stage.prompts.map((prompt) => `${prompt.about ?? ''}|${prompt.text}`));
  assert.equal(new Set(keys).size, keys.length, 'a prompt appears twice');
});

test('the moments Marc asked for are in the deck', () => {
  const texts = all(promptsFor([]));
  for (const moment of ['first day at school', 'ride a bike', 'learn to drive', 'first night out', 'love you lost']) {
    assert.ok(texts.some((text) => text.toLowerCase().includes(moment)), `missing: ${moment}`);
  }
});

test('named prompts are left out when there is nobody to name', () => {
  assert.ok(all(promptsFor([])).every((text) => !text.includes('{name}')));
});

test('named prompts are asked about the right people, by the relationship they typed', () => {
  const texts = all(promptsFor([JULIE, SAM, DAVE]));
  assert.ok(texts.includes('What made you sure about Julie?'));
  assert.ok(texts.includes('What do you remember about the day Sam was born?'));
  assert.ok(texts.includes('What is the funniest thing you and Dave have done?'));
  assert.ok(!texts.includes('What do you remember about the day Julie was born?'));
  assert.ok(!texts.includes('What made you sure about Sam?'));
  assert.ok(texts.includes('What do you want Rose to know about you?') === false);
  assert.ok(all(promptsFor([ROSE])).includes('What do you want Rose to know about you?'));
});

test('a grandchild is not mistaken for a child', () => {
  assert.equal(relationshipKind('granddaughter'), 'other');
  assert.equal(relationshipKind('our grandson'), 'other');
  assert.equal(relationshipKind('daughter'), 'child');
  assert.equal(relationshipKind('Husband'), 'partner');
  assert.equal(relationshipKind('neighbour'), 'friend');
  assert.equal(relationshipKind('the vicar'), 'other');
});

test('a person with no name is never put into a prompt', () => {
  assert.ok(all(promptsFor([person('x', '   ', 'wife')])).every((text) => !text.includes('  ')));
});

test('suggestions take one stage at a time in turn, and skip what has been answered', () => {
  const groups = promptsFor([]);
  const first = suggestPrompt(groups, []);
  assert.deepEqual(first, { stage: 'Childhood', text: groups[0]!.prompts[0]! });
  assert.equal(suggestPrompt(groups, [], 1)?.stage, groups[1]!.stage);
  const next = suggestPrompt(groups, [`  ${first!.text}  `]);
  assert.notEqual(next?.text, first!.text);
});

test('asking for another goes round all the open prompts and wraps', () => {
  const groups = [{ stage: 'A', prompts: ['a1', 'a2'] }, { stage: 'B', prompts: ['b1'] }];
  assert.deepEqual([0, 1, 2, 3, -1].map((turn) => suggestPrompt(groups, [], turn)?.text), ['a1', 'b1', 'a2', 'a1', 'a2']);
});

test('there is no suggestion once everything has been answered', () => {
  assert.equal(suggestPrompt([{ stage: 'A', prompts: ['a1'] }], ['a1']), null);
  assert.equal(suggestPrompt([], []), null);
});
