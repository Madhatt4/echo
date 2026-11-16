// The audit trail: a record of everything that happens to the archive.
//
// It is append-only and lives inside the archive. Every entry is encrypted,
// and every entry carries a fingerprint of the entry before it, so removing,
// reordering or editing an entry in the middle is detected when it is read.

import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { appendFileSync, existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { purposeKey } from './vault.ts';

export const AUDIT_FILENAME = 'audit.log';
const GENESIS = 'genesis';

export type AuditDetail = Record<string, string | number | boolean>;

export interface AuditEvent {
  seq: number;
  at: string;
  type: string;
  detail: AuditDetail;
  /** Fingerprint of the previous line in the file, or "genesis" for the first. */
  prev: string;
}

export interface AuditReading {
  events: AuditEvent[];
  /** False if any entry failed to decrypt or the chain between entries is broken. */
  intact: boolean;
  /** Plain-English description of the first problem found. */
  problem?: string;
}

function auditKey(masterKey: Buffer): Buffer {
  return purposeKey(masterKey, 'echo/audit/v1');
}

function fingerprint(line: string): string {
  return createHash('sha256').update(line, 'utf8').digest('hex');
}

function readLines(archiveDir: string): string[] {
  const file = path.join(archiveDir, AUDIT_FILENAME);
  if (!existsSync(file)) return [];
  return readFileSync(file, 'utf8').split('\n').filter((line) => line.length > 0);
}

function sealLine(key: Buffer, event: AuditEvent): string {
  const nonce = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, nonce);
  cipher.setAAD(Buffer.from(String(event.seq), 'utf8'));
  const body = Buffer.concat([cipher.update(JSON.stringify(event), 'utf8'), cipher.final()]);
  return ['v1', event.seq, nonce.toString('base64'), body.toString('base64'), cipher.getAuthTag().toString('base64')].join('.');
}

function openLine(key: Buffer, line: string): AuditEvent {
  const [version, seqText, nonce, body, tag] = line.split('.');
  if (version !== 'v1' || !seqText || !nonce || !body || !tag) throw new Error('not an audit entry');
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(nonce, 'base64'));
  decipher.setAAD(Buffer.from(seqText, 'utf8'));
  decipher.setAuthTag(Buffer.from(tag, 'base64'));
  const plain = Buffer.concat([decipher.update(Buffer.from(body, 'base64')), decipher.final()]).toString('utf8');
  const event = JSON.parse(plain) as AuditEvent;
  if (String(event.seq) !== seqText) throw new Error('entry number does not match');
  return event;
}

/** Reads and checks the whole audit trail. */
export function readAudit(archiveDir: string, masterKey: Buffer): AuditReading {
  const key = auditKey(masterKey);
  const events: AuditEvent[] = [];
  let previous = GENESIS;
  try {
    for (const [index, line] of readLines(archiveDir).entries()) {
      let event: AuditEvent;
      try {
        event = openLine(key, line);
      } catch {
        return { events, intact: false, problem: `Entry ${index + 1} could not be read. It has been changed or damaged.` };
      }
      if (event.seq !== index + 1 || event.prev !== previous) {
        return { events, intact: false, problem: `The record is broken at entry ${index + 1}. An entry has been removed or moved.` };
      }
      events.push(event);
      previous = fingerprint(line);
    }
    return { events, intact: true };
  } finally {
    key.fill(0);
  }
}

/** Adds one entry to the end of the audit trail and returns it. */
export function appendAudit(
  archiveDir: string,
  masterKey: Buffer,
  type: string,
  detail: AuditDetail = {},
  now: Date = new Date(),
): AuditEvent {
  const key = auditKey(masterKey);
  try {
    const lines = readLines(archiveDir);
    const last = lines.at(-1);
    const event: AuditEvent = {
      seq: lines.length + 1,
      at: now.toISOString(),
      type,
      detail,
      prev: last ? fingerprint(last) : GENESIS,
    };
    appendFileSync(path.join(archiveDir, AUDIT_FILENAME), `${sealLine(key, event)}\n`, 'utf8');
    return event;
  } finally {
    key.fill(0);
  }
}
