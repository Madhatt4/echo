// The letters the person wrote, kept encrypted inside the archive. The
// picture of each page is a separate encrypted file.

import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { tidyLetter } from '../shared/letters.ts';
import type { LetterDetails } from '../shared/letters.ts';
import type { Audience } from '../shared/people.ts';
import { readSealedFile, writeSealedFile } from './sealed.ts';

const LETTERS_FILENAME = 'letters.sealed';
const PURPOSE = 'echo/letters/v1';

export interface StoredLetter {
  id: string;
  title: string;
  personId: string | null;
  writtenOn: string;
  text: string;
  audience: Audience;
  savedAt: string;
  /** The encrypted picture of each page, in order. */
  pages: { mediaId: string; mimeType: string }[];
}

function file(archiveDir: string): string {
  return path.join(archiveDir, LETTERS_FILENAME);
}

export function loadLetters(archiveDir: string, masterKey: Buffer): StoredLetter[] {
  return readSealedFile<{ letters: StoredLetter[] }>(file(archiveDir), masterKey, PURPOSE)?.letters ?? [];
}

function saveLetters(archiveDir: string, masterKey: Buffer, letters: StoredLetter[]): void {
  writeSealedFile(file(archiveDir), masterKey, PURPOSE, { letters });
}

export function addLetter(archiveDir: string, masterKey: Buffer, details: LetterDetails, pages: StoredLetter['pages']): StoredLetter {
  const letter: StoredLetter = { id: randomUUID(), ...tidyLetter(details), savedAt: new Date().toISOString(), pages };
  saveLetters(archiveDir, masterKey, [...loadLetters(archiveDir, masterKey), letter]);
  return letter;
}

/** Returns false if there is no such letter. */
export function changeLetter(archiveDir: string, masterKey: Buffer, id: string, details: LetterDetails): boolean {
  const all = loadLetters(archiveDir, masterKey);
  if (!all.some((letter) => letter.id === id)) return false;
  saveLetters(archiveDir, masterKey, all.map((letter) => (letter.id === id ? { ...letter, ...tidyLetter(details) } : letter)));
  return true;
}

/** Removes a letter and returns it, so the pictures of its pages can be removed too. */
export function removeLetter(archiveDir: string, masterKey: Buffer, id: string): StoredLetter | null {
  const all = loadLetters(archiveDir, masterKey);
  const found = all.find((letter) => letter.id === id) ?? null;
  if (found) saveLetters(archiveDir, masterKey, all.filter((letter) => letter.id !== id));
  return found;
}
