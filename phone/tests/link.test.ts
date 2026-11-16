import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeLinkKeys, makePairingToken, openPairRequest, openRecording, pairingCodeText, receiptFor, splitMedia } from '../../src/core/phone-link.ts';
import { fromBase64Url, makePhoneKeys, newRecordingId, readPairingCode, receiptChecks, sealMemory, sealPairRequest, sealRecording, toBase64, toBase64Url } from '../src/link.ts';

// The PC side is the real desktop code, so these tests prove the two speak the same language.
const pc = makeLinkKeys();
const codeText = pairingCodeText({ v: 1, host: '192.168.1.20', port: 47821, pc: pc.publicKey, token: makePairingToken() });

test('the phone reads the code the PC shows, and nothing else', () => {
  const code = readPairingCode(codeText);
  assert.equal(code?.host, '192.168.1.20');
  assert.equal(code?.pc, pc.publicKey);
  assert.equal(readPairingCode('https://example.com'), null);
  assert.equal(readPairingCode('echo-pair:bm90LWpzb24'), null);
});

test('the PC opens the phone’s pairing request and sees the same token and name', () => {
  const phone = makePhoneKeys();
  const code = readPairingCode(codeText)!;
  const opened = openPairRequest(pc, sealPairRequest(phone, code, 'Dad’s iPhone'));
  assert.deepEqual(opened, { phone: phone.publicKey, token: code.token, name: 'Dad’s iPhone' });
});

test('a recording sealed on the phone opens on the PC whole, and nowhere else', () => {
  const phone = makePhoneKeys();
  const header = { id: newRecordingId(), recordedAt: '2026-11-15T09:30:00.000Z', prompt: 'Where did you grow up?', seconds: 61, mimeType: 'audio/mp4' };
  const sound = new Uint8Array(70_000).map((_, i) => (i * 31) % 251);
  const envelope = sealRecording(phone, pc.publicKey, header, sound);
  const opened = openRecording(pc, Buffer.from(envelope));
  assert.deepEqual(opened?.header, header);
  assert.deepEqual(new Uint8Array(opened!.media), sound);
  assert.equal(opened?.phone, phone.publicKey);
  assert.equal(openRecording(makeLinkKeys(), Buffer.from(envelope)), null);
  assert.match(header.id, /^[A-Za-z0-9_-]{8,64}$/, 'the id is one the PC accepts');
});

test('the phone believes only the PC’s own receipts, for pairing and for each recording', () => {
  const phone = makePhoneKeys();
  assert.equal(receiptChecks(phone, pc.publicKey, 'rec-1', receiptFor(pc, phone.publicKey, 'rec-1')), true);
  assert.equal(receiptChecks(phone, pc.publicKey, 'paired:abc', receiptFor(pc, phone.publicKey, 'paired:abc')), true);
  assert.equal(receiptChecks(phone, pc.publicKey, 'rec-2', receiptFor(pc, phone.publicKey, 'rec-1')), false);
  assert.equal(receiptChecks(phone, pc.publicKey, 'rec-1', receiptFor(makeLinkKeys(), phone.publicKey, 'rec-1')), false, 'another PC cannot make this phone delete');
  assert.equal(receiptChecks(phone, pc.publicKey, 'rec-1', undefined), false);
});

test('a pairing code with a key that is not a real one is refused', () => {
  const phone = makePhoneKeys();
  const zero = toBase64Url(new Uint8Array(32));
  assert.throws(() => sealPairRequest(phone, { ...readPairingCode(codeText)!, pc: zero }, 'x'));
});

test('base64 helpers round-trip, including large recordings', () => {
  const big = new Uint8Array(300_000).map((_, i) => i % 256);
  assert.deepEqual(fromBase64Url(toBase64Url(big)), big);
  assert.equal(toBase64(big), Buffer.from(big).toString('base64'));
});

test('a memory with photos opens on the PC as the recording and each photo, exactly', () => {
  const phone = makePhoneKeys();
  const header = { id: newRecordingId(), recordedAt: '2026-11-15T12:00:00.000Z', prompt: '', seconds: 30, mimeType: 'audio/mp4' };
  const sound = new Uint8Array(5_000).map((_, i) => (i * 7) % 251);
  const first = { bytes: new Uint8Array(3_000).map((_, i) => (i * 13) % 251), mimeType: 'image/jpeg' };
  const second = { bytes: new Uint8Array(1_234).fill(9), mimeType: 'image/jpeg' };
  const opened = openRecording(pc, Buffer.from(sealMemory(phone, pc.publicKey, header, sound, [first, second])));
  assert.ok(opened);
  const parts = splitMedia(opened.header, opened.media);
  assert.ok(parts, 'the PC can cut it apart');
  assert.deepEqual(new Uint8Array(parts.recording), sound);
  assert.deepEqual(parts.pictures.map((picture) => [picture.mimeType, picture.bytes.length]), [['image/jpeg', 3_000], ['image/jpeg', 1_234]]);
  assert.deepEqual(new Uint8Array(parts.pictures[0]!.bytes), first.bytes);
  assert.deepEqual(new Uint8Array(parts.pictures[1]!.bytes), second.bytes);

  const plain = openRecording(pc, Buffer.from(sealMemory(phone, pc.publicKey, header, sound, [])));
  assert.equal(plain?.header.pictures, undefined, 'a memory without photos is sent exactly as before');
});
