import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { DOOR_TOOLS, MCP_VERSIONS, createDoorMcp, toolArguments } from '../src/core/door-mcp.ts';
import { openDoor, readTray, takeDoorUses, writeDoorStore } from '../src/core/door.ts';
import type { DoorStore } from '../src/shared/door.ts';

const store: DoorStore = {
  version: 1,
  writtenAt: '2026-11-13T09:00:00.000Z',
  owner: 'Ada Lovelace',
  passages: [
    { id: 'caravan', from: 'story', title: 'The caravan', context: '', text: 'We went to the caravan every summer and it always rained.', date: '2026-11-10T09:00:00.000Z' },
    { id: 'lorries', from: 'interview', title: 'Work', context: 'What did you do for a living?', text: 'I drove lorries for thirty years.', date: '2026-11-12T09:00:00.000Z' },
  ],
  characterSheet: [{ section: 'How I talk', text: 'Plain speaker' }],
  styleProfile: [],
};

function door(on = true): string {
  const folder = path.join(mkdtempSync(path.join(tmpdir(), 'echo-mcp-')), 'assistant-door');
  if (on) {
    openDoor(folder);
    writeDoorStore(folder, store);
  }
  return folder;
}

function talk(folder: string) {
  const server = createDoorMcp(folder, '1.0.0');
  const send = (message: unknown): any => {
    const answer = server.handle(typeof message === 'string' ? message : JSON.stringify(message));
    if (answer instanceof Promise) throw new Error('this message is answered later: use sendLater');
    return answer === null ? null : JSON.parse(answer);
  };
  const call = (id: number, name: string, args: Record<string, unknown> = {}) => send({ jsonrpc: '2.0', id, method: 'tools/call', params: { name, arguments: args } });
  const hello = (version = '2025-06-18') => send({ jsonrpc: '2.0', id: 0, method: 'initialize', params: { protocolVersion: version, capabilities: {}, clientInfo: { name: 'test', version: '1' } } });
  return { send, call, hello };
}

test('the handshake agrees a version this server speaks, and offers tools only', () => {
  const { hello, send } = talk(door());
  const answer = hello('2025-03-26');
  assert.deepEqual([answer.jsonrpc, answer.id, answer.result.protocolVersion], ['2.0', 0, '2025-03-26']);
  assert.deepEqual(answer.result.capabilities, { tools: {} });
  assert.deepEqual(answer.result.serverInfo, { name: 'echo-door', version: '1.0.0' });
  assert.ok(answer.result.instructions.includes('Nothing here can change the archive'));
  assert.equal(talk(door()).hello('2099-01-01').result.protocolVersion, MCP_VERSIONS[0]); // a version it does not know: it offers its newest
  assert.equal(send({ jsonrpc: '2.0', method: 'notifications/initialized' }), null); // a notification is never answered
  assert.deepEqual(send({ jsonrpc: '2.0', id: 'p', method: 'ping' }), { jsonrpc: '2.0', id: 'p', result: {} });
});

test('nothing is answered before the handshake, and the newer protocol form is turned away so the assistant falls back', () => {
  const { send, call, hello } = talk(door());
  const probe = send({ jsonrpc: '2.0', id: 1, method: 'server/discover', params: { _meta: {} } });
  assert.equal(probe.error.code, -32601);
  assert.ok(probe.error.message.includes('2025-11-25') && probe.error.message.includes('initialize'));
  assert.ok(call(2, 'echo_search', { query: 'caravan' }).error !== undefined); // no words handed over yet
  assert.ok(send({ jsonrpc: '2.0', id: 3, method: 'tools/list' }).error !== undefined);
  hello();
  assert.equal(send({ jsonrpc: '2.0', id: 4, method: 'tools/list' }).result.tools.length, 9);
  assert.equal(send({ jsonrpc: '2.0', id: 5, method: 'resources/list' }).error.code, -32601);
});

test('the tools are listed with a description and a schema; the ones that leave something say it only goes in a tray', () => {
  const { hello, send } = talk(door());
  hello();
  const tools = send({ jsonrpc: '2.0', id: 1, method: 'tools/list' }).result.tools;
  assert.deepEqual(tools.map((tool: { name: string }) => tool.name), ['echo_status', 'echo_search', 'echo_read', 'echo_sheets', 'echo_ask', 'echo_suggest_file', 'echo_suggest_words', 'echo_tray', 'echo_withdraw']);
  for (const tool of tools) assert.ok(tool.description.length > 40 && tool.inputSchema.type === 'object');
  assert.deepEqual(tools[1].inputSchema.required, ['query']);
  for (const tool of DOOR_TOOLS.filter((one) => one.name.startsWith('echo_suggest'))) assert.ok(tool.description.includes('adds nothing to the archive'));
  assert.ok(DOOR_TOOLS.every((tool) => !/add|write|delete|remove|change|set|approve/.test(tool.name))); // nothing that alters the archive, and no way to approve
});

