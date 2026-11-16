// The vault is what makes the archive unreadable without the passphrase.
//
// One random master key encrypts everything in the archive. The master key is
// never stored as it is: it is stored wrapped (encrypted) by a key worked out
// from the passphrase. Each wrapped copy is a "slot". Step 3 adds a second
// slot for the recovery kit, wrapping the same master key, so either one opens
// the archive and changing one never means re-encrypting the archive.

import {
  createCipheriv,
  createDecipheriv,
  hkdfSync,
  randomBytes,
  randomInt,
  randomUUID,
  scrypt,
} from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { RECOVERY_ALPHABET, RECOVERY_GROUPS, RECOVERY_GROUP_LENGTH, normaliseRecoveryCode } from '../shared/recovery-code.ts';

export const VAULT_FILENAME = 'vault.json';
const ATTEMPTS_FILENAME = 'unlock-attempts.json';
const KEY_BYTES = 32;
const NONCE_BYTES = 12;
const TAG_BYTES = 16;

export interface KdfSettings {
  /** scrypt work factor. Higher is slower to guess and slower to unlock. */
  N: number;
  r: number;
  p: number;
}

/** About half a second on an ordinary PC, and 128 MB of memory per guess. */
export const DEFAULT_KDF: KdfSettings = { N: 2 ** 17, r: 8, p: 1 };

export interface KeySlot {
  id: 'passphrase' | 'recovery';
  kdf: KdfSettings & { name: 'scrypt'; salt: string };
  nonce: string;
  wrappedKey: string;
}

export interface VaultFile {
  format: 'echo-vault';
  version: 1;
  archiveId: string;
  createdAt: string;
  slots: KeySlot[];
}

export class VaultExistsError extends Error {
  constructor() {
    super('An archive already exists in this folder.');
    this.name = 'VaultExistsError';
  }
}

export class VaultMissingError extends Error {
  constructor() {
    super('No archive was found in this folder.');
    this.name = 'VaultMissingError';
  }
}

export class WrongPassphraseError extends Error {
  constructor() {
    super('That passphrase does not open this archive.');
    this.name = 'WrongPassphraseError';
  }
}

export class WrongRecoveryCodeError extends Error {
  constructor() {
    super('That recovery code does not open this archive.');
    this.name = 'WrongRecoveryCodeError';
  }
}

function deriveKey(secret: string, settings: KdfSettings, salt: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(
      secret.normalize('NFKC'),
      salt,
      KEY_BYTES,
      { N: settings.N, r: settings.r, p: settings.p, maxmem: 256 * settings.N * settings.r },
      (error, key) => (error ? reject(error) : resolve(key)),
    );
  });
}

function slotLabel(archiveId: string, slotId: string): Buffer {
  return Buffer.from(`echo-vault:1:${archiveId}:${slotId}`, 'utf8');
}

async function makeSlot(
  id: KeySlot['id'],
  secret: string,
  masterKey: Buffer,
  archiveId: string,
  settings: KdfSettings,
): Promise<KeySlot> {
  const salt = randomBytes(16);
  const wrappingKey = await deriveKey(secret, settings, salt);
  const nonce = randomBytes(NONCE_BYTES);
  const cipher = createCipheriv('aes-256-gcm', wrappingKey, nonce);
  cipher.setAAD(slotLabel(archiveId, id));
  const wrapped = Buffer.concat([cipher.update(masterKey), cipher.final(), cipher.getAuthTag()]);
  wrappingKey.fill(0);
  return {
    id,
    kdf: { name: 'scrypt', ...settings, salt: salt.toString('base64') },
    nonce: nonce.toString('base64'),
    wrappedKey: wrapped.toString('base64'),
  };
}

async function openSlot(slot: KeySlot, secret: string, archiveId: string): Promise<Buffer | null> {
  const wrappingKey = await deriveKey(secret, slot.kdf, Buffer.from(slot.kdf.salt, 'base64'));
  const wrapped = Buffer.from(slot.wrappedKey, 'base64');
  const body = wrapped.subarray(0, wrapped.length - TAG_BYTES);
  const tag = wrapped.subarray(wrapped.length - TAG_BYTES);
  try {
    const decipher = createDecipheriv('aes-256-gcm', wrappingKey, Buffer.from(slot.nonce, 'base64'));
    decipher.setAAD(slotLabel(archiveId, slot.id));
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(body), decipher.final()]);
  } catch {
    return null; // wrong secret, or the slot was tampered with
  } finally {
    wrappingKey.fill(0);
  }
}

function writeFileSafely(file: string, contents: string): void {
  const temporary = `${file}.writing`;
  writeFileSync(temporary, contents, 'utf8');
  renameSync(temporary, file);
}

/** Reads the vault description. Returns null when the folder holds no archive. */
export function readVault(archiveDir: string): VaultFile | null {
  const file = path.join(archiveDir, VAULT_FILENAME);
  if (!existsSync(file)) return null;
  const parsed = JSON.parse(readFileSync(file, 'utf8')) as VaultFile;
  if (parsed.format !== 'echo-vault' || parsed.version !== 1 || !Array.isArray(parsed.slots)) {
    throw new Error('The archive in this folder was made by a version of Echo this one cannot read.');
  }
  return parsed;
}

/**
 * Creates a new archive in `archiveDir` protected by `passphrase`.
 * Resolves to the master key, which the caller must keep only in memory.
 */
