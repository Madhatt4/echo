// Reads text messages and iMessages out of an iPhone backup made on this
// computer by Apple Devices or iTunes. Apple gives no way to export messages,
// so the backup is the only route.
//
// A backup is a folder of files named by a fingerprint of where they lived on
// the phone. The messages are one SQLite database, "Library/SMS/sms.db". The
// names in the phone's contacts are in another. Both are opened read-only, in
// place: nothing is copied out and the backup is never changed.
//
// An encrypted backup is recognised and refused here. Reading those arrives
// at build step 17b.

import { createHash } from 'node:crypto';
import { closeSync, existsSync, openSync, readFileSync, readSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { ThreadChoice } from '../shared/imports.ts';
import { APPLE_EPOCH_MS, comparableHandle, messageWords } from '../shared/iphone.ts';
import type { IphoneBackup } from '../shared/iphone.ts';
import { localStamp } from '../shared/messenger.ts';
import type { ChatMessage, ParsedChat } from '../shared/whatsapp.ts';

export const SMS_FILE = { domain: 'HomeDomain', relativePath: 'Library/SMS/sms.db' };
export const CONTACTS_FILE = { domain: 'HomeDomain', relativePath: 'Library/AddressBook/AddressBook.sqlitedb' };

/** The name a file from the phone has inside a backup. */
export function backupFileName(file: { domain: string; relativePath: string }): string {
  return createHash('sha1').update(`${file.domain}-${file.relativePath}`).digest('hex');
}

/** Where a file from the phone is inside a backup, or null if the backup does not hold it. */
export function backupFilePath(backupDir: string, file: { domain: string; relativePath: string }): string | null {
  const name = backupFileName(file);
  // Newer backups sort files into folders by the first two characters of the name. Older ones do not.
  for (const candidate of [path.join(backupDir, name.slice(0, 2), name), path.join(backupDir, name)]) {
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

/** True if a file is a SQLite database that can be read as it is. In an encrypted backup it is not. */
export function isReadableDatabase(file: string): boolean {
  const fd = openSync(file, 'r');
  try {
    const head = Buffer.alloc(16);
    readSync(fd, head, 0, 16, 0);
    return head.toString('latin1') === 'SQLite format 3\u0000';
  } finally {
    closeSync(fd);
  }
}

/** The iPhone backups in the given folders, newest first. A folder that does not exist is skipped. */
export function findBackups(roots: readonly string[]): IphoneBackup[] {
  const backups: IphoneBackup[] = [];
  for (const root of roots) {
    if (!existsSync(root)) continue;
    for (const entry of readdirSync(root, { withFileTypes: true })) {
      const folder = path.join(root, entry.name);
      if (!entry.isDirectory() || !existsSync(path.join(folder, 'Manifest.db'))) continue;
      let device = '';
      let madeAt: string | null = null;
      try {
        const info = readFileSync(path.join(folder, 'Info.plist'), 'utf8');
        device = /<key>Device Name<\/key>\s*<string>([^<]*)<\/string>/.exec(info)?.[1] ?? '';
        madeAt = /<key>Last Backup Date<\/key>\s*<date>([^<]*)<\/date>/.exec(info)?.[1] ?? null;
      } catch {
        // The backup does not describe itself in a way Echo can read. It is still listed.
      }
      backups.push({ folder, device, madeAt: madeAt ?? statSync(path.join(folder, 'Manifest.db')).mtime.toISOString() });
    }
  }
  return backups.sort((a, b) => (b.madeAt ?? '').localeCompare(a.madeAt ?? ''));
}

/**
 * Names from the phone's contacts, by phone number and email address. An
 * empty list if the contacts cannot be read: the conversations are then shown
 * by number.
 */
export function loadContacts(backupDir: string): Map<string, string> {
  return loadContactsFrom(backupFilePath(backupDir, CONTACTS_FILE));
}

/** The same, from the contacts database itself. */
export function loadContactsFrom(file: string | null): Map<string, string> {
  const names = new Map<string, string>();
  if (!file || !isReadableDatabase(file)) return names;
  let db: DatabaseSync | null = null;
  try {
    db = new DatabaseSync(file, { readOnly: true });
    const rows = db
      .prepare('SELECT p.First AS first, p.Last AS last, p.Organization AS organization, v.value AS value FROM ABMultiValue v JOIN ABPerson p ON p.ROWID = v.record_id WHERE v.value IS NOT NULL')
      .all();
    for (const row of rows) {
      const name = [row.first, row.last].filter((part) => typeof part === 'string' && part.length > 0).join(' ') || (typeof row.organization === 'string' ? row.organization : '');
      if (name && typeof row.value === 'string') names.set(comparableHandle(row.value), name);
    }
  } catch {
    // Contacts are a help, not a need.
  } finally {
    db?.close();
  }
  return names;
}

function columns(db: DatabaseSync, table: string): Set<string> {
  return new Set(db.prepare(`PRAGMA table_info(${table})`).all().map((column) => String(column.name)));
}

/** Every conversation in the messages database, the one with most messages first. */
export function listIphoneThreads(smsPath: string, contacts: ReadonlyMap<string, string>): ThreadChoice[] {
  const db = new DatabaseSync(smsPath, { readOnly: true });
  try {
    const named = columns(db, 'chat').has('display_name');
    const rows = db
      .prepare(
        `SELECT c.chat_identifier AS id, ${named ? 'MAX(c.display_name)' : "''"} AS name, COUNT(DISTINCT j.message_id) AS messages
         FROM chat c JOIN chat_message_join j ON j.chat_id = c.ROWID
         WHERE c.chat_identifier IS NOT NULL
         GROUP BY c.chat_identifier ORDER BY messages DESC`,
      )
      .all();
    return rows.map((row) => {
      const id = String(row.id);
      // A group with no name of its own is only known by Apple's number for it.
      const unnamed = /^chat\d+$/.test(id) ? `Group chat (${id})` : (contacts.get(comparableHandle(id)) ?? id);
      const title = typeof row.name === 'string' && row.name.length > 0 ? row.name : unnamed;
      return { key: id, name: title, files: 1, bytes: 0, messages: Number(row.messages) };
    });
  } finally {
    db.close();
  }
}

/**
 * One conversation, oldest message first, in the shape every import uses.
 * `me` is the name to give the phone's owner. If someone else in the
 * conversation has that same name, the owner is marked "(this iPhone)" so
 * the two can never be taken for one person. `owner` is the name used.
 */
export function readIphoneThread(smsPath: string, key: string, contacts: ReadonlyMap<string, string>, me: string): ParsedChat & { owner: string } {
  const db = new DatabaseSync(smsPath, { readOnly: true });
  try {
    const has = columns(db, 'message');
    // Newer phones count time in billionths of a second and older ones in seconds, both from the start of 2001.
    const rows = db
      .prepare(
        `SELECT m.text AS text, ${has.has('attributedBody') ? 'm.attributedBody' : 'NULL'} AS body, m.is_from_me AS mine, h.id AS handle,
                ${has.has('associated_message_type') ? 'm.associated_message_type' : '0'} AS reaction,
                CASE WHEN m.date > 100000000000 THEN m.date / 1000000 ELSE m.date * 1000 END AS ms
         FROM message m
         JOIN chat_message_join j ON j.message_id = m.ROWID
         JOIN chat c ON c.ROWID = j.chat_id
         LEFT JOIN handle h ON h.ROWID = m.handle_id
         WHERE c.chat_identifier = ?
         GROUP BY m.ROWID
         ORDER BY m.date ASC, m.ROWID ASC`,
      )
      .all(key);

    const others = new Set(
      rows.filter((row) => Number(row.mine) !== 1).map((row) => (typeof row.handle === 'string' ? (contacts.get(comparableHandle(row.handle)) ?? row.handle) : 'Someone')),
    );
    const owner = others.has(me) ? `${me} (this iPhone)` : me;
    const messages: ChatMessage[] = [];
    let media = 0;
    let notices = 0;
    for (const row of rows) {
      if (Number(row.reaction ?? 0) !== 0) {
        notices += 1; // a tapback ("Loved", "Laughed at") on another message
        continue;
      }
      const text = messageWords(row.text, row.body);
      if (text.length === 0) {
        media += 1;
        continue;
      }
      const handle = typeof row.handle === 'string' ? row.handle : '';
      const sender = Number(row.mine) === 1 ? owner : (contacts.get(comparableHandle(handle)) ?? (handle || 'Someone'));
      messages.push({ at: localStamp(Number(row.ms) + APPLE_EPOCH_MS), sender, text });
    }

    const counts = new Map<string, number>();
    for (const message of messages) counts.set(message.sender, (counts.get(message.sender) ?? 0) + 1);
    return {
      owner,
      messages,
      senders: [...counts.entries()].map(([name, count]) => ({ name, count })).sort((x, y) => y.count - x.count || x.name.localeCompare(y.name)),
      dateOrder: 'year-first',
      dateOrderCertain: true,
      media,
      notices,
      notUnderstood: 0,
    };
  } finally {
    db.close();
  }
}
