import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  makeLinkKeys,
  makePairingToken,
  openPairRequest,
  openRecording,
  pairingCodeText,
  readPairingCode,
  receiptChecks,
  receiptFor,
  sealPairRequest,
  sealRecording,
} from '../src/core/phone-link.ts';
import { isHomeAddress } from '../src/main/inbox-server.ts';

const pc = makeLinkKeys();
const phone = makeLinkKeys();
const code = { v: 1, host: '192.168.1.20', port: 47821, pc: pc.publicKey, token: makePairingToken() };
const HEADER = { id: 'rec-0001-abcdef', recordedAt: '2026-11-14T10:00:00.000Z', prompt: 'Who taught you to ride a bike?', seconds: 42, mimeType: 'audio/webm' };
const SOUND = new Uint8Array(Buffer.from('a recognisable recording of a bike story'));

test('the pairing code reads back exactly, and anything else is not a pairing code', () => {
  assert.deepEqual(readPairingCode(pairingCodeText(code)), code);
  assert.equal(readPairingCode('https://example.com'), null);
  assert.equal(readPairingCode('echo-pair:not-json'), null);
  assert.equal(readPairingCode(pairingCodeText({ ...code, v: 2 })), null);
});

test('a pair request opens on the PC with the token and name the phone sent', () => {
  const request = sealPairRequest(phone, code, 'Dad’s phone');
  assert.ok(!JSON.stringify(request).includes(code.token), 'the token never travels in the clear');
  assert.deepEqual(openPairRequest(pc, request), { phone: phone.publicKey, token: code.token, name: 'Dad’s phone' });
  assert.equal(openPairRequest(makeLinkKeys(), request), null, 'another PC cannot open it');
  assert.equal(openPairRequest(pc, { ...request, phone: makeLinkKeys().publicKey }), null, 'nor can it be passed off as another phone');
  assert.equal(openPairRequest(pc, { ...request, box: `${request.box.slice(0, -2)}AA` }), null, 'a changed request is refused');
});

test('a recording opens only on its PC, whole and unchanged', () => {
  const envelope = sealRecording(phone, pc.publicKey, HEADER, SOUND);
  assert.ok(!envelope.includes(Buffer.from('recognisable')), 'the sound never travels in the clear');
  assert.ok(!envelope.includes(Buffer.from('bike')), 'nor does the question');
  const opened = openRecording(pc, envelope);
  assert.deepEqual(opened?.header, HEADER);
  assert.deepEqual(new Uint8Array(opened!.media), SOUND);
  assert.equal(opened?.phone, phone.publicKey);

  assert.equal(openRecording(makeLinkKeys(), envelope), null);
  const flipped = Buffer.from(envelope);
  flipped[flipped.length - 20]! ^= 1;
  assert.equal(openRecording(pc, flipped), null);
  const impostor = Buffer.from(envelope);
  Buffer.from(makeLinkKeys().publicKey, 'base64url').copy(impostor, 1);
  assert.equal(openRecording(pc, impostor), null, 'swapping in another phone’s key does not open it');
  assert.equal(openRecording(pc, Buffer.alloc(10)), null);
});

test('a receipt checks out only for the right recording between the right two devices', () => {
  const receipt = receiptFor(pc, phone.publicKey, HEADER.id);
  assert.equal(receiptChecks(phone, pc.publicKey, HEADER.id, receipt), true);
  assert.equal(receiptChecks(phone, pc.publicKey, 'rec-0002-abcdef', receipt), false);
  assert.equal(receiptChecks(phone, makeLinkKeys().publicKey, HEADER.id, receipt), false, 'a forged PC cannot make the phone delete');
  assert.equal(receiptChecks(phone, pc.publicKey, HEADER.id, 'made-up'), false);
});

test('a public key that is not a real one is refused rather than trusted', () => {
  const zero = Buffer.alloc(32).toString('base64url');
  assert.throws(() => sealRecording(phone, zero, HEADER, SOUND));
  assert.throws(() => receiptFor(pc, zero, HEADER.id));
  assert.equal(openPairRequest(pc, { ...sealPairRequest(phone, code, 'x'), phone: zero }), null);
});

test('only addresses on this computer or a home network count as home', () => {
  for (const address of ['192.168.1.5', '10.0.0.2', '172.20.1.1', '127.0.0.1', '169.254.3.4', '::1', '::ffff:192.168.0.9', 'fe80::1', 'fd12:3456::1']) {
    assert.equal(isHomeAddress(address), true, address);
  }
  for (const address of ['8.8.8.8', '172.32.0.1', '81.2.69.160', '2a00:1450::1', '::ffff:8.8.8.8', undefined, '']) {
    assert.equal(isHomeAddress(address), false, String(address));
  }
});
