// Small encrypted files inside the archive. Each kind of file gets its own
// key (worked out from the master key), so one file's key never opens another.

import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { purposeKey } from './vault.ts';

function seal(masterKey: Buffer, purpose: string, value: unknown): string {
  const key = purposeKey(masterKey, purpose);
  try {
    const nonce = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', key, nonce);
    cipher.setAAD(Buffer.from(purpose, 'utf8'));
    const body = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()]);
    return ['v1', nonce.toString('base64'), body.toString('base64'), cipher.getAuthTag().toString('base64')].join('.');
  } finally {
    key.fill(0);
  }
}

function open<T>(masterKey: Buffer, purpose: string, sealed: string): T {
  const [version, nonce, body, tag] = sealed.trim().split('.');
  if (version !== 'v1' || !nonce || !body || !tag) throw new Error('This file is not one Echo wrote.');
  const key = purposeKey(masterKey, purpose);
  try {
    const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(nonce, 'base64'));
    decipher.setAAD(Buffer.from(purpose, 'utf8'));
    decipher.setAuthTag(Buffer.from(tag, 'base64'));
    return JSON.parse(Buffer.concat([decipher.update(Buffer.from(body, 'base64')), decipher.final()]).toString('utf8')) as T;
  } finally {
    key.fill(0);
  }
}

/** Reads an encrypted file. Returns null if it does not exist. Throws if it was altered. */
export function readSealedFile<T>(file: string, masterKey: Buffer, purpose: string): T | null {
  if (!existsSync(file)) return null;
  return open<T>(masterKey, purpose, readFileSync(file, 'utf8'));
}

/** Writes an encrypted file, replacing it in one move so it is never half-written. */
export function writeSealedFile(file: string, masterKey: Buffer, purpose: string, value: unknown): void {
  const temporary = `${file}.writing`;
  writeFileSync(temporary, `${seal(masterKey, purpose, value)}\n`, 'utf8');
  renameSync(temporary, file);
}
