// Memory times and put-away questions, kept encrypted inside the archive so the
// phone can read the schedule once it is paired.

import path from 'node:path';
import { NO_MEMORY_TIMES } from '../shared/memory-times.ts';
import type { MemorySchedule } from '../shared/memory-times.ts';
import { readSealedFile, writeSealedFile } from './sealed.ts';

const FILENAME = 'memory-times.sealed';
const PURPOSE = 'echo/memory-times/v1';

export interface RetiredPrompt {
  text: string;
  /** When it was put away, ISO. Counts as having come to that day's memory time. */
  at: string;
}

export interface MemoryTimesStore {
  schedule: MemorySchedule;
  retired: RetiredPrompt[];
}

function file(archiveDir: string): string {
  return path.join(archiveDir, FILENAME);
}

export function loadMemoryTimes(archiveDir: string, masterKey: Buffer): MemoryTimesStore {
  const stored = readSealedFile<Partial<MemoryTimesStore>>(file(archiveDir), masterKey, PURPOSE);
  return { schedule: stored?.schedule ?? NO_MEMORY_TIMES, retired: stored?.retired ?? [] };
}

function save(archiveDir: string, masterKey: Buffer, store: MemoryTimesStore): void {
  writeSealedFile(file(archiveDir), masterKey, PURPOSE, store);
}

export function saveSchedule(archiveDir: string, masterKey: Buffer, schedule: MemorySchedule): void {
  const store = loadMemoryTimes(archiveDir, masterKey);
  const days = [...new Set(schedule.days)].sort((a, b) => a - b);
  save(archiveDir, masterKey, { ...store, schedule: { days, time: schedule.time, minutes: schedule.minutes } });
}

/** Puts a question away for good. Returns false if it was already put away. */
export function retirePrompt(archiveDir: string, masterKey: Buffer, text: string, at: Date): boolean {
  const store = loadMemoryTimes(archiveDir, masterKey);
  const question = text.trim();
  if (store.retired.some((retired) => retired.text === question)) return false;
  save(archiveDir, masterKey, { ...store, retired: [...store.retired, { text: question, at: at.toISOString() }] });
  return true;
}

/** Brings a put-away question back, for a press made by mistake. Returns false if it was not put away. */
export function restorePrompt(archiveDir: string, masterKey: Buffer, text: string): boolean {
  const store = loadMemoryTimes(archiveDir, masterKey);
  const question = text.trim();
  if (!store.retired.some((retired) => retired.text === question)) return false;
  save(archiveDir, masterKey, { ...store, retired: store.retired.filter((retired) => retired.text !== question) });
  return true;
}
