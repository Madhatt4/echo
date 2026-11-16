// The memory store, kept as one encrypted document inside the archive.
//
// It is read into memory whole and searched there. At the size this app deals
// with (tens of thousands of short passages at most) that is fast, and it
// means there is no database engine to build, ship or keep in step with the
// app. tests/memories.test.ts measures it at 50,000 passages.

import path from 'node:path';
import type { Memory } from '../shared/memories.ts';
import { readSealedFile, writeSealedFile } from './sealed.ts';

const MEMORIES_FILENAME = 'memories.sealed';
const PURPOSE = 'echo/memories/v1';

function file(archiveDir: string): string {
  return path.join(archiveDir, MEMORIES_FILENAME);
}

export function loadMemories(archiveDir: string, masterKey: Buffer): Memory[] {
  return readSealedFile<{ memories: Memory[] }>(file(archiveDir), masterKey, PURPOSE)?.memories ?? [];
}

export function saveMemories(archiveDir: string, masterKey: Buffer, memories: readonly Memory[]): void {
  writeSealedFile(file(archiveDir), masterKey, PURPOSE, { memories });
}
