// The phone's side of the link to the Echo PC. It must match
// src/core/phone-link.ts on the PC byte for byte: the tests in
// phone/tests/link.test.ts run both against each other.
//
// Everything is done with the audited noble libraries rather than WebCrypto,
// so it behaves the same on every iPhone the app supports and in the tests.

import { gcm } from '@noble/ciphers/aes.js';
import { x25519 } from '@noble/curves/ed25519.js';
import { hkdf } from '@noble/hashes/hkdf.js';
import { hmac } from '@noble/hashes/hmac.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { randomBytes, utf8ToBytes } from '@noble/hashes/utils.js';

export const LINK_VERSION = 1;
const SALT_BYTES = 32;
const NONCE_BYTES = 12;

/** This phone's long-term keys, both raw and base64url. */
export interface PhoneKeys {
  publicKey: string;
  secretKey: string;
}

/** What the QR code on the PC carries. */
export interface PairingCode {
  v: number;
  host: string;
  port: number;
  pc: string;
  token: string;
}

export interface PairRequest {
  v: number;
  phone: string;
  salt: string;
  nonce: string;
  box: string;
}

export interface RecordingHeader {
  id: string;
  recordedAt: string;
  prompt: string;
  seconds: number;
  mimeType: string;
  /** Pictures that go with the recording. Their bytes follow the recording's, in this order. */
  pictures?: { mimeType: string; bytes: number }[];
}

/** A photo going with a memory, ready to seal. */
export interface Picture {
  bytes: Uint8Array;
  mimeType: string;
}

