// The list of face and voice master recordings, kept encrypted inside the
// archive. Each recording's contents are a separate encrypted file.

import { randomUUID } from 'node:crypto';
import path from 'node:path';
import type { Capture, CaptureGroup } from '../shared/capture-guides.ts';
import { readSealedFile, writeSealedFile } from './sealed.ts';

const CAPTURES_FILENAME = 'captures.sealed';
const PURPOSE = 'echo/captures/v1';

/** A capture as stored: what the screen sees, plus where its contents are kept. */
export interface StoredCapture extends Capture {
  mediaId: string;
  mimeType: string;
}

function file(archiveDir: string): string {
  return path.join(archiveDir, CAPTURES_FILENAME);
}

export function loadCaptures(archiveDir: string, masterKey: Buffer): StoredCapture[] {
  return readSealedFile<{ captures: StoredCapture[] }>(file(archiveDir), masterKey, PURPOSE)?.captures ?? [];
}

function saveCaptures(archiveDir: string, masterKey: Buffer, captures: StoredCapture[]): void {
  writeSealedFile(file(archiveDir), masterKey, PURPOSE, { captures });
}

export function addCapture(
  archiveDir: string,
  masterKey: Buffer,
  details: { group: CaptureGroup; label: string; seconds: number; mediaId: string; mimeType: string },
): StoredCapture {
  const capture: StoredCapture = {
    id: randomUUID(),
    group: details.group,
    label: details.label,
    seconds: Math.round(details.seconds),
    takenAt: new Date().toISOString(),
    mediaId: details.mediaId,
    mimeType: details.mimeType,
  };
  saveCaptures(archiveDir, masterKey, [...loadCaptures(archiveDir, masterKey), capture]);
  return capture;
}

/** Removes a capture from the list and returns it, so its contents can be removed too. */
export function removeCapture(archiveDir: string, masterKey: Buffer, id: string): StoredCapture | null {
  const captures = loadCaptures(archiveDir, masterKey);
  const found = captures.find((capture) => capture.id === id) ?? null;
  if (found) saveCaptures(archiveDir, masterKey, captures.filter((capture) => capture.id !== id));
  return found;
}