export async function createVault(
  archiveDir: string,
  passphrase: string,
  settings: KdfSettings = DEFAULT_KDF,
): Promise<Buffer> {
  if (readVault(archiveDir)) throw new VaultExistsError();
  mkdirSync(archiveDir, { recursive: true });
  const archiveId = randomUUID();
  const masterKey = randomBytes(KEY_BYTES);
  const vault: VaultFile = {
    format: 'echo-vault',
    version: 1,
    archiveId,
    createdAt: new Date().toISOString(),
    slots: [await makeSlot('passphrase', passphrase, masterKey, archiveId, settings)],
  };
  writeVault(archiveDir, vault);
  return masterKey;
}

function writeVault(archiveDir: string, vault: VaultFile): void {
  writeFileSafely(path.join(archiveDir, VAULT_FILENAME), `${JSON.stringify(vault, null, 2)}\n`);
}

async function openWith(archiveDir: string, slotId: KeySlot['id'], secret: string): Promise<Buffer | null> {
  const vault = readVault(archiveDir);
  if (!vault) throw new VaultMissingError();
  for (const slot of vault.slots.filter((s) => s.id === slotId)) {
    const masterKey = await openSlot(slot, secret, vault.archiveId);
    if (masterKey) return masterKey;
  }
  return null;
}

/** Replaces (or adds) one slot, leaving the other untouched. */
async function setSlot(
  archiveDir: string,
  slotId: KeySlot['id'],
  secret: string,
  masterKey: Buffer,
  settings: KdfSettings,
): Promise<void> {
  const vault = readVault(archiveDir);
  if (!vault) throw new VaultMissingError();
  const slot = await makeSlot(slotId, secret, masterKey, vault.archiveId, settings);
  vault.slots = [...vault.slots.filter((s) => s.id !== slotId), slot];
  writeVault(archiveDir, vault);
}

/** Opens the archive with the passphrase. Resolves to the master key. */
export async function unlockVault(archiveDir: string, passphrase: string): Promise<Buffer> {
  const masterKey = await openWith(archiveDir, 'passphrase', passphrase);
  if (!masterKey) throw new WrongPassphraseError();
  return masterKey;
}

/** A fresh recovery code, as one unbroken string of valid characters. */
export function generateRecoveryCode(): string {
  let code = '';
  for (let i = 0; i < RECOVERY_GROUPS * RECOVERY_GROUP_LENGTH; i += 1) {
    code += RECOVERY_ALPHABET[randomInt(RECOVERY_ALPHABET.length)];
  }
  return code;
}

/** True once a recovery kit has been made for this archive. */
export function hasRecoveryKit(archiveDir: string): boolean {
  return readVault(archiveDir)?.slots.some((s) => s.id === 'recovery') ?? false;
}

/**
 * Makes `code` able to open the archive. Any earlier recovery code stops
 * working. The passphrase is unaffected.
 */
export async function setRecoveryCode(
  archiveDir: string,
  masterKey: Buffer,
  code: string,
  settings: KdfSettings = DEFAULT_KDF,
): Promise<void> {
  const normalised = normaliseRecoveryCode(code);
  if (!normalised) throw new Error('That is not a complete recovery code.');
  await setSlot(archiveDir, 'recovery', normalised, masterKey, settings);
}

/** Opens the archive with the recovery code from the printed kit. */
export async function unlockVaultWithRecoveryCode(archiveDir: string, code: string): Promise<Buffer> {
  const normalised = normaliseRecoveryCode(code);
  if (!normalised) throw new WrongRecoveryCodeError();
  const masterKey = await openWith(archiveDir, 'recovery', normalised);
  if (!masterKey) throw new WrongRecoveryCodeError();
  return masterKey;
}

/**
 * Replaces the passphrase. The old one stops working. The recovery code and
 * everything in the archive are unaffected.
 */
export async function setPassphrase(
  archiveDir: string,
  masterKey: Buffer,
  passphrase: string,
  settings: KdfSettings = DEFAULT_KDF,
): Promise<void> {
  await setSlot(archiveDir, 'passphrase', passphrase, masterKey, settings);
}

/**
 * A separate key for one purpose (for example the audit trail), worked out
 * from the master key. Keeps one use of the key from weakening another.
 */
export function purposeKey(masterKey: Buffer, purpose: string): Buffer {
  return Buffer.from(hkdfSync('sha256', masterKey, Buffer.alloc(0), Buffer.from(purpose, 'utf8'), KEY_BYTES));
}

// Failed unlock attempts cannot be written to the encrypted audit trail,
// because nothing can be encrypted while the archive is locked. They are
// counted here in the open, and the count goes into the audit trail at the
// next successful unlock.

function attemptsFile(archiveDir: string): string {
  return path.join(archiveDir, ATTEMPTS_FILENAME);
}

export function failedAttempts(archiveDir: string): number {
  try {
    const parsed = JSON.parse(readFileSync(attemptsFile(archiveDir), 'utf8')) as { failed?: unknown };
    return typeof parsed.failed === 'number' && parsed.failed >= 0 ? parsed.failed : 0;
  } catch {
    return 0;
  }
}

export function recordFailedAttempt(archiveDir: string): number {
  const failed = failedAttempts(archiveDir) + 1;
  writeFileSafely(attemptsFile(archiveDir), `${JSON.stringify({ failed })}\n`);
  return failed;
}

export function clearFailedAttempts(archiveDir: string): void {
  writeFileSafely(attemptsFile(archiveDir), `${JSON.stringify({ failed: 0 })}\n`);
}
