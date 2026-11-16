// Opens an encrypted iPhone backup with the backup password.
//
// How Apple protects an encrypted backup:
//
//   password --(two rounds of key stretching)--> a key
//   that key unwraps the "class keys" kept in the backup's key bag
//   a class key unwraps the key of the backup's index (Manifest.db)
//   the index lists every file with that file's own wrapped key
//   a class key unwraps that, and the file is decrypted with it
//
// Echo follows that chain in memory. The password is never stored. To read a
// database it has to exist as a file for a moment, so a decrypted copy is
// written to a private folder, read, and deleted before the function returns,
// whatever happens. Any copy left by a crash is removed the next time Echo starts.

import { createDecipheriv, pbkdf2 } from 'node:crypto';
import { closeSync, ftruncateSync, mkdtempSync, openSync, readFileSync, readSync, readdirSync, rmSync, statSync, writeSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { promisify } from 'node:util';
import { isPlistUid, readBinaryPlist } from '../shared/bplist.ts';
import type { PlistValue } from '../shared/bplist.ts';
import { CONTACTS_FILE, SMS_FILE, backupFileName } from './iphone.ts';

const stretch = promisify(pbkdf2);
const COPY_PREFIX = 'echo-backup-';
const WRAP_IV = Buffer.from('A6A6A6A6A6A6A6A6', 'hex');

/** A file inside an encrypted backup, with the key that opens it. */
export interface LockedFile {
  source: string;
  key: Buffer;
  /** The file's real length. The encrypted copy is padded past it. */
  size: number;
}

export interface KeyBag {
  salt: Buffer;
  iterations: number;
  /** A second salt and count, in backups from iOS 10.2 on. */
  firstSalt: Buffer | null;
  firstIterations: number;
  /** Each protection class's key, still wrapped by the password. */
  wrappedClassKeys: Map<number, Buffer>;
}

/** Reads the key bag: a run of four-letter tags, each followed by a length and that many bytes. */
export function readKeyBag(data: Uint8Array): KeyBag {
  const bytes = Buffer.from(data);
  const bag: KeyBag = { salt: Buffer.alloc(0), iterations: 0, firstSalt: null, firstIterations: 0, wrappedClassKeys: new Map() };
  let seenBagId = false;
  let inClass = false;
  let classNumber: number | null = null;
  for (let at = 0; at + 8 <= bytes.length; ) {
    const tag = bytes.toString('latin1', at, at + 4);
    const length = bytes.readUInt32BE(at + 4);
    const value = bytes.subarray(at + 8, at + 8 + length);
    at += 8 + length;
    const number = length === 4 ? value.readUInt32BE(0) : 0;
    if (tag === 'UUID') {
      // The first UUID names the bag. Each later one starts a class key.
      inClass = seenBagId;
      seenBagId = true;
      classNumber = null;
    } else if (inClass) {
      if (tag === 'CLAS') classNumber = number;
      else if (tag === 'WPKY' && classNumber !== null) bag.wrappedClassKeys.set(classNumber, Buffer.from(value));
    } else if (tag === 'SALT') bag.salt = Buffer.from(value);
    else if (tag === 'ITER') bag.iterations = number;
    else if (tag === 'DPSL') bag.firstSalt = Buffer.from(value);
    else if (tag === 'DPIC') bag.firstIterations = number;
  }
  return bag;
}

/**
 * Unwraps a key (AES key wrap, RFC 3394). Returns null if the wrapping key is
 * the wrong one: the method carries its own check, so a wrong password is
 * noticed here and never produces a wrong key.
 *
 * It is written out with plain AES blocks, and not left to the cipher of that
 * name, because the app's copy of the cryptography library is not certain to
 * include it.
 */
export function unwrapKey(wrappingKey: Buffer, wrapped: Uint8Array): Buffer | null {
  const bytes = Buffer.from(wrapped);
  if (wrappingKey.length !== 32 || bytes.length < 24 || bytes.length % 8 !== 0) return null;
  const blocks = bytes.length / 8 - 1;
  let check = bytes.readBigUInt64BE(0);
  const parts: Buffer[] = [];
  for (let i = 0; i < blocks; i += 1) parts.push(Buffer.from(bytes.subarray(8 * (i + 1), 8 * (i + 2))));
  const aes = createDecipheriv('aes-256-ecb', wrappingKey, null);
  aes.setAutoPadding(false);
  for (let round = 5; round >= 0; round -= 1) {
    for (let i = blocks; i >= 1; i -= 1) {
      const block = Buffer.alloc(16);
      block.writeBigUInt64BE(check ^ BigInt(blocks * round + i), 0);
      (parts[i - 1] as Buffer).copy(block, 8);
      const opened = aes.update(block);
      check = opened.readBigUInt64BE(0);
      parts[i - 1] = Buffer.from(opened.subarray(8, 16));
    }
  }
  return check === WRAP_IV.readBigUInt64BE(0) ? Buffer.concat(parts) : null;
}

/** Turns the backup password into the key that unwraps the class keys. Slow on purpose: Apple asks for millions of rounds. */
export async function passwordKey(password: string, bag: KeyBag): Promise<Buffer> {
  const first = bag.firstSalt && bag.firstIterations > 0 ? await stretch(Buffer.from(password, 'utf8'), bag.firstSalt, bag.firstIterations, 32, 'sha256') : Buffer.from(password, 'utf8');
  return stretch(first, bag.salt, bag.iterations, 32, 'sha1');
}

/** Decrypts a file from the backup into `target`, a few megabytes at a time. */
function decryptTo(source: string, key: Buffer, size: number | null, target: string): void {
  const decipher = createDecipheriv('aes-256-cbc', key, Buffer.alloc(16));
  decipher.setAutoPadding(false);
  const from = openSync(source, 'r');
  const to = openSync(target, 'w', 0o600);
  try {
    const chunk = Buffer.alloc(4 * 1024 * 1024);
    for (;;) {
      const got = readSync(from, chunk, 0, chunk.length, null);
      if (got === 0) break;
      writeSync(to, decipher.update(chunk.subarray(0, got)));
    }
    writeSync(to, decipher.final());
    if (size !== null && size > 0 && size <= statSync(target).size) ftruncateSync(to, size);
  } finally {
    closeSync(from);
    closeSync(to);
  }
}

/**
 * Gives `use` a decrypted copy of a file from the backup, then deletes the
 * copy, whether `use` worked or not.
 */
export function withDecrypted<T>(file: { source: string; key: Buffer; size: number | null }, use: (copy: string) => T): T {
  const folder = mkdtempSync(path.join(tmpdir(), COPY_PREFIX));
  try {
    const copy = path.join(folder, 'copy');
    decryptTo(file.source, file.key, file.size, copy);
    return use(copy);
  } finally {
    rmSync(folder, { recursive: true, force: true });
  }
}

/** Removes any decrypted copy left behind if Echo was stopped part-way through reading a backup. */
export function removeLeftoverCopies(): void {
  try {
    for (const name of readdirSync(tmpdir())) {
      if (name.startsWith(COPY_PREFIX)) rmSync(path.join(tmpdir(), name), { recursive: true, force: true });
    }
  } catch {
    // Nothing to clear, or the folder cannot be listed. Neither stops Echo.
  }
}

/** True if the backup's own record says it is encrypted. False if it says it is not, or says nothing Echo can read. */
export function saysItIsEncrypted(folder: string): boolean {
  try {
    const manifest = readBinaryPlist(readFileSync(path.join(folder, 'Manifest.plist')));
    return typeof manifest === 'object' && manifest !== null && !Array.isArray(manifest) && !(manifest instanceof Uint8Array) && (manifest as { [key: string]: PlistValue }).IsEncrypted === true;
  } catch {
    return false;
  }
}

function asBytes(value: PlistValue | undefined): Buffer | null {
  return value instanceof Uint8Array ? Buffer.from(value) : null;
}

/** A wrapped key as the backup writes it: four bytes naming the protection class, then the wrapped key. */
function splitKey(packed: Buffer): { protectionClass: number; wrapped: Buffer } {
  return { protectionClass: packed.readUInt32LE(0), wrapped: packed.subarray(4) };
}

export type Unlocked = { ok: true; sms: LockedFile | null; contacts: LockedFile | null } | { ok: false; problem: string; wrongPassword?: boolean };

/**
 * Unlocks an encrypted backup with its password and finds the messages and
 * contacts in it, each with the key that opens it. Nothing is decrypted to
 * disk here except the backup's index, which is read and deleted at once.
 */
export async function unlockBackup(folder: string, password: string): Promise<Unlocked> {
  let manifest: PlistValue;
  try {
    manifest = readBinaryPlist(readFileSync(path.join(folder, 'Manifest.plist')));
  } catch {
    return { ok: false, problem: 'Echo could not read how that backup is protected.' };
  }
  const top = typeof manifest === 'object' && manifest !== null && !Array.isArray(manifest) && !(manifest instanceof Uint8Array) ? (manifest as { [key: string]: PlistValue }) : {};
  const bagBytes = asBytes(top.BackupKeyBag);
  const manifestKey = asBytes(top.ManifestKey);
  if (!bagBytes || !manifestKey || manifestKey.length < 12) {
    return { ok: false, problem: 'That backup is encrypted in a way Echo cannot open. It may have been made by a very old iPhone.' };
  }

  const bag = readKeyBag(bagBytes);
  if (bag.wrappedClassKeys.size === 0 || bag.iterations === 0) return { ok: false, problem: 'Echo could not read the keys in that backup.' };
  const fromPassword = await passwordKey(password, bag);
  const classKeys = new Map<number, Buffer>();
  for (const [protectionClass, wrapped] of bag.wrappedClassKeys) {
    const key = unwrapKey(fromPassword, wrapped);
    if (key) classKeys.set(protectionClass, key);
  }
  if (classKeys.size === 0) {
    return {
      ok: false,
      wrongPassword: true,
      problem: 'That is not the password for this backup. It is the one you chose when you ticked "Encrypt local backup", not your iPhone passcode or your Apple password.',
    };
  }

  const packed = splitKey(manifestKey);
  const indexClassKey = classKeys.get(packed.protectionClass);
  const indexKey = indexClassKey ? unwrapKey(indexClassKey, packed.wrapped) : null;
  if (!indexKey) return { ok: false, problem: "Echo unlocked the backup's keys but could not open its index." };

  /** Looks up one file in the backup's index and works out the key that opens it. */
  const locate = (index: DatabaseSync, file: { domain: string; relativePath: string }): LockedFile | null => {
    const name = backupFileName(file);
    const row = index.prepare('SELECT file FROM Files WHERE fileID = ?').get(name);
    const record = row?.file instanceof Uint8Array ? readBinaryPlist(row.file) : null;
    if (typeof record !== 'object' || record === null || Array.isArray(record) || record instanceof Uint8Array) return null;
    const archive = record as { [key: string]: PlistValue };
    const objects = Array.isArray(archive.$objects) ? archive.$objects : [];
    const rootRef = (archive.$top as { [key: string]: PlistValue } | undefined)?.root;
    const root = isPlistUid(rootRef) ? objects[rootRef.UID] : undefined;
    if (typeof root !== 'object' || root === null || Array.isArray(root) || root instanceof Uint8Array) return null;
    const details = root as { [key: string]: PlistValue };
    const keyRef = details.EncryptionKey;
    const keyObject = isPlistUid(keyRef) ? objects[keyRef.UID] : undefined;
    const keyData = typeof keyObject === 'object' && keyObject !== null && !Array.isArray(keyObject) && !(keyObject instanceof Uint8Array) ? asBytes((keyObject as { [key: string]: PlistValue })['NS.data']) : asBytes(keyObject);
    const protectionClass = typeof details.ProtectionClass === 'number' ? details.ProtectionClass : null;
    if (!keyData || keyData.length < 12 || protectionClass === null) return null;
    const classKey = classKeys.get(protectionClass);
    const key = classKey ? unwrapKey(classKey, splitKey(keyData).wrapped) : null;
    if (!key) return null;
    for (const source of [path.join(folder, name.slice(0, 2), name), path.join(folder, name)]) {
      try {
        statSync(source);
        return { source, key, size: typeof details.Size === 'number' ? details.Size : 0 };
      } catch {
        // Not in that place. Try the other layout.
      }
    }
    return null;
  };

  try {
    return withDecrypted({ source: path.join(folder, 'Manifest.db'), key: indexKey, size: null }, (copy) => {
      const index = new DatabaseSync(copy, { readOnly: true });
      try {
        return { ok: true as const, sms: locate(index, SMS_FILE), contacts: locate(index, CONTACTS_FILE) };
      } finally {
        index.close();
      }
    });
  } catch {
    return { ok: false, problem: "Echo unlocked the backup's keys but could not read its index." };
  }
}

/**
 * Checks, on the computer Echo is running on, that the cryptography this file
 * relies on gives the published answers. Returns what is wrong, or null.
 */
export async function cryptoSelfCheck(): Promise<string | null> {
  // The test vector for wrapping a 256-bit key with a 256-bit key, from RFC 3394, section 4.6.
  const wrappingKey = Buffer.from('000102030405060708090A0B0C0D0E0F101112131415161718191A1B1C1D1E1F', 'hex');
  const wrapped = Buffer.from('28C9F404C4B810F4CBCCB35CFB87F8263F5786E2D80ED326CBC7F0E71A99F43BFB988B9B7A02DD21', 'hex');
  const expected = '00112233445566778899aabbccddeeff000102030405060708090a0b0c0d0e0f';
  if (unwrapKey(wrappingKey, wrapped)?.toString('hex') !== expected) return 'key unwrapping gives the wrong answer';
  wrapped[0] = (wrapped[0] ?? 0) ^ 1;
  if (unwrapKey(wrappingKey, wrapped) !== null) return 'key unwrapping does not notice a wrong key';
  const key = await passwordKey('correct horse', { salt: Buffer.from('second-salt'), iterations: 25, firstSalt: Buffer.from('first-salt'), firstIterations: 40, wrappedClassKeys: new Map() });
  if (key.toString('hex') !== 'accb155fa252d8895bd70ce66fec8934d8f870b5bdb531a859f29cca1ffe95b4') return 'password stretching gives the wrong answer';
  return null;
}
