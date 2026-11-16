// The record of the person's consent. Kept encrypted inside the archive,
// next to the video of them reading the statement.

import path from 'node:path';
import { readSealedFile, writeSealedFile } from './sealed.ts';

const CONSENT_FILENAME = 'consent.sealed';
const PURPOSE = 'echo/consent/v1';

export interface ConsentGiven {
  fullName: string;
  /** The exact statement that was shown and read aloud. */
  wording: string;
  givenAt: string;
  /** The encrypted video of the statement being read. */
  mediaId: string;
  mimeType: string;
  seconds: number;
}

export interface ConsentRecord {
  /** The consent in force, or the last one given if it has since been withdrawn. */
  latest?: ConsentGiven;
  withdrawnAt?: string;
  /** Earlier consents that were replaced or withdrawn. Their videos stay in the archive. */
  earlier: ConsentGiven[];
}

export function loadConsent(archiveDir: string, masterKey: Buffer): ConsentRecord {
  return readSealedFile<ConsentRecord>(path.join(archiveDir, CONSENT_FILENAME), masterKey, PURPOSE) ?? { earlier: [] };
}

export function saveConsent(archiveDir: string, masterKey: Buffer, record: ConsentRecord): void {
  writeSealedFile(path.join(archiveDir, CONSENT_FILENAME), masterKey, PURPOSE, record);
}

export type ConsentState = 'none' | 'given' | 'withdrawn';

export function consentState(record: ConsentRecord): ConsentState {
  if (!record.latest) return 'none';
  return record.withdrawnAt ? 'withdrawn' : 'given';
}
