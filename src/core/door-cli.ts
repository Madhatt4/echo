// The echo-door command. Run by the assistant, not by Echo: it reads the
// door's own store and answers. It opens no network port and cannot reach the
// archive.
//
//   echo-door <command>   answers once, in JSON, and stops
//   echo-door mcp         stays running as an MCP server on standard input and output

import { createInterface } from 'node:readline';
import { DOOR_HELP, defaultDoorFolder, runDoorCommandAsync } from './door-commands.ts';
import { createDoorMcp } from './door-mcp.ts';
import { DOOR_VERSION } from './door-version.ts';

const args = process.argv.slice(2);

if (args[0] === 'mcp') {
  const server = createDoorMcp(defaultDoorFolder(), DOOR_VERSION);
  const lines = createInterface({ input: process.stdin, crlfDelay: Infinity });
  // A question to the echo takes a while. The server stops only once every answer still owed has been sent.
  let owed = 0;
  let closed = false;
  const stopIfDone = () => {
    if (closed && owed === 0) process.exit(0);
  };
  lines.on('line', (line) => {
    owed += 1;
    void Promise.resolve(server.handle(line))
      .then((answer) => {
        // Nothing but protocol messages may go to standard output, one to a line.
        if (answer !== null) process.stdout.write(`${answer}\n`);
      })
      .finally(() => {
        owed -= 1;
        stopIfDone();
      });
  });
  // The assistant closing its end is the signal to stop.
  lines.on('close', () => {
    closed = true;
    stopIfDone();
  });
} else {
  // Words to leave in the tray can come on standard input, so that a long draft does not have to fit on a command line.
  const wordsGiven = args.slice(1).some((arg, index, rest) => !arg.startsWith('--') && !(rest[index - 1] ?? '').startsWith('--'));
  const wantsInput = !process.stdin.isTTY && ((args[0] === 'suggest-words' && !args.includes('--text')) || (args[0] === 'ask' && !wordsGiven));
  const finish = (input: string) => {
    void runDoorCommandAsync(args, defaultDoorFolder(), input).then((answer) => {
      process.stdout.write(`${answer.output === DOOR_HELP ? DOOR_HELP : JSON.stringify(answer.output, null, 2)}\n`);
      process.exitCode = answer.exit;
    });
  };
  if (wantsInput) {
    const pieces: Buffer[] = [];
    process.stdin.on('data', (piece: Buffer) => pieces.push(piece));
    process.stdin.on('end', () => finish(Buffer.concat(pieces).toString('utf8')));
  } else {
    finish('');
  }
}
