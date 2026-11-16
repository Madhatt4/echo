// Conversations with the echo, kept as one encrypted document inside the archive.

import path from 'node:path';
import type { StoredChats } from '../shared/chat.ts';
import { readSealedFile, writeSealedFile } from './sealed.ts';

const CHATS_FILENAME = 'conversations.sealed';
const PURPOSE = 'echo/conversations/v1';

export function loadChats(archiveDir: string, masterKey: Buffer): StoredChats {
  return readSealedFile<StoredChats>(path.join(archiveDir, CHATS_FILENAME), masterKey, PURPOSE) ?? {};
}

export function saveChats(archiveDir: string, masterKey: Buffer, chats: StoredChats): void {
  writeSealedFile(path.join(archiveDir, CHATS_FILENAME), masterKey, PURPOSE, chats);
}
