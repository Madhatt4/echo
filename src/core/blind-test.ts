// Blind tests, kept as one encrypted document inside the archive. This file
// is never read by the memory store, so the person's own answers to the test
// questions can never reach the echo.

import path from 'node:path';
import type { BlindTest } from '../shared/blind-test.ts';
import { readSealedFile, writeSealedFile } from './sealed.ts';

const FILENAME = 'blind-test.sealed';
const PURPOSE = 'echo/blind-test/v1';

/** Every test, oldest first. The last one is the current one. */
export function loadBlindTests(archiveDir: string, masterKey: Buffer): BlindTest[] {
  return readSealedFile<{ tests: BlindTest[] }>(path.join(archiveDir, FILENAME), masterKey, PURPOSE)?.tests ?? [];
}

export function saveBlindTests(archiveDir: string, masterKey: Buffer, tests: readonly BlindTest[]): void {
  writeSealedFile(path.join(archiveDir, FILENAME), masterKey, PURPOSE, { tests });
}
