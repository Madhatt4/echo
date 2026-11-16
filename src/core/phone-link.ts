// The link between the Echo phone app and this PC.
//
// Pairing happens once, by scanning a QR code on the PC. The code carries the
// PC's public key and a one-time token, so the phone knows which PC it is
// talking to and the PC knows the phone saw its screen. After that, each
// recording is encrypted on the phone for this PC alone, with a key worked out
// from the two devices' keys (X25519, HKDF-SHA256, AES-256-GCM). The PC answers
// with a receipt only it could make, and the phone deletes its copy only on a
// receipt that checks out.
//
// Nothing here needs TLS: the home network sees only sealed bytes. The phone
// never holds the archive's key.

import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  createPrivateKey,
  createPublicKey,
  diffieHellman,
  generateKeyPairSync,
  hkdfSync,
  randomBytes,
  timingSafeEqual,
} from 'node:crypto';

export const LINK_VERSION = 1;
/** The port the PC listens on. Fixed, so a paired phone can find it again. */
export const INBOX_PORT = 47821;
const KEY_BYTES = 32;
const SALT_BYTES = 32;
const NONCE_BYTES = 12;
const TAG_BYTES = 16;
const HEAD_BYTES = 1 + KEY_BYTES + SALT_BYTES + NONCE_BYTES;

/** A device's long-term keys: the public key raw and base64url, the private key as PKCS#8, base64. */
export interface LinkKeys {
  publicKey: string;
  privateKey: string;
}

/** What the QR code carries. */
export interface PairingCode {
  v: number;
  host: string;
  port: number;
  /** The PC's public key. */
  pc: string;
  token: string;
}

/** What a phone sends to pair, sealed for the PC. */
export interface PairRequest {
  v: number;
  phone: string;
  salt: string;
  nonce: string;
  box: string;
}

/** What travels with each recording, inside the sealed envelope. */
export interface RecordingHeader {
  /** Made by the phone, so a recording sent twice is saved once. */
  id: string;
  recordedAt: string;
  prompt: string;
  seconds: number;
  mimeType: string;
  /** Pictures that go with the recording. Their bytes follow the recording's, in this order. */
  pictures?: RecordingPicture[];
}

export interface RecordingPicture {
  mimeType: string;
  /** How many of the bytes after the recording belong to this picture. */
  bytes: number;
}

/**
 * Cuts what arrived into the recording and the pictures that follow it.
 * Null when the header's sizes do not add up, so nothing half-read is filed.
 */
export function splitMedia(header: RecordingHeader, media: Buffer): { recording: Buffer; pictures: { bytes: Buffer; mimeType: string }[] } | null {
  const listed = header.pictures ?? [];
  if (!Array.isArray(listed)) return null;
  let pictureBytes = 0;
  for (const picture of listed) {
    if (typeof picture?.mimeType !== 'string' || !Number.isSafeInteger(picture.bytes) || picture.bytes <= 0) return null;
    pictureBytes += picture.bytes;
  }
  const recordingBytes = media.length - pictureBytes;
  if (recordingBytes <= 0) return null;
  let at = recordingBytes;
  const pictures = listed.map((picture) => {
    const bytes = media.subarray(at, at + picture.bytes);
    at += picture.bytes;
    return { bytes, mimeType: picture.mimeType };
  });
  return { recording: media.subarray(0, recordingBytes), pictures };
}

export function makeLinkKeys(): LinkKeys {
  const { publicKey, privateKey } = generateKeyPairSync('x25519');
  const jwk = publicKey.export({ format: 'jwk' });
  return {
    publicKey: String(jwk.x),
    privateKey: privateKey.export({ format: 'der', type: 'pkcs8' }).toString('base64'),
  };
}

function isKey(raw: string): boolean {
  return /^[A-Za-z0-9_-]{43}$/.test(raw);
}

