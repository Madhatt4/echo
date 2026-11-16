// Backup: a second copy of the archive on another drive.
//
// Everything in the archive is already encrypted, so the backup is a faithful
// copy of the same files and needs no key to make. It can only be opened with
// the passphrase or the recovery kit, exactly like the original.

import { createHash } from 'node:crypto';
import { createReadStream, existsSync } from 'node:fs';
import { copyFile, mkdir, readFile, readdir, rename, stat, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { VAULT_FILENAME, readVault } from './vault.ts';

export const BACKUP_FOLDER_NAME = 'Echo Backup';
const INFO_FILENAME = 'backup-info.json';
const PREVIOUS_SUFFIX = '.previous';
const TEMPORARY_SUFFIX = '.writing';

export interface BackupSummary {
  /** Files in the archive. */
  files: number;
  /** Files that had to be copied this time. */
  copied: number;
  bytesCopied: number;
}

export interface BackupCheck {
  ok: boolean;
  files: number;
  /** Files in the archive that are not in the backup. */
  missing: string[];
  /** Files whose backup copy does not match the archive. */
  different: string[];
}

interface BackupInfo {
  archiveId: string;
  backedUpAt: string;
  files: number;
}

/** Every file under `dir`, as paths relative to it, skipping half-written and bookkeeping files. */
async function listFiles(dir: string, base = ''): Promise<string[]> {
  const found: string[] = [];
  for (const entry of await readdir(path.join(dir, base), { withFileTypes: true })) {
    const relative = path.join(base, entry.name);
    if (entry.isDirectory()) found.push(...(await listFiles(dir, relative)));
    else if (entry.isFile() && !entry.name.endsWith(TEMPORARY_SUFFIX) && !entry.name.endsWith(PREVIOUS_SUFFIX) && relative !== INFO_FILENAME) {
      found.push(relative);
    }
  }
  return found.sort();
}

function fingerprint(file: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha256');
    createReadStream(file)
      .on('data', (chunk) => hash.update(chunk))
      .on('error', reject)
      .on('end', () => resolve(hash.digest('hex')));
  });
}

async function sameContents(a: string, b: string): Promise<boolean> {
  if (!existsSync(b)) return false;
  const [sizeA, sizeB] = await Promise.all([stat(a), stat(b)]);
  if (sizeA.size !== sizeB.size) return false;
  const [hashA, hashB] = await Promise.all([fingerprint(a), fingerprint(b)]);
  return hashA === hashB;
}

async function readInfo(backupDir: string): Promise<BackupInfo | null> {
  try {
    return JSON.parse(await readFile(path.join(backupDir, INFO_FILENAME), 'utf8')) as BackupInfo;
  } catch {
    return null;
  }
}

/** Copies one file so that the destination is never left half-written. */
async function copySafely(from: string, to: string): Promise<void> {
  await mkdir(path.dirname(to), { recursive: true });
  const temporary = `${to}${TEMPORARY_SUFFIX}`;
  await copyFile(from, temporary);
  if (!(await sameContents(from, temporary))) {
    await unlink(temporary).catch(() => undefined);
    throw new Error(`The copy of ${path.basename(from)} did not match the original.`);
  }
  await rename(temporary, to);
}

/**
 * Plain-English reasons this folder cannot be used for the backup.
 * `location` is the folder the person chose; the backup goes in `Echo Backup` inside it.
 */
export function backupLocationProblems(archiveDir: string, location: string, allowSameDrive = false): string[] {
  if (!location || !path.isAbsolute(location)) return ['Choose a folder on another drive to keep the backup in.'];
  if (!existsSync(location)) return [`Echo cannot find ${location}. If it is on a drive that is unplugged, plug the drive in.`];
  const archive = path.resolve(archiveDir);
  const chosen = path.resolve(location);
  const inside = (child: string, parent: string) => child === parent || child.startsWith(parent + path.sep);
  if (inside(chosen, archive)) return ['That folder is inside your archive. A backup has to be somewhere else.'];
  if (!allowSameDrive && path.parse(chosen).root.toLowerCase() === path.parse(archive).root.toLowerCase()) {
    return [
      `That folder is on the same drive as your archive (${path.parse(archive).root}). If that drive fails, both copies are lost. Choose a folder on an external drive or USB stick.`,
    ];
  }
  return [];
}

/** The folder a backup lives in, given the folder the person chose. */
export function backupDirIn(location: string): string {
  return path.join(location, BACKUP_FOLDER_NAME);
}

/**
 * Brings the backup up to date with the archive. Files that have not changed
 * are left alone. Before a changed file is replaced, the copy it replaces is
 * kept beside it as `.previous`, so one damaged file on the PC cannot wipe out
 * the last good copy. Nothing is ever deleted from the backup here.
 */
export async function backupArchive(archiveDir: string, backupDir: string): Promise<BackupSummary> {
  const vault = readVault(archiveDir);
  if (!vault) throw new Error('There is no archive to back up.');

  const info = await readInfo(backupDir);
  if (info && info.archiveId !== vault.archiveId) {
    throw new Error('That folder already holds the backup of a different archive. Choose another folder.');
  }
  if (!info && existsSync(path.join(backupDir, VAULT_FILENAME))) {
    const existing = readVault(backupDir);
    if (existing && existing.archiveId !== vault.archiveId) {
      throw new Error('That folder already holds a different archive. Choose another folder.');
    }
  }

  await mkdir(backupDir, { recursive: true });
  const files = await listFiles(archiveDir);
  let copied = 0;
  let bytesCopied = 0;
  for (const relative of files) {
    const from = path.join(archiveDir, relative);
    const to = path.join(backupDir, relative);
    if (await sameContents(from, to)) continue;
    if (existsSync(to)) await rename(to, `${to}${PREVIOUS_SUFFIX}`);
    await copySafely(from, to);
    copied += 1;
    bytesCopied += (await stat(from)).size;
  }

  const written: BackupInfo = { archiveId: vault.archiveId, backedUpAt: new Date().toISOString(), files: files.length };
  await writeFile(path.join(backupDir, INFO_FILENAME), `${JSON.stringify(written, null, 2)}\n`, 'utf8');
  return { files: files.length, copied, bytesCopied };
}

/** Compares every file in the archive with its copy in the backup, byte for byte. */
export async function checkBackup(archiveDir: string, backupDir: string): Promise<BackupCheck> {
  const files = await listFiles(archiveDir);
  const missing: string[] = [];
  const different: string[] = [];
  for (const relative of files) {
    const copy = path.join(backupDir, relative);
    if (!existsSync(copy)) missing.push(relative);
    else if (!(await sameContents(path.join(archiveDir, relative), copy))) different.push(relative);
  }
  return { ok: missing.length === 0 && different.length === 0, files: files.length, missing, different };
}

/**
 * Copies a backup into a new archive folder. The folder must not already hold
 * anything. Every file is checked against the backup as it is copied.
 */
export async function restoreArchive(backupDir: string, archiveDir: string): Promise<number> {
  if (!readVault(backupDir)) throw new Error('There is no Echo backup in that folder.');
  if (existsSync(archiveDir) && (await readdir(archiveDir)).length > 0) {
    throw new Error(`${archiveDir} already has files in it. Echo will not restore over them.`);
  }
  const files = await listFiles(backupDir);
  for (const relative of files) await copySafely(path.join(backupDir, relative), path.join(archiveDir, relative));
  return files.length;
}
