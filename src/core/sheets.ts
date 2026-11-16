// The character sheet and the style profile, each kept as its own encrypted
// document inside the archive.

import path from 'node:path';
import { EMPTY_SHEET } from '../shared/sheets.ts';
import type { Sheet, SheetKind } from '../shared/sheets.ts';
import { readSealedFile, writeSealedFile } from './sealed.ts';

const FILES: Record<SheetKind, { name: string; purpose: string }> = {
  character: { name: 'character.sealed', purpose: 'echo/character/v1' },
  style: { name: 'style.sealed', purpose: 'echo/style/v1' },
};

export function loadSheet(archiveDir: string, masterKey: Buffer, kind: SheetKind): Sheet {
  return readSealedFile<Sheet>(path.join(archiveDir, FILES[kind].name), masterKey, FILES[kind].purpose) ?? { ...EMPTY_SHEET };
}

export function saveSheet(archiveDir: string, masterKey: Buffer, kind: SheetKind, sheet: Sheet): void {
  writeSealedFile(path.join(archiveDir, FILES[kind].name), masterKey, FILES[kind].purpose, sheet);
}
