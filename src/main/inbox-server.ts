// The desktop inbox: a small web server on the home network that a paired phone
// sends its recordings to. It answers home-network addresses only, refuses
// anything too big before reading it, and knows nothing about the archive: the
// routes it is given decide what each request means.

import { createServer } from 'node:http';
import type { IncomingMessage, ServerResponse } from 'node:http';

export interface InboxReply {
  status: number;
  body: Record<string, unknown>;
}

export interface InboxRoutes {
  pair(body: Buffer): InboxReply;
  receive(body: Buffer): InboxReply;
}

export interface RunningInbox {
  port: number;
  close(): Promise<void>;
}

const PAIR_LIMIT = 16 * 1024;
/** An hour of phone audio is well under this. */
export const RECORDING_LIMIT = 200 * 1024 * 1024;

/** True for an address on this computer or a home network, never one from the internet. */
export function isHomeAddress(address: string | undefined): boolean {
  if (!address) return false;
  const v4 = address.startsWith('::ffff:') ? address.slice(7) : address;
  const parts = v4.split('.').map(Number);
  if (parts.length === 4 && parts.every((part) => Number.isInteger(part) && part >= 0 && part <= 255)) {
    const [a, b] = parts as [number, number, number, number];
    return a === 10 || a === 127 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 169 && b === 254);
  }
  const v6 = address.toLowerCase();
  return v6 === '::1' || /^fe[89ab][0-9a-f]:/.test(v6) || /^f[cd][0-9a-f]{2}:/.test(v6);
}

function reply(response: ServerResponse, { status, body }: InboxReply): void {
  response.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' });
  response.end(JSON.stringify(body));
}

function readBody(request: IncomingMessage, limit: number): Promise<Buffer | null> {
  return new Promise((resolve) => {
    const declared = Number(request.headers['content-length'] ?? 0);
    if (declared > limit) {
      resolve(null);
      return;
    }
    const chunks: Buffer[] = [];
    let size = 0;
    request.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > limit) {
        request.destroy();
        resolve(null);
        return;
      }
      chunks.push(chunk);
    });
    request.on('end', () => resolve(Buffer.concat(chunks)));
    request.on('error', () => resolve(null));
  });
}

async function handle(routes: InboxRoutes, request: IncomingMessage, response: ServerResponse): Promise<void> {
  if (!isHomeAddress(request.socket.remoteAddress)) {
    reply(response, { status: 403, body: { error: 'home network only' } });
    return;
  }
  const route = `${request.method ?? ''} ${(request.url ?? '').split('?')[0]}`;
  if (route === 'GET /hello') {
    reply(response, { status: 200, body: { app: 'echo', v: 1 } });
    return;
  }
  const limit = route === 'POST /pair' ? PAIR_LIMIT : route === 'POST /recordings' ? RECORDING_LIMIT : 0;
  if (limit === 0) {
    reply(response, { status: 404, body: { error: 'not found' } });
    return;
  }
  const body = await readBody(request, limit);
  if (!body) {
    // Say no, then hang up, so a phone that is still sending learns at once
    // instead of uploading the rest for nothing.
    if (!response.headersSent && !response.destroyed) {
      response.setHeader('connection', 'close');
      response.once('finish', () => request.destroy());
      reply(response, { status: 413, body: { error: 'too big' } });
    }
    return;
  }
  try {
    reply(response, route === 'POST /pair' ? routes.pair(body) : routes.receive(body));
  } catch {
    reply(response, { status: 500, body: { error: 'Echo could not save that. The phone will try again.' } });
  }
}

/** Starts listening. Port 0 picks a free one, for tests. */
export function startInbox(routes: InboxRoutes, host: string, port: number): Promise<RunningInbox> {
  const server = createServer((request, response) => void handle(routes, request, response));
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => {
      server.off('error', reject);
      const address = server.address();
      resolve({
        port: typeof address === 'object' && address ? address.port : port,
        close: () =>
          new Promise<void>((done) => {
            server.closeAllConnections();
            server.close(() => done());
          }),
      });
    });
  });
}
