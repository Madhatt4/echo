// Settings that are secret, kept encrypted inside the archive. Today that is
// the person's own AI key.

import path from 'node:path';
import { readSealedFile, writeSealedFile } from './sealed.ts';

const SETTINGS_FILENAME = 'settings.sealed';
const PURPOSE = 'echo/settings/v1';

export interface ArchiveSettings {
  aiKey?: {
    provider: 'anthropic';
    key: string;
    /** When the key last passed a live test. */
    testedAt: string;
  };
  backup?: {
    /** The folder the person chose. The backup lives in `Echo Backup` inside it. */
    location: string;
    /** When the backup last finished successfully. */
    lastAt?: string;
    lastFiles?: number;
    /** Why the most recent attempt failed, in plain English. Cleared on success. */
    lastProblem?: string;
  };
  door?: {
    /** True if the person has let their assistant's questions to the echo be paid for with their own AI key. */
    sharesAiKey?: boolean;
  };
}

export function loadSettings(archiveDir: string, masterKey: Buffer): ArchiveSettings {
  return readSealedFile<ArchiveSettings>(path.join(archiveDir, SETTINGS_FILENAME), masterKey, PURPOSE) ?? {};
}

export function saveSettings(archiveDir: string, masterKey: Buffer, settings: ArchiveSettings): void {
  writeSealedFile(path.join(archiveDir, SETTINGS_FILENAME), masterKey, PURPOSE, settings);
}