/** The secret both sides can work out, or null for a key that is not a usable X25519 key. */
function sharedSecret(own: LinkKeys, peerPublic: string): Buffer | null {
  if (!isKey(peerPublic)) return null;
  try {
    const secret = diffieHellman({
      privateKey: createPrivateKey({ key: Buffer.from(own.privateKey, 'base64'), format: 'der', type: 'pkcs8' }),
      publicKey: createPublicKey({ key: { kty: 'OKP', crv: 'X25519', x: peerPublic }, format: 'jwk' }),
    });
    // A low-order public key gives all zeros, which anyone could work out.
    return secret.every((byte) => byte === 0) ? null : secret;
  } catch {
    return null;
  }
}

function derive(secret: Buffer, salt: Buffer, purpose: string): Buffer {
  return Buffer.from(hkdfSync('sha256', secret, salt, `echo/phone-link/v1/${purpose}`, 32));
}

function encrypt(key: Buffer, nonce: Buffer, aad: Buffer, plain: Buffer): Buffer {
  const cipher = createCipheriv('aes-256-gcm', key, nonce);
  cipher.setAAD(aad);
  return Buffer.concat([cipher.update(plain), cipher.final(), cipher.getAuthTag()]);
}

function decrypt(key: Buffer, nonce: Buffer, aad: Buffer, sealed: Buffer): Buffer | null {
  if (sealed.length < TAG_BYTES) return null;
  try {
    const decipher = createDecipheriv('aes-256-gcm', key, nonce);
    decipher.setAAD(aad);
    decipher.setAuthTag(sealed.subarray(sealed.length - TAG_BYTES));
    return Buffer.concat([decipher.update(sealed.subarray(0, sealed.length - TAG_BYTES)), decipher.final()]);
  } catch {
    return null;
  }
}

export function makePairingToken(): string {
  return randomBytes(32).toString('base64url');
}

/** The text the QR code holds. */
export function pairingCodeText(code: PairingCode): string {
  return `echo-pair:${Buffer.from(JSON.stringify(code), 'utf8').toString('base64url')}`;
}

export function readPairingCode(text: string): PairingCode | null {
  if (!text.startsWith('echo-pair:')) return null;
  try {
    const code = JSON.parse(Buffer.from(text.slice('echo-pair:'.length), 'base64url').toString('utf8')) as PairingCode;
    return code.v === LINK_VERSION && isKey(code.pc) && typeof code.token === 'string' ? code : null;
  } catch {
    return null;
  }
}

/** The phone's side of pairing. Here for tests and as the reference for the phone app. */
export function sealPairRequest(phone: LinkKeys, code: PairingCode, name: string): PairRequest {
  const secret = sharedSecret(phone, code.pc);
  if (!secret) throw new Error('That is not an Echo pairing code.');
  const salt = randomBytes(SALT_BYTES);
  const nonce = randomBytes(NONCE_BYTES);
  const box = encrypt(derive(secret, salt, 'pair'), nonce, Buffer.from(phone.publicKey, 'utf8'), Buffer.from(JSON.stringify({ token: code.token, name }), 'utf8'));
  return { v: LINK_VERSION, phone: phone.publicKey, salt: salt.toString('base64url'), nonce: nonce.toString('base64url'), box: box.toString('base64url') };
}

/** The PC's side of pairing: the phone's key, name and the token it saw, or null if the request does not open. */
export function openPairRequest(pc: LinkKeys, request: PairRequest): { phone: string; token: string; name: string } | null {
  if (request?.v !== LINK_VERSION || typeof request.phone !== 'string') return null;
  const secret = sharedSecret(pc, request.phone);
  if (!secret) return null;
  const salt = Buffer.from(String(request.salt), 'base64url');
  const nonce = Buffer.from(String(request.nonce), 'base64url');
  if (salt.length !== SALT_BYTES || nonce.length !== NONCE_BYTES) return null;
  const plain = decrypt(derive(secret, salt, 'pair'), nonce, Buffer.from(request.phone, 'utf8'), Buffer.from(String(request.box), 'base64url'));
  if (!plain) return null;
  try {
    const { token, name } = JSON.parse(plain.toString('utf8')) as { token: unknown; name: unknown };
    if (typeof token !== 'string' || typeof name !== 'string') return null;
    return { phone: request.phone, token, name };
  } catch {
    return null;
  }
}

