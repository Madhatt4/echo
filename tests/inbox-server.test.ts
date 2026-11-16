import { test } from 'node:test';
import assert from 'node:assert/strict';
import { request } from 'node:http';
import { RECORDING_LIMIT, startInbox } from '../src/main/inbox-server.ts';
import { firstHomeAddress } from '../src/main/phone-inbox.ts';

const routes = {
  pair: () => ({ status: 200, body: { route: 'pair' } }),
  receive: () => ({ status: 200, body: { route: 'receive' } }),
};

test('a recording declared too big is refused at once and the line is closed, so the phone stops sending', async () => {
  const inbox = await startInbox(routes, '127.0.0.1', 0);
  try {
    const { status, closed } = await new Promise<{ status: number; closed: Promise<boolean> }>((resolve, reject) => {
      const outgoing = request({ host: '127.0.0.1', port: inbox.port, path: '/recordings', method: 'POST', headers: { 'content-length': String(RECORDING_LIMIT + 1) } }, (response) => {
        response.resume();
        const closed = new Promise<boolean>((done) => {
          const timer = setTimeout(() => done(false), 2000);
          outgoing.socket?.once('close', () => {
            clearTimeout(timer);
            done(true);
          });
        });
        resolve({ status: response.statusCode ?? 0, closed });
      });
      outgoing.on('error', () => undefined);
      outgoing.on('timeout', () => reject(new Error('no answer')));
      // Only a sliver is ever sent and the request is never finished: the answer must not wait for the rest.
      outgoing.write(Buffer.alloc(1024));
    });
    assert.equal(status, 413);
    assert.equal(await closed, true, 'the PC hangs up rather than waiting for 200 MB it will throw away');
  } finally {
    await inbox.close();
  }
});

test('the inbox answers hello, routes by path, and knows no other route', async () => {
  const inbox = await startInbox(routes, '127.0.0.1', 0);
  try {
    const base = `http://127.0.0.1:${inbox.port}`;
    assert.deepEqual(await (await fetch(`${base}/hello`)).json(), { app: 'echo', v: 1 });
    assert.deepEqual(await (await fetch(`${base}/pair`, { method: 'POST', body: '{}' })).json(), { route: 'pair' });
    assert.deepEqual(await (await fetch(`${base}/recordings`, { method: 'POST', body: 'x' })).json(), { route: 'receive' });
    assert.equal((await fetch(`${base}/anything-else`)).status, 404);
    assert.equal((await fetch(`${base}/pair`, { method: 'POST', body: Buffer.alloc(17 * 1024) })).status, 413);
  } finally {
    await inbox.close();
  }
});

test('the QR code carries the Wi-Fi address, never a 169.254 placeholder from Tailscale or a VPN', () => {
  const nic = (address: string, internal = false) => ({ address, internal, family: 'IPv4' as const, netmask: '255.255.255.0', mac: '00:00:00:00:00:00', cidr: null });
  assert.equal(firstHomeAddress({ Tailscale: [nic('169.254.10.20')], WiFi: [nic('192.168.1.50')] }), '192.168.1.50');
  assert.equal(firstHomeAddress({ 'vEthernet (WSL)': [nic('172.20.0.1')], Ethernet: [nic('10.0.0.5')] }), '10.0.0.5');
  assert.equal(firstHomeAddress({ Loopback: [nic('127.0.0.1', true)], Tailscale: [nic('169.254.1.1')], Cellular: [nic('100.64.3.2')] }), null);
});
