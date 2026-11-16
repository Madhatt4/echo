// Notes approved from the assistant's tray, kept encrypted inside the archive.

import { randomUUID } from 'node:crypto';
import path from 'node:path';
import type { Note, NoteDetails } from '../shared/notes.ts';
import { readSealedFile, writeSealedFile } from './sealed.ts';

const NOTES_FILENAME = 'notes.sealed';
const PURPOSE = 'echo/notes/v1';

function file(archiveDir: string): string {
  return path.join(archiveDir, NOTES_FILENAME);
}

export function loadNotes(archiveDir: string, masterKey: Buffer): Note[] {
  return readSealedFile<{ notes: Note[] }>(file(archiveDir), masterKey, PURPOSE)?.notes ?? [];
}

export function addNote(archiveDir: string, masterKey: Buffer, details: NoteDetails): Note {
  const note: Note = {
    id: randomUUID(),
    title: details.title.trim(),
    text: details.text.replace(/\r\n?/g, '\n').replace(/\n{3,}/g, '\n\n').trim(),
    audience: details.audience,
    approvedAt: new Date().toISOString(),
  };
  writeSealedFile(file(archiveDir), masterKey, PURPOSE, { notes: [...loadNotes(archiveDir, masterKey), note] });
  return note;
}

/** Returns false if there is no such note. */
export function removeNote(archiveDir: string, masterKey: Buffer, id: string): boolean {
  const all = loadNotes(archiveDir, masterKey);
  if (!all.some((note) => note.id === id)) return false;
  writeSealedFile(file(archiveDir), masterKey, PURPOSE, { notes: all.filter((note) => note.id !== id) });
  return true;
}