export function toBase64Url(bytes: Uint8Array): string {
  let text = '';
  for (let i = 0; i < bytes.length; i += 0x8000) text += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(text).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function fromBase64Url(text: string): Uint8Array {
  const plain = atob(text.replace(/-/g, '+').replace(/_/g, '/'));
  const bytes = new Uint8Array(plain.length);
  for (let i = 0; i < plain.length; i += 1) bytes[i] = plain.charCodeAt(i);
  return bytes;
}

/** Plain base64, which is what the phone's file store and native HTTP take. */
export function toBase64(bytes: Uint8Array): string {
  const url = toBase64Url(bytes).replace(/-/g, '+').replace(/_/g, '/');
  return url + '='.repeat((4 - (url.length % 4)) % 4);
}

const isKey = (raw: unknown): raw is string => typeof raw === 'string' && /^[A-Za-z0-9_-]{43}$/.test(raw);

export function makePhoneKeys(): PhoneKeys {
  const secret = x25519.utils.randomSecretKey();
  return { publicKey: toBase64Url(x25519.getPublicKey(secret)), secretKey: toBase64Url(secret) };
}

/** The secret both sides can work out, or null for a key that is not a usable one. */
function sharedSecret(own: PhoneKeys, peerPublic: string): Uint8Array | null {
  if (!isKey(peerPublic)) return null;
  try {
    const secret = x25519.getSharedSecret(fromBase64Url(own.secretKey), fromBase64Url(peerPublic));
    return secret.every((byte) => byte === 0) ? null : secret;
  } catch {
    return null;
  }
}

const derive = (secret: Uint8Array, salt: Uint8Array, purpose: string): Uint8Array =>
  hkdf(sha256, secret, salt, utf8ToBytes(`echo/phone-link/v1/${purpose}`), 32);

/** Reads the text of a scanned QR code. Null for anything that is not an Echo pairing code. */
export function readPairingCode(text: string): PairingCode | null {
  if (!text.startsWith('echo-pair:')) return null;
  try {
    const code = JSON.parse(new TextDecoder().decode(fromBase64Url(text.slice('echo-pair:'.length)))) as PairingCode;
    const fair = code.v === LINK_VERSION && isKey(code.pc) && typeof code.token === 'string' && typeof code.host === 'string' && Number.isInteger(code.port);
    return fair ? code : null;
  } catch {
    return null;
  }
}

export function sealPairRequest(phone: PhoneKeys, code: PairingCode, name: string): PairRequest {
  const secret = sharedSecret(phone, code.pc);
  if (!secret) throw new Error('That is not an Echo pairing code.');
  const salt = randomBytes(SALT_BYTES);
  const nonce = randomBytes(NONCE_BYTES);
  const box = gcm(derive(secret, salt, 'pair'), nonce, utf8ToBytes(phone.publicKey)).encrypt(utf8ToBytes(JSON.stringify({ token: code.token, name })));
  return { v: LINK_VERSION, phone: phone.publicKey, salt: toBase64Url(salt), nonce: toBase64Url(nonce), box: toBase64Url(box) };
}

/** One sealed envelope: version | phone key | salt | nonce | sealed (header length, header, recording). */
export function sealRecording(phone: PhoneKeys, pcPublic: string, header: RecordingHeader, media: Uint8Array): Uint8Array {
  const secret = sharedSecret(phone, pcPublic);
  if (!secret) throw new Error('That is not a paired PC.');
  const salt = randomBytes(SALT_BYTES);
  const nonce = randomBytes(NONCE_BYTES);
  const publicKey = fromBase64Url(phone.publicKey);
  const head = new Uint8Array(1 + publicKey.length + SALT_BYTES + NONCE_BYTES);
  head.set([LINK_VERSION], 0);
  head.set(publicKey, 1);
  head.set(salt, 1 + publicKey.length);
  head.set(nonce, 1 + publicKey.length + SALT_BYTES);
  const headerBytes = utf8ToBytes(JSON.stringify(header));
  const plain = new Uint8Array(4 + headerBytes.length + media.length);
  new DataView(plain.buffer).setUint32(0, headerBytes.length);
  plain.set(headerBytes, 4);
  plain.set(media, 4 + headerBytes.length);
  const sealed = gcm(derive(secret, salt, 'recording'), nonce, head).encrypt(plain);
  const envelope = new Uint8Array(head.length + sealed.length);
  envelope.set(head, 0);
  envelope.set(sealed, head.length);
  return envelope;
}

/** Seals a memory with any photos that go with it: the photos' bytes follow the recording's, listed in the header so the PC can cut them apart. */
export function sealMemory(phone: PhoneKeys, pcPublic: string, header: RecordingHeader, recording: Uint8Array, pictures: readonly Picture[]): Uint8Array {
  if (pictures.length === 0) return sealRecording(phone, pcPublic, header, recording);
  const media = new Uint8Array(recording.length + pictures.reduce((total, picture) => total + picture.bytes.length, 0));
  media.set(recording, 0);
  let at = recording.length;
  for (const picture of pictures) {
    media.set(picture.bytes, at);
    at += picture.bytes.length;
  }
  const listed = pictures.map((picture) => ({ mimeType: picture.mimeType, bytes: picture.bytes.length }));
  return sealRecording(phone, pcPublic, { ...header, pictures: listed }, media);
}

/** True only for a receipt the paired PC made for this id. The phone deletes nothing without one. */
export function receiptChecks(phone: PhoneKeys, pcPublic: string, id: string, receipt: unknown): boolean {
  const secret = sharedSecret(phone, pcPublic);
  if (!secret || typeof receipt !== 'string') return false;
  const expected = toBase64Url(hmac(sha256, derive(secret, new Uint8Array(0), 'receipt'), utf8ToBytes(`saved:${id}`)));
  if (expected.length !== receipt.length) return false;
  let difference = 0;
  for (let i = 0; i < expected.length; i += 1) difference |= expected.charCodeAt(i) ^ receipt.charCodeAt(i);
  return difference === 0;
}

/** A recording id the PC accepts: letters, digits, dashes, 8 to 64 long. */
export function newRecordingId(): string {
  return `rec-${toBase64Url(randomBytes(18))}`;
}
