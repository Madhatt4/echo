import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PREFERRED_MODEL, askClaude, chooseModel } from '../src/core/anthropic.ts';
import type { FetchLike } from '../src/core/anthropic.ts';
import {
  INTERVIEW_TOPICS,
  SKIPPED,
  interviewMessages,
  interviewerInstructions,
  readInterviewerReply,
} from '../src/shared/interview.ts';
import type { Person } from '../src/shared/people.ts';

const ADA: Person = { id: 'a', name: 'Ada', relationship: 'my daughter', callsMe: 'Dad', mayTalkToEcho: true, addedAt: '2026-11-11T00:00:00.000Z' };
const TOPIC = INTERVIEW_TOPICS[0]!;
const REQUEST = { system: 'be an interviewer', messages: [{ role: 'user' as const, content: 'Please begin.' }], maxTokens: 300 };

test('every topic in the spec is there, each with an opening question and an aim', () => {
  assert.equal(INTERVIEW_TOPICS.length, 12);
  assert.equal(new Set(INTERVIEW_TOPICS.map((t) => t.id)).size, 12);
  for (const topic of INTERVIEW_TOPICS) {
    assert.ok(topic.opening.endsWith('?') || topic.opening.endsWith('.'), topic.id);
    assert.ok(topic.aim.length > 30, topic.id);
  }
});

test('the interviewer is told its rules, the topic, and who the family are', () => {
  const text = interviewerInstructions(TOPIC, 'Marc Hatton', [ADA]);
  assert.ok(text.includes('Marc Hatton'));
  assert.ok(text.includes(TOPIC.title) && text.includes(TOPIC.aim));
  assert.ok(text.includes('Ada (my daughter), who calls them "Dad"'));
  assert.ok(text.includes('One question at a time') || text.includes('one question at a time'));
  assert.ok(text.includes('never state or assume a fact'));
  assert.ok(text.includes('{"done": true, "question": ""}'));
  assert.ok(interviewerInstructions(TOPIC, null, []).includes('Nobody has been named yet'));
});

test('the conversation sent to Claude starts with the person, alternates, and carries a skip', () => {
  const exchanges = [{ question: 'Where did you grow up?', answer: 'Luton.', answeredAt: '', spoken: false }];
  const messages = interviewMessages(exchanges, 'What was school like?');
  assert.deepEqual(messages.map((m) => m.role), ['user', 'assistant', 'user', 'assistant', 'user']);
  assert.equal(messages[2]!.content, 'Luton.');
  assert.ok(messages[3]!.content.includes('What was school like?'));
  assert.equal(messages[4]!.content, SKIPPED);
  assert.deepEqual(interviewMessages([], null).map((m) => m.role), ['user']);
});

test('the interviewer\'s reply is read whether it is tidy JSON, wrapped JSON, or plain words', () => {
  assert.deepEqual(readInterviewerReply('{"done": false, "question": "And then?"}'), { done: false, question: 'And then?' });
  assert.deepEqual(readInterviewerReply('```json\n{"done": false, "question": " And then? "}\n```'), { done: false, question: 'And then?' });
  assert.deepEqual(readInterviewerReply('{"done": true, "question": ""}'), { done: true, question: '' });
  assert.deepEqual(readInterviewerReply('What did your mum say?'), { done: false, question: 'What did your mum say?' });
  assert.equal(readInterviewerReply('{"done": false, "question": ""}'), null);
  assert.equal(readInterviewerReply('   '), null);
});

const reply = (status: number, json: unknown = {}) => ({ status, json: async () => json });

test('a question goes to Claude with the key, the model and the conversation, and the words come back', async () => {
  const seen: { url: string; headers: Record<string, string>; body: Record<string, unknown> }[] = [];
  const fake: FetchLike = async (url, init) => {
    seen.push({ url, headers: init.headers, body: JSON.parse(init.body ?? '{}') as Record<string, unknown> });
    return reply(200, { content: [{ type: 'text', text: ' {"done": false, "question": "Go on?"} ' }] });
  };
  const answer = await askClaude('sk-ant-key', REQUEST, PREFERRED_MODEL, fake);
  assert.deepEqual(answer, { ok: true, text: '{"done": false, "question": "Go on?"}', model: PREFERRED_MODEL });
  assert.equal(seen[0]!.url, 'https://api.anthropic.com/v1/messages');
  assert.equal(seen[0]!.headers['x-api-key'], 'sk-ant-key');
  assert.equal(seen[0]!.body.model, PREFERRED_MODEL);
  assert.equal(seen[0]!.body.system, 'be an interviewer');
  assert.equal(seen[0]!.body.max_tokens, 300);
});

test('if the key cannot use the preferred model, the newest Sonnet it can use is tried once', async () => {
  const models: string[] = [];
  const fake: FetchLike = async (url, init) => {
    if (url.endsWith('/models')) {
      return reply(200, { data: [{ id: 'claude-haiku-9', created_at: '2027-01-01' }, { id: 'claude-sonnet-8', created_at: '2026-06-01' }, { id: 'claude-sonnet-7', created_at: '2026-01-01' }] });
    }
    const model = String((JSON.parse(init.body ?? '{}') as { model?: unknown }).model);
    models.push(model);
    return model === PREFERRED_MODEL ? reply(404, { error: { message: 'model not found' } }) : reply(200, { content: [{ type: 'text', text: 'Hello?' }] });
  };
  assert.deepEqual(await askClaude('k', REQUEST, PREFERRED_MODEL, fake), { ok: true, text: 'Hello?', model: 'claude-sonnet-8' });
  assert.deepEqual(models, [PREFERRED_MODEL, 'claude-sonnet-8']);
  assert.equal(chooseModel([]), null);
  assert.equal(chooseModel([{ id: 'x', created_at: '2026' }, { id: PREFERRED_MODEL, created_at: '2025' }]), PREFERRED_MODEL);
  assert.equal(chooseModel([{ id: 'claude-opus-1', created_at: '2026' }]), 'claude-opus-1');
});

test('every way it can fail gives a reason a person can act on, and never the key', async () => {
  const cases: [number, unknown, string][] = [
    [400, { error: { message: 'Your credit balance is too low to access the Anthropic API.' } }, 'run out of credit'],
    [401, {}, 'no longer accepts'],
    [403, {}, 'will not let'],
    [429, {}, 'limiting requests'],
    [529, {}, 'trouble at its end'],
    [418, {}, 'did not expect'],
  ];
  for (const [status, json, expected] of cases) {
    const answer = await askClaude('sk-ant-secret-value', REQUEST, PREFERRED_MODEL, async () => reply(status, json));
    assert.ok(!answer.ok && answer.problem.includes(expected), `${status}: ${JSON.stringify(answer)}`);
    assert.ok(!answer.ok && !answer.problem.includes('secret-value'));
  }
  const offline = await askClaude('k', REQUEST, PREFERRED_MODEL, async () => {
    throw new Error('ENOTFOUND');
  });
  assert.ok(!offline.ok && offline.problem.includes('could not reach'));
  const empty = await askClaude('k', REQUEST, PREFERRED_MODEL, async () => reply(200, { content: [] }));
  assert.ok(!empty.ok);
  const noModel = await askClaude('k', REQUEST, PREFERRED_MODEL, async () => reply(404, {}));
  assert.ok(!noModel.ok && noModel.problem.includes('cannot use any Claude model'));
});
