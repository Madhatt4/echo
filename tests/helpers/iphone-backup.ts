// Builds a small iPhone backup for tests, laid out as Apple lays one out:
// files named by a fingerprint of where they were on the phone, the messages
// in a SQLite database with Apple's tables and Apple's way of counting time.

import { createCipheriv, pbkdf2Sync, randomBytes } from 'node:crypto';
import { mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { CONTACTS_FILE, SMS_FILE, backupFileName } from '../../src/core/iphone.ts';
import { Uid, writeBinaryPlist } from './bplist-writer.ts';

/** Packs words the way newer iPhones do, in the block that replaces the plain text. */
export function attributedBody(text: string): Buffer {
  const words = Buffer.from(text, 'utf8');
  const length = words.length < 0x80 ? Buffer.from([words.length]) : Buffer.from([0x81, words.length & 0xff, words.length >> 8]);
  return Buffer.concat([
    Buffer.from([0x04, 0x0b]),
    Buffer.from('streamtyped', 'latin1'),
    Buffer.from([0x81, 0xe8, 0x03, 0x84, 0x01, 0x40, 0x84, 0x84, 0x84, 0x12]),
    Buffer.from('NSAttributedString', 'latin1'),
    Buffer.from([0x00, 0x84, 0x84, 0x08]),
    Buffer.from('NSObject', 'latin1'),
    Buffer.from([0x00, 0x85, 0x92, 0x84, 0x84, 0x84, 0x08]),
    Buffer.from('NSString', 'latin1'),
    Buffer.from([0x01, 0x94, 0x84, 0x01, 0x2b]),
    length,
    words,
    Buffer.from([0x86, 0x84, 0x02, 0x69, 0x49, 0x01]),
  ]);
}

/** Billionths of a second since the start of 2001, for a moment given in milliseconds since 1970. */
export const appleTime = (milliseconds: number) => BigInt(milliseconds - 978_307_200_000) * 1_000_000n;

export interface FakeMessage {
  chat: string;
  /** The other person's number or email. Leave out for a message the owner sent. */
  from?: string;
  text?: string;
  body?: Buffer;
  at: number;
  reaction?: number;
}

export function makeIphoneBackup(
  root: string,
  udid: string,
  options: { messages: FakeMessage[]; contacts?: { first: string; last: string; value: string }[]; device?: string; flat?: boolean; groupNames?: Record<string, string> },
): string {
  const folder = path.join(root, udid);
  const place = (file: { domain: string; relativePath: string }) => {
    const name = backupFileName(file);
    const dir = options.flat ? folder : path.join(folder, name.slice(0, 2));
    mkdirSync(dir, { recursive: true });
    return path.join(dir, name);
  };
  mkdirSync(folder, { recursive: true });
  writeFileSync(path.join(folder, 'Manifest.db'), 'not read by these tests');
  writeFileSync(
    path.join(folder, 'Info.plist'),
    `<?xml version="1.0" encoding="UTF-8"?>\n<plist version="1.0"><dict>\n<key>Device Name</key>\n<string>${options.device ?? "Charles's iPhone"}</string>\n<key>Last Backup Date</key>\n<date>2026-11-10T08:00:00Z</date>\n</dict></plist>\n`,
  );

  const sms = new DatabaseSync(place(SMS_FILE));
  sms.exec(`
    CREATE TABLE handle (ROWID INTEGER PRIMARY KEY, id TEXT);
    CREATE TABLE chat (ROWID INTEGER PRIMARY KEY, chat_identifier TEXT, display_name TEXT, service_name TEXT);
    CREATE TABLE message (ROWID INTEGER PRIMARY KEY, text TEXT, attributedBody BLOB, handle_id INTEGER, date INTEGER, is_from_me INTEGER, associated_message_type INTEGER DEFAULT 0);
    CREATE TABLE chat_message_join (chat_id INTEGER, message_id INTEGER);
  `);
  const handles = new Map<string, number>();
  const chats = new Map<string, number>();
  for (const message of options.messages) {
    if (message.from && !handles.has(message.from)) {
      handles.set(message.from, handles.size + 1);
      sms.prepare('INSERT INTO handle (ROWID, id) VALUES (?, ?)').run(handles.size, message.from);
    }
    if (!chats.has(message.chat)) {
      chats.set(message.chat, chats.size + 1);
      sms.prepare('INSERT INTO chat (ROWID, chat_identifier, display_name, service_name) VALUES (?, ?, ?, ?)').run(chats.size, message.chat, options.groupNames?.[message.chat] ?? '', 'iMessage');
    }
    const added = sms
      .prepare('INSERT INTO message (text, attributedBody, handle_id, date, is_from_me, associated_message_type) VALUES (?, ?, ?, ?, ?, ?)')
      .run(message.text ?? null, message.body ?? null, message.from ? (handles.get(message.from) ?? 0) : 0, appleTime(message.at), message.from ? 0 : 1, message.reaction ?? 0);
    sms.prepare('INSERT INTO chat_message_join (chat_id, message_id) VALUES (?, ?)').run(chats.get(message.chat) ?? 0, added.lastInsertRowid);
  }
  sms.close();

  if (options.contacts) {
    const book = new DatabaseSync(place(CONTACTS_FILE));
    book.exec('CREATE TABLE ABPerson (ROWID INTEGER PRIMARY KEY, First TEXT, Last TEXT, Organization TEXT); CREATE TABLE ABMultiValue (UID INTEGER PRIMARY KEY, record_id INTEGER, property INTEGER, value TEXT);');
    options.contacts.forEach((contact, index) => {
      book.prepare('INSERT INTO ABPerson (ROWID, First, Last) VALUES (?, ?, ?)').run(index + 1, contact.first, contact.last);
      book.prepare('INSERT INTO ABMultiValue (record_id, property, value) VALUES (?, ?, ?)').run(index + 1, contact.value.includes('@') ? 4 : 3, contact.value);
    });
    book.close();
  }
  return folder;
}

function tag(name: string, value: Buffer | number): Buffer {
  const data = typeof value === 'number' ? Buffer.alloc(4) : value;
  if (typeof value === 'number') data.writeUInt32BE(value);
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  return Buffer.concat([Buffer.from(name, 'latin1'), length, data]);
}

function wrap(wrappingKey: Buffer, key: Buffer): Buffer {
  const cipher = createCipheriv('id-aes256-wrap', wrappingKey, Buffer.from('A6A6A6A6A6A6A6A6', 'hex'));
  return Buffer.concat([cipher.update(key), cipher.final()]);
}

/** Encrypts the way a backup does: AES-256-CBC with an all-zero starting block, padded to a whole block. */
function encrypt(key: Buffer, plain: Buffer): Buffer {
  const cipher = createCipheriv('aes-256-cbc', key, Buffer.alloc(16));
  return Buffer.concat([cipher.update(plain), cipher.final()]);
}

/**
 * Builds an encrypted iPhone backup the way Apple does: a key bag whose class
 * keys are wrapped by a key stretched from the password, an encrypted index,
 * and each file encrypted under its own key, wrapped by a class key.
 * `oldStyle` leaves out the second round of stretching, as backups before iOS 10.2 did.
 */
export function makeEncryptedIphoneBackup(
  root: string,
  udid: string,
  password: string,
  options: Parameters<typeof makeIphoneBackup>[2] & { oldStyle?: boolean },
): string {
  const plain = makeIphoneBackup(root, `${udid}-plain`, { ...options, flat: true });
  const folder = path.join(root, udid);
  mkdirSync(folder, { recursive: true });

  const salt = randomBytes(20);
  const firstSalt = randomBytes(20);
  const first = options.oldStyle ? Buffer.from(password, 'utf8') : pbkdf2Sync(Buffer.from(password, 'utf8'), firstSalt, 50, 32, 'sha256');
  const fromPassword = pbkdf2Sync(first, salt, 20, 32, 'sha1');
  const classKeys = new Map([[3, randomBytes(32)], [4, randomBytes(32)]]);
  const bag = Buffer.concat([
    tag('VERS', 5),
    tag('TYPE', 1),
    tag('UUID', randomBytes(16)),
    tag('HMCK', randomBytes(40)),
    tag('WRAP', 0),
    tag('SALT', salt),
    tag('ITER', 20),
    ...(options.oldStyle ? [] : [tag('DPWT', 1), tag('DPIC', 50), tag('DPSL', firstSalt)]),
    ...[...classKeys].flatMap(([protectionClass, key]) => [tag('UUID', randomBytes(16)), tag('CLAS', protectionClass), tag('WRAP', 2), tag('KTYP', 0), tag('WPKY', wrap(fromPassword, key))]),
  ]);

  const classTag = (protectionClass: number) => {
    const bytes = Buffer.alloc(4);
    bytes.writeUInt32LE(protectionClass);
    return bytes;
  };
  const index = new DatabaseSync(path.join(folder, 'index-plain'));
  index.exec('CREATE TABLE Files (fileID TEXT PRIMARY KEY, domain TEXT, relativePath TEXT, flags INTEGER, file BLOB)');
  for (const file of [SMS_FILE, CONTACTS_FILE]) {
    const name = backupFileName(file);
    let contents: Buffer;
    try {
      contents = readFileSync(path.join(plain, name));
    } catch {
      continue; // this backup has no such file
    }
    const fileKey = randomBytes(32);
    mkdirSync(path.join(folder, name.slice(0, 2)), { recursive: true });
    writeFileSync(path.join(folder, name.slice(0, 2), name), encrypt(fileKey, contents));
    const record = writeBinaryPlist({
      $version: 100000,
      $archiver: 'NSKeyedArchiver',
      $top: { root: new Uid(1) },
      $objects: ['$null', { $class: new Uid(3), EncryptionKey: new Uid(2), ProtectionClass: 3, Size: contents.length, RelativePath: file.relativePath }, { 'NS.data': Buffer.concat([classTag(3), wrap(classKeys.get(3)!, fileKey)]) }, { $classname: 'MBFile' }],
    });
    index.prepare('INSERT INTO Files VALUES (?, ?, ?, 1, ?)').run(name, file.domain, file.relativePath, record);
  }
  index.close();

  const indexKey = randomBytes(32);
  writeFileSync(path.join(folder, 'Manifest.db'), encrypt(indexKey, readFileSync(path.join(folder, 'index-plain'))));
  rmSync(path.join(folder, 'index-plain'));
  writeFileSync(path.join(folder, 'Manifest.plist'), writeBinaryPlist({ IsEncrypted: true, Version: '10.0', BackupKeyBag: bag, ManifestKey: Buffer.concat([classTag(4), wrap(classKeys.get(4)!, indexKey)]) }));
  writeFileSync(path.join(folder, 'Info.plist'), readFileSync(path.join(plain, 'Info.plist')));
  statSync(path.join(folder, 'Manifest.db'));
  rmSync(plain, { recursive: true });
  return folder;
}
