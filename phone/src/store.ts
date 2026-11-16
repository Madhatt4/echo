// What the phone keeps: its own keys, the PC it is paired with, and the
// recordings waiting to go. Recordings are sealed for the PC the moment they
// are kept, so only sealed bytes are ever written to the phone's storage.

import { Directory, Filesystem } from '@capacitor/filesystem';
import { Preferences } from '@capacitor/preferences';
import { makePhoneKeys, toBase64 } from './link.ts';
import type { PairingCode, PhoneKeys } from './link.ts';

/** The PC this phone sends to. */
export interface PairedPc {
  host: string;
  port: number;
  /** The PC's public key. */
  pc: string;
  /** The id the PC gave this phone. */
  phoneId: string;
  name: string;
  pairedAt: string;
}

/** A recording sealed and waiting to be sent. The bytes are in a file of its own. */
export interface Waiting {
  id: string;
  recordedAt: string;
  prompt: string;
  seconds: number;
}

const KEYS = 'echo.keys';
const PC = 'echo.pc';
const QUEUE = 'echo.queue';
const ASKED = 'echo.asked';
const FOLDER = 'outbox';

async function read<T>(key: string): Promise<T | null> {
  const { value } = await Preferences.get({ key });
  if (!value) return null;
  try {
    return JSON.parse(value) as T;
  } catch {
    return null;
  }
}

const write = (key: string, value: unknown): Promise<void> => Preferences.set({ key, value: JSON.stringify(value) });

/** This phone's keys, made the first time they are needed. */
export async function phoneKeys(): Promise<PhoneKeys> {
  const kept = await read<PhoneKeys>(KEYS);
  if (kept) return kept;
  const keys = makePhoneKeys();
  await write(KEYS, keys);
  return keys;
}

export const pairedPc = (): Promise<PairedPc | null> => read<PairedPc>(PC);

export function rememberPc(code: PairingCode, phoneId: string, name: string, at: Date): Promise<void> {
  const paired: PairedPc = { host: code.host, port: code.port, pc: code.pc, phoneId, name, pairedAt: at.toISOString() };
  return write(PC, paired);
}

/** Forgets the PC. Recordings still waiting are kept, sealed, in case it is paired again. */
export const forgetPc = (): Promise<void> => Preferences.remove({ key: PC });

export async function waiting(): Promise<Waiting[]> {
  return (await read<Waiting[]>(QUEUE)) ?? [];
}

const fileFor = (id: string): string => `${FOLDER}/${id}.sealed`;

export async function keep(item: Waiting, envelope: Uint8Array): Promise<void> {
  await Filesystem.writeFile({ path: fileFor(item.id), data: toBase64(envelope), directory: Directory.Data, recursive: true });
  await write(QUEUE, [...(await waiting()).filter((other) => other.id !== item.id), item]);
}

/** The sealed envelope, base64, ready for the native HTTP call. */
export async function envelopeOf(id: string): Promise<string> {
  const { data } = await Filesystem.readFile({ path: fileFor(id), directory: Directory.Data });
  return typeof data === 'string' ? data : await blobToBase64(data);
}

/** Called only on a receipt that checks out. */
export async function sent(id: string): Promise<void> {
  await write(QUEUE, (await waiting()).filter((item) => item.id !== id));
  try {
    await Filesystem.deleteFile({ path: fileFor(id), directory: Directory.Data });
  } catch {
    // Already gone. The queue entry is what matters.
  }
}

export async function askedPrompts(): Promise<string[]> {
  return (await read<string[]>(ASKED)) ?? [];
}

export async function markAsked(prompt: string): Promise<void> {
  const asked = await askedPrompts();
  if (prompt && !asked.includes(prompt)) await write(ASKED, [...asked, prompt]);
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(',')[1] ?? '');
    reader.onerror = () => reject(reader.error ?? new Error('Could not read the recording.'));
    reader.readAsDataURL(blob);
  });
}