/** True when the token matches, compared in constant time. */
export function sameToken(given: string, expected: string): boolean {
  const a = Buffer.from(given, 'utf8');
  const b = Buffer.from(expected, 'utf8');
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * The phone's side of sending: one sealed envelope holding the header and the recording.
 * Layout: version (1) | phone public key (32) | salt (32) | nonce (12) | sealed body.
 */
export function sealRecording(phone: LinkKeys, pcPublic: string, header: RecordingHeader, media: Uint8Array): Buffer {
  const secret = sharedSecret(phone, pcPublic);
  if (!secret) throw new Error('That is not a paired PC.');
  const salt = randomBytes(SALT_BYTES);
  const nonce = randomBytes(NONCE_BYTES);
  const head = Buffer.concat([Buffer.from([LINK_VERSION]), Buffer.from(phone.publicKey, 'base64url'), salt, nonce]);
  const headerBytes = Buffer.from(JSON.stringify(header), 'utf8');
  const length = Buffer.alloc(4);
  length.writeUInt32BE(headerBytes.length);
  return Buffer.concat([head, encrypt(derive(secret, salt, 'recording'), nonce, head, Buffer.concat([length, headerBytes, media]))]);
}

/** Which phone an envelope says it is from, before anything is opened. */
export function envelopeSender(envelope: Buffer): string | null {
  if (envelope.length < HEAD_BYTES + TAG_BYTES || envelope[0] !== LINK_VERSION) return null;
  return envelope.subarray(1, 1 + KEY_BYTES).toString('base64url');
}

/** The PC's side of receiving. Null when the envelope does not open with that phone's key. */
export function openRecording(pc: LinkKeys, envelope: Buffer): { phone: string; header: RecordingHeader; media: Buffer } | null {
  const phone = envelopeSender(envelope);
  if (!phone) return null;
  const secret = sharedSecret(pc, phone);
  if (!secret) return null;
  const head = envelope.subarray(0, HEAD_BYTES);
  const salt = head.subarray(1 + KEY_BYTES, 1 + KEY_BYTES + SALT_BYTES);
  const nonce = head.subarray(1 + KEY_BYTES + SALT_BYTES);
  const plain = decrypt(derive(secret, salt, 'recording'), nonce, head, envelope.subarray(HEAD_BYTES));
  if (!plain || plain.length < 4) return null;
  const headerLength = plain.readUInt32BE(0);
  if (headerLength > 16 * 1024 || plain.length < 4 + headerLength) return null;
  try {
    const header = JSON.parse(plain.subarray(4, 4 + headerLength).toString('utf8')) as RecordingHeader;
    return { phone, header, media: plain.subarray(4 + headerLength) };
  } catch {
    return null;
  }
}

function receiptKey(own: LinkKeys, peerPublic: string): Buffer | null {
  const secret = sharedSecret(own, peerPublic);
  return secret ? derive(secret, Buffer.alloc(0), 'receipt') : null;
}

/** The PC's receipt for a saved recording. Only the PC and that phone can make it. */
export function receiptFor(pc: LinkKeys, phonePublic: string, id: string): string {
  const key = receiptKey(pc, phonePublic);
  if (!key) throw new Error('That is not a paired phone.');
  return createHmac('sha256', key).update(`saved:${id}`).digest('base64url');
}

/** The phone's check of a receipt before it deletes its copy. */
export function receiptChecks(phone: LinkKeys, pcPublic: string, id: string, receipt: string): boolean {
  const key = receiptKey(phone, pcPublic);
  if (!key) return false;
  return sameToken(receipt, createHmac('sha256', key).update(`saved:${id}`).digest('base64url'));
}
