// Imported conversations, encrypted inside the archive. A small index lists
// them; each conversation's messages are in a file of their own, so opening
// the list does not mean decrypting every message ever imported.

import { existsSync, mkdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import type { ImportSummary, ImportedMessage } from '../shared/imports.ts';
import { readSealedFile, writeSealedFile } from './sealed.ts';

const INDEX_FILENAME = 'imports.sealed';
const INDEX_PURPOSE = 'echo/imports/v1';
const FOLDER = 'imports';
const CONVERSATION_PURPOSE = 'echo/import/v1';

function conversationFile(archiveDir: string, id: string): string {
  return path.join(archiveDir, FOLDER, `${id}.sealed`);
}

export function loadImports(archiveDir: string, masterKey: Buffer): ImportSummary[] {
  return readSealedFile<{ imports: ImportSummary[] }>(path.join(archiveDir, INDEX_FILENAME), masterKey, INDEX_PURPOSE)?.imports ?? [];
}

function saveImports(archiveDir: string, masterKey: Buffer, imports: readonly ImportSummary[]): void {
  writeSealedFile(path.join(archiveDir, INDEX_FILENAME), masterKey, INDEX_PURPOSE, { imports });
}

export function loadImportedMessages(archiveDir: string, masterKey: Buffer, id: string): ImportedMessage[] {
  return readSealedFile<{ messages: ImportedMessage[] }>(conversationFile(archiveDir, id), masterKey, CONVERSATION_PURPOSE)?.messages ?? [];
}

/** Saves a conversation: its messages first, then its line in the index. */
export function addImport(archiveDir: string, masterKey: Buffer, summary: ImportSummary, messages: readonly ImportedMessage[]): void {
  mkdirSync(path.join(archiveDir, FOLDER), { recursive: true });
  writeSealedFile(conversationFile(archiveDir, summary.id), masterKey, CONVERSATION_PURPOSE, { messages });
  saveImports(archiveDir, masterKey, [...loadImports(archiveDir, masterKey), summary]);
}

/** Removes a conversation and everything in it. Returns false if there is no such conversation. */
export function removeImport(archiveDir: string, masterKey: Buffer, id: string): boolean {
  const imports = loadImports(archiveDir, masterKey);
  if (!imports.some((summary) => summary.id === id)) return false;
  saveImports(archiveDir, masterKey, imports.filter((summary) => summary.id !== id));
  const file = conversationFile(archiveDir, id);
  if (existsSync(file)) rmSync(file);
  return true;
}
