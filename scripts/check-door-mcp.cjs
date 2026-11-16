// Used only by the automated check of the installed app: starts the installed
// echo-door as an MCP server the way an assistant would, and has a short
// conversation with it.
//
//   node scripts/check-door-mcp.cjs <path to Echo.exe> <door folder>
const { spawn } = require('node:child_process');
const path = require('node:path');

const [exe, folder] = process.argv.slice(2);
if (!exe || !folder) {
  console.error('usage: node scripts/check-door-mcp.cjs <Echo.exe> <door folder>');
  process.exit(2);
}
const script = path.join(path.dirname(exe), 'resources', 'app.asar', 'dist', 'core', 'door-cli.js');
const child = spawn(exe, [script, 'mcp'], { env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', ECHO_DOOR_FOLDER: folder } });
let out = '';
let err = '';
child.stdout.on('data', (chunk) => (out += chunk.toString('utf8')));
child.stderr.on('data', (chunk) => (err += chunk.toString('utf8')));
const fail = (why) => {
  console.error(`MCP CHECK FAILED: ${why}\nstdout: ${out}\nstderr: ${err}`);
  process.exit(1);
};
const timer = setTimeout(() => fail('the server did not stop within 30 seconds of its input closing'), 30000);
child.on('error', (error) => fail(`could not start: ${error.message}`));
child.on('exit', (code) => {
  clearTimeout(timer);
  if (code !== 0) fail(`stopped with exit code ${code}`);
  let lines;
  try {
    lines = out.trim().split(/\r?\n/).map((line) => JSON.parse(line));
  } catch {
    return fail('something that is not a protocol message was written to standard output');
  }
  if (lines.length !== 3) return fail(`expected 3 answers, got ${lines.length}`);
  if (lines[0].result?.serverInfo?.name !== 'echo-door') return fail('the handshake did not name the server');
  if (lines[1].result?.tools?.length !== 9) return fail('the nine tools were not listed');
  const found = JSON.parse(lines[2].result?.content?.[0]?.text ?? '{}');
  if (found.found !== 1 || found.passages?.[0]?.id !== 'p1') return fail('echo_search did not find the passage');
  console.log(`MCP OK: the installed echo-door spoke MCP ${lines[0].result.protocolVersion}, listed 9 tools and searched a store`);
});
const send = (message) => child.stdin.write(`${JSON.stringify(message)}\n`);
send({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'check', version: '1' } } });
send({ jsonrpc: '2.0', method: 'notifications/initialized' });
send({ jsonrpc: '2.0', id: 2, method: 'tools/list' });
send({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'echo_search', arguments: { query: 'caravan summer' } } });
child.stdin.end();
