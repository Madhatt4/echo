// The interview so far, kept encrypted inside the archive.

import path from 'node:path';
import type { Audience } from '../shared/people.ts';
import { readSealedFile, writeSealedFile } from './sealed.ts';

const INTERVIEW_FILENAME = 'interview.sealed';
const PURPOSE = 'echo/interview/v1';

export interface StoredExchange {
  question: string;
  answer: string;
  answeredAt: string;
  /** The encrypted recording of a spoken answer, if there was one. */
  mediaId?: string;
  mimeType?: string;
  /** Who may hear this answer from the echo. Absent means everyone. */
  audience?: Audience;
}

export interface StoredTopic {
  /** The question waiting for an answer. */
  pending: string | null;
  done: boolean;
  exchanges: StoredExchange[];
}

/** Keyed by topic id. A topic that has never been opened is simply absent. */
export type StoredInterview = Record<string, StoredTopic>;

export function loadInterview(archiveDir: string, masterKey: Buffer): StoredInterview {
  return readSealedFile<{ topics: StoredInterview }>(path.join(archiveDir, INTERVIEW_FILENAME), masterKey, PURPOSE)?.topics ?? {};
}

export function saveInterview(archiveDir: string, masterKey: Buffer, topics: StoredInterview): void {
  writeSealedFile(path.join(archiveDir, INTERVIEW_FILENAME), masterKey, PURPOSE, { topics });
}
