// The list of advice, kept encrypted inside the archive. Where a piece of
// advice was spoken, its sound is a separate encrypted recording.

import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { tidyAdvice } from '../shared/advice.ts';
import type { AdviceDetails, AdviceKind } from '../shared/advice.ts';
import { readSealedFile, writeSealedFile } from './sealed.ts';

const ADVICE_FILENAME = 'advice.sealed';
const PURPOSE = 'echo/advice/v1';

export interface StoredAdvice {
  id: string;
  personId: string;
  occasion: string;
  kind: AdviceKind;
  date: string;
  text: string;
  savedAt: string;
  /** The encrypted recording, if the advice was spoken. */
  mediaId?: string;
  mimeType?: string;
}

function file(archiveDir: string): string {
  return path.join(archiveDir, ADVICE_FILENAME);
}

export function loadAdvice(archiveDir: string, masterKey: Buffer): StoredAdvice[] {
  return readSealedFile<{ advice: StoredAdvice[] }>(file(archiveDir), masterKey, PURPOSE)?.advice ?? [];
}

function saveAdvice(archiveDir: string, masterKey: Buffer, advice: StoredAdvice[]): void {
  writeSealedFile(file(archiveDir), masterKey, PURPOSE, { advice });
}

export function addAdvice(
  archiveDir: string,
  masterKey: Buffer,
  details: AdviceDetails,
  recording: { mediaId: string; mimeType: string } | null,
): StoredAdvice {
  const advice: StoredAdvice = { id: randomUUID(), ...tidyAdvice(details), savedAt: new Date().toISOString(), ...(recording ?? {}) };
  saveAdvice(archiveDir, masterKey, [...loadAdvice(archiveDir, masterKey), advice]);
  return advice;
}

/** Returns false if there is no such advice. */
export function changeAdvice(archiveDir: string, masterKey: Buffer, id: string, details: AdviceDetails): boolean {
  const all = loadAdvice(archiveDir, masterKey);
  if (!all.some((advice) => advice.id === id)) return false;
  saveAdvice(archiveDir, masterKey, all.map((advice) => (advice.id === id ? { ...advice, ...tidyAdvice(details) } : advice)));
  return true;
}

/** Removes a piece of advice and returns it, so its recording can be removed too. */
export function removeAdvice(archiveDir: string, masterKey: Buffer, id: string): StoredAdvice | null {
  const all = loadAdvice(archiveDir, masterKey);
  const found = all.find((advice) => advice.id === id) ?? null;
  if (found) saveAdvice(archiveDir, masterKey, all.filter((advice) => advice.id !== id));
  return found;
}
