import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkAnthropicKey } from '../src/core/anthropic.ts';
import type { FetchLike } from '../src/core/anthropic.ts';

const answering = (status: number): FetchLike => async () => ({ status });

test('a key Anthropic accepts passes', async () => {
  assert.deepEqual(await checkAnthropicKey('sk-ant-good', answering(200)), { ok: true });
});

test('the key is sent to Anthropic only, in the right header, with surrounding spaces removed', async () => {
  const seen: { url: string; headers: Record<string, string> }[] = [];
  const spy: FetchLike = async (url, init) => {
    seen.push({ url, headers: init.headers });
    return { status: 200 };
  };
  await checkAnthropicKey('  sk-ant-good\n', spy);
  assert.equal(seen.length, 1);
  assert.equal(seen[0]!.url, 'https://api.anthropic.com/v1/models');
  assert.equal(seen[0]!.headers['x-api-key'], 'sk-ant-good');
  assert.ok(seen[0]!.headers['anthropic-version']);
});

test('nothing is sent when the key is blank or has a break in the middle', async () => {
  let called = 0;
  const spy: FetchLike = async () => {
    called += 1;
    return { status: 200 };
  };
  assert.equal((await checkAnthropicKey('   ', spy)).ok, false);
  assert.equal((await checkAnthropicKey('sk-ant-go od', spy)).ok, false);
  assert.equal(called, 0);
});

test('a rejected key is explained, with a hint when it does not look like an Anthropic key', async () => {
  const rejected = await checkAnthropicKey('sk-ant-bad', answering(401));
  assert.equal(rejected.ok, false);
  assert.ok(!rejected.ok && rejected.problem.includes('did not accept'));
  assert.ok(!rejected.ok && !rejected.problem.includes('start with'));
  const wrongKind = await checkAnthropicKey('sk-proj-something', answering(401));
  assert.ok(!wrongKind.ok && wrongKind.problem.includes('start with sk-ant-'));
});

test('each other failure gets its own plain-English reason', async () => {
  const problems = new Set<string>();
  for (const status of [403, 429, 500, 529, 418]) {
    const result = await checkAnthropicKey('sk-ant-x', answering(status));
    assert.equal(result.ok, false);
    if (!result.ok) problems.add(result.problem);
  }
  assert.equal(problems.size, 4); // 500 and 529 share one reason
});

test('being offline is reported as that, not as a bad key', async () => {
  const offline: FetchLike = async () => {
    throw new Error('getaddrinfo ENOTFOUND');
  };
  const result = await checkAnthropicKey('sk-ant-x', offline);
  assert.ok(!result.ok && result.problem.includes('could not reach'));
});

test('the reason never repeats the key back', async () => {
  for (const status of [401, 403, 429, 500, 418]) {
    const result = await checkAnthropicKey('sk-ant-secret-value', answering(status));
    assert.ok(!result.ok && !result.problem.includes('secret-value'));
  }
});