test('tools answer from the store, as text holding JSON', () => {
  const folder = door();
  const { hello, call } = talk(folder);
  hello();
  const status = call(1, 'echo_status');
  assert.equal(status.result.isError, false);
  assert.deepEqual([JSON.parse(status.result.content[0].text).on, status.result.content[0].type], [true, 'text']);

  const found = JSON.parse(call(2, 'echo_search', { query: 'what about the --caravan in summer', limit: 1 }).result.content[0].text);
  assert.deepEqual([found.found, found.passages[0].id], [1, 'caravan']);
  const read = JSON.parse(call(3, 'echo_read', { from: 'interview' }).result.content[0].text);
  assert.deepEqual(read.passages.map((p: { id: string }) => p.id), ['lorries']);
  assert.equal(JSON.parse(call(4, 'echo_read', { id: 'caravan' }).result.content[0].text).passages[0].title, 'The caravan');
  assert.deepEqual(JSON.parse(call(5, 'echo_sheets').result.content[0].text).characterSheet, store.characterSheet);

  // A passage that is not there is the tool's own failure, which the assistant is shown.
  const missing = call(6, 'echo_read', { id: 'no-such' });
  assert.equal(missing.result.isError, true);
  // Each use is written down for Echo, without the words.
  assert.deepEqual(takeDoorUses(folder).map((use) => use.command), ['status', 'search', 'read', 'read', 'sheets']);
});

test('with the door off the tools say so; a wrong tool or wrong arguments is refused', () => {
  const { hello, call } = talk(door(false));
  hello();
  assert.equal(JSON.parse(call(1, 'echo_status').result.content[0].text).on, false);
  const refused = call(2, 'echo_search', { query: 'caravan' });
  assert.equal(refused.result.isError, true);
  assert.ok(refused.result.content[0].text.includes('door is off'));

  assert.equal(call(3, 'echo_delete_everything').error.code, -32602);
  assert.equal(call(4, 'echo_search', {}).error.code, -32602);
  assert.equal(call(5, 'echo_search', { query: 'caravan', limit: 'ten' }).error.code, -32602);
  assert.equal(call(6, 'echo_read', { from: 'diary' }).error.code, -32602);
  assert.equal(call(7, 'echo_read', { id: '--from' }).error.code, -32602);
  assert.equal(toolArguments('echo_read', { limit: 5, offset: 10 })!.join(' '), 'read --limit 5 --offset 10');
});

test('bad lines are answered as the protocol says, and never crash the server', () => {
  const { send, hello } = talk(door());
  assert.equal(send('this is not json').error.code, -32700);
  assert.equal(send({ id: 1, method: 'ping' }).error.code, -32600); // not marked as JSON-RPC 2.0
  assert.equal(send({ jsonrpc: '2.0', id: {}, method: 'ping' }).error.code, -32600);
  assert.equal(send(''), null);
  hello();
  // Several messages in one line, as older versions of the protocol allowed.
  const both = send([{ jsonrpc: '2.0', id: 1, method: 'ping' }, { jsonrpc: '2.0', method: 'notifications/initialized' }, { jsonrpc: '2.0', id: 2, method: 'tools/list' }]);
  assert.deepEqual(both.map((answer: { id: number }) => answer.id), [1, 2]);
});

test('the echo-door mcp command talks over standard input and output, one message to a line, and stops when its input closes', async () => {
  const folder = door();
  const child = spawn(process.execPath, ['--no-warnings', path.join('src', 'core', 'door-cli.ts'), 'mcp'], { env: { ...process.env, ECHO_DOOR_FOLDER: folder } });
  let out = '';
  child.stdout.on('data', (chunk: Buffer) => (out += chunk.toString('utf8')));
  const exited = new Promise<number | null>((resolve) => child.on('exit', (code) => resolve(code)));
  child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'test', version: '1' } } })}\n`);
  child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })}\n`);
  child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'echo_search', arguments: { query: 'lorries' } } })}\n`);
  child.stdin.end();
  assert.equal(await exited, 0);
  const lines = out.trim().split('\n').map((line) => JSON.parse(line));
  assert.deepEqual(lines.map((line) => line.id), [1, 2]); // every line of output is a protocol message
  assert.equal(lines[0].result.protocolVersion, '2025-11-25');
  assert.equal(JSON.parse(lines[1].result.content[0].text).passages[0].id, 'lorries');
});

test('through MCP the assistant can leave a draft whose words start with dashes, list the tray and take it back', () => {
  const folder = door();
  const { hello, call } = talk(folder);
  hello();
  const left = call(1, 'echo_suggest_words', { title: '--title is not an option here', text: '--note and other dashes are just words. We went every August.', note: 'Said on the phone on Sunday' });
  assert.equal(left.result.isError, false);
  const id = JSON.parse(left.result.content[0].text).left.id;
  const [item] = readTray(folder);
  assert.ok(item !== undefined && item.kind === 'words');
  assert.deepEqual([item.title, item.text, item.note], ['--title is not an option here', '--note and other dashes are just words. We went every August.', 'Said on the phone on Sunday']);

  assert.equal(JSON.parse(call(2, 'echo_tray').result.content[0].text).waiting, 1);
  assert.equal(call(3, 'echo_suggest_file', { path: path.join(folder, 'no-such.zip') }).result.isError, true);
  assert.equal(call(4, 'echo_suggest_file', {}).error.code, -32602);
  assert.equal(call(5, 'echo_suggest_words', { title: 'No text' }).error.code, -32602);
  assert.equal(call(6, 'echo_withdraw', { id }).result.isError, false);
  assert.equal(readTray(folder).length, 0);
});
