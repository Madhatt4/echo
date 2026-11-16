// The assistant door's store on disk.
//
// It lives beside Echo's settings, not inside the archive, so it is there when
// the archive is locked. It has its own random key, kept in a file next to it:
// the assistant has to be able to use it with nobody there. That means the
// store is only as private as the person's Windows account and disk, and the
// screens say so. The archive's key is never written here.

import { randomBytes, randomUUID } from 'node:crypto';
import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { DOOR_USE_KINDS } from '../shared/door.ts';
import type { DoorStore, DoorUse, TrayItem } from '../shared/door.ts';
import { readSealedFile, writeSealedFile } from './sealed.ts';

export const DOOR_FOLDER_NAME = 'assistant-door';
const KEY_FILENAME = 'door-key.json';
const STORE_FILENAME = 'store.sealed';
const PURPOSE = 'echo/door/store/v1';
const USES_FILENAME = 'door-uses.jsonl';
/** Past this size the list of uses is not added to. Echo empties it each time the archive is opened. */
const MAX_USES_BYTES = 512 * 1024;

interface DoorKeyFile {
  version: 1;
  /** The store's own key, base64. Not the archive's key, and not made from it. */
  key: string;
  turnedOnAt: string;
}

/** The door's folder, beside the settings file. */
export function doorFolder(configFile: string): string {
  return path.join(path.dirname(configFile), DOOR_FOLDER_NAME);
}

function readKeyFile(folder: string): DoorKeyFile | null {
  try {
    const parsed = JSON.parse(readFileSync(path.join(folder, KEY_FILENAME), 'utf8')) as DoorKeyFile;
    return parsed.version === 1 && typeof parsed.key === 'string' && Buffer.from(parsed.key, 'base64').length === 32 ? parsed : null;
  } catch {
    return null;
  }
}

/** When the door was turned on, or null if it is off. */
export function doorTurnedOnAt(folder: string): string | null {
  return readKeyFile(folder)?.turnedOnAt ?? null;
}

/** Turns the door on: makes the folder and a fresh key. Does nothing if it is already on. */
export function openDoor(folder: string): void {
  if (readKeyFile(folder)) return;
  mkdirSync(folder, { recursive: true });
  const file: DoorKeyFile = { version: 1, key: randomBytes(32).toString('base64'), turnedOnAt: new Date().toISOString() };
  writeFileSync(path.join(folder, KEY_FILENAME), `${JSON.stringify(file, null, 2)}\n`, { mode: 0o600 });
}

/** Turns the door off: the store and its key are deleted. */
export function closeDoor(folder: string): void {
  if (existsSync(folder)) rmSync(folder, { recursive: true, force: true });
}

/** Writes the store. Does nothing if the door is off. */
export function writeDoorStore(folder: string, store: DoorStore): void {
  const keyFile = readKeyFile(folder);
  if (!keyFile) return;
  writeSealedFile(path.join(folder, STORE_FILENAME), Buffer.from(keyFile.key, 'base64'), PURPOSE, store);
}

/** Reads the store with the door's own key. Null if the door is off or nothing has been written. */
export function readDoorStore(folder: string): DoorStore | null {
  const keyFile = readKeyFile(folder);
  if (!keyFile) return null;
  try {
    return readSealedFile<DoorStore>(path.join(folder, STORE_FILENAME), Buffer.from(keyFile.key, 'base64'), PURPOSE);
  } catch {
    return null;
  }
}

/**
 * Writes down one use of the door: when, what kind, how many results. Never
 * any words. Echo copies these into the activity log the next time the
 * archive is open. Best effort: failing to write it down never stops a read.
 */
export function noteDoorUse(folder: string, use: DoorUse): void {
  try {
    const file = path.join(folder, USES_FILENAME);
    if (existsSync(file) && statSync(file).size > MAX_USES_BYTES) return;
    appendFileSync(file, `${JSON.stringify(use)}\n`);
  } catch {
    // Nothing to do: the read itself has already happened.
  }
}

/** Takes the uses written down since last time, and empties the list. */
export function takeDoorUses(folder: string): DoorUse[] {
  const file = path.join(folder, USES_FILENAME);
  let lines: string[];
  try {
    lines = readFileSync(file, 'utf8').split('\n');
    rmSync(file, { force: true });
  } catch {
    return [];
  }
  const uses: DoorUse[] = [];
  for (const line of lines) {
    try {
      const use = JSON.parse(line) as DoorUse;
      if (typeof use.at === 'string' && (DOOR_USE_KINDS as readonly string[]).includes(use.command) && typeof use.results === 'number') uses.push(use);
    } catch {
      // A damaged line is not worth losing the rest for.
    }
  }
  return uses;
}

// ---------- the tray ----------

const TRAY_FOLDER = 'tray';
const TRAY_PURPOSE = 'echo/door/tray/v1';

/** The door's own key, or null if the door is off. */
export function doorKeyOf(folder: string): Buffer | null {
  const keyFile = readKeyFile(folder);
  return keyFile ? Buffer.from(keyFile.key, 'base64') : null;
}

const doorKey = doorKeyOf;

/** Everything waiting in the tray, oldest first. Empty if the door is off. */
export function readTray(folder: string): TrayItem[] {
  const key = doorKey(folder);
  if (!key) return [];
  let names: string[];
  try {
    names = readdirSync(path.join(folder, TRAY_FOLDER)).filter((name) => name.endsWith('.sealed'));
  } catch {
    return [];
  }
  const items: TrayItem[] = [];
  for (const name of names) {
    try {
      const item = readSealedFile<TrayItem>(path.join(folder, TRAY_FOLDER, name), key, TRAY_PURPOSE);
      if (item && (item.kind === 'file' || item.kind === 'words') && typeof item.id === 'string') items.push(item);
    } catch {
      // A damaged item is left where it is and not shown.
    }
  }
  return items.sort((a, b) => a.at.localeCompare(b.at));
}

/** Leaves one thing in the tray and returns it. Null if the door is off. */
export function addTrayItem(folder: string, item: Omit<Extract<TrayItem, { kind: 'file' }>, 'id' | 'at'> | Omit<Extract<TrayItem, { kind: 'words' }>, 'id' | 'at'>): TrayItem | null {
  const key = doorKey(folder);
  if (!key) return null;
  // Two things left in the same instant still keep the order they were left in.
  const latest = readTray(folder).reduce((most, one) => Math.max(most, Date.parse(one.at) || 0), 0);
  const left = { ...item, id: randomUUID(), at: new Date(Math.max(Date.now(), latest + 1)).toISOString() } as TrayItem;
  mkdirSync(path.join(folder, TRAY_FOLDER), { recursive: true });
  writeSealedFile(path.join(folder, TRAY_FOLDER, `${left.id}.sealed`), key, TRAY_PURPOSE, left);
  return left;
}

/** Takes one thing out of the tray. False if it was not there. */
export function removeTrayItem(folder: string, id: string): boolean {
  if (!/^[0-9a-f-]{36}$/.test(id)) return false;
  const file = path.join(folder, TRAY_FOLDER, `${id}.sealed`);
  if (!existsSync(file)) return false;
  rmSync(file, { force: true });
  return true;
}
