// The PC's link keys and the phones paired with it, kept encrypted inside the
// archive. The PC's private key is therefore only usable while the archive is open.

import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { makeLinkKeys } from './phone-link.ts';
import type { LinkKeys } from './phone-link.ts';
import { readSealedFile, writeSealedFile } from './sealed.ts';

const FILENAME = 'phones.sealed';
const PURPOSE = 'echo/phones/v1';
/** Enough to recognise a resend; older ids are long since deleted from the phone. */
const RECEIVED_KEPT = 5000;

export interface PairedPhone {
  id: string;
  name: string;
  /** The phone's public key, raw, base64url. */
  publicKey: string;
  pairedAt: string;
}

interface PhonesStore {
  keys: LinkKeys | null;
  phones: PairedPhone[];
  /** Recording ids already saved, newest last, so a resend is not saved twice. */
  received: string[];
}

function file(archiveDir: string): string {
  return path.join(archiveDir, FILENAME);
}

function load(archiveDir: string, masterKey: Buffer): PhonesStore {
  const stored = readSealedFile<Partial<PhonesStore>>(file(archiveDir), masterKey, PURPOSE);
  return { keys: stored?.keys ?? null, phones: stored?.phones ?? [], received: stored?.received ?? [] };
}

function save(archiveDir: string, masterKey: Buffer, store: PhonesStore): void {
  writeSealedFile(file(archiveDir), masterKey, PURPOSE, store);
}

/** This PC's link keys, made the first time they are needed. */
export function pcLinkKeys(archiveDir: string, masterKey: Buffer): LinkKeys {
  const store = load(archiveDir, masterKey);
  if (store.keys) return store.keys;
  const keys = makeLinkKeys();
  save(archiveDir, masterKey, { ...store, keys });
  return keys;
}

export function loadPhones(archiveDir: string, masterKey: Buffer): PairedPhone[] {
  return load(archiveDir, masterKey).phones;
}

/** Pairs a phone. Pairing the same phone again keeps one entry, with the new name. */
export function addPhone(archiveDir: string, masterKey: Buffer, publicKey: string, name: string, at: Date): PairedPhone {
  const store = load(archiveDir, masterKey);
  const existing = store.phones.find((phone) => phone.publicKey === publicKey);
  const phone: PairedPhone = { id: existing?.id ?? randomUUID(), name, publicKey, pairedAt: at.toISOString() };
  save(archiveDir, masterKey, { ...store, phones: [...store.phones.filter((candidate) => candidate.publicKey !== publicKey), phone] });
  return phone;
}

/** Returns false if there is no such phone. */
export function removePhone(archiveDir: string, masterKey: Buffer, id: string): boolean {
  const store = load(archiveDir, masterKey);
  if (!store.phones.some((phone) => phone.id === id)) return false;
  save(archiveDir, masterKey, { ...store, phones: store.phones.filter((phone) => phone.id !== id) });
  return true;
}

export function alreadyReceived(archiveDir: string, masterKey: Buffer, recordingId: string): boolean {
  return load(archiveDir, masterKey).received.includes(recordingId);
}

export function markReceived(archiveDir: string, masterKey: Buffer, recordingId: string): void {
  const store = load(archiveDir, masterKey);
  save(archiveDir, masterKey, { ...store, received: [...store.received, recordingId].slice(-RECEIVED_KEPT) });
}
