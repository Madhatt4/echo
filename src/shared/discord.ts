// Reads the messages in a Discord data package.
//
// Discord's package holds only what the person themselves sent: one folder per
// channel or direct message, each with a file of their messages. Nobody else's
// words are in it, so everything read here is the owner's.
//
// What Discord documents: each folder is named with the channel's ID, a JSON
// file maps channel IDs to names, and each message has ID, Timestamp, Contents
// and Attachments. The file names and the exact shape of the timestamp are not
// in Discord's own description, so this reader is forgiving about both.

import type { ThreadChoice } from './imports.ts';
import { localStamp } from './messenger.ts';
import type { ChatMessage, ParsedChat } from './whatsapp.ts';

// "messages/c123456/messages.json". The folder may or may not start with "c"; older packages used CSV.
const MESSAGES_FILE = /(^|\/)messages\/(c?(\d+))\/messages\.(json|csv)$/i;

/** Whether a file holds messages as JSON or as CSV, from its name. */
export function discordFileKind(name: string): 'json' | 'csv' {
  return /\.csv$/i.test(name) ? 'csv' : 'json';
}

/** The channels in a package, from the names of the files in its ZIP. Names are filled in afterwards from the package's index. */
export function findDiscordChannels(entries: readonly { name: string; size: number }[]): {
  threads: ThreadChoice[];
  filesOf: Map<string, string[]>;
  /** The file that maps channel IDs to names, if the package has one. */
  indexFile: string | null;
} {
  const filesOf = new Map<string, string[]>();
  const threads: ThreadChoice[] = [];
  let indexFile: string | null = null;
  for (const entry of entries) {
    if (entry.name.startsWith('__MACOSX')) continue;
    if (/(^|\/)messages\/index\.json$/i.test(entry.name)) indexFile = entry.name;
    const match = MESSAGES_FILE.exec(entry.name);
    const id = match?.[3];
    if (!match || !id || filesOf.has(id)) continue;
    filesOf.set(id, [entry.name]);
    threads.push({ key: id, name: `Channel ${id}`, files: 1, bytes: entry.size });
  }
  threads.sort((a, b) => b.bytes - a.bytes || a.key.localeCompare(b.key));
  return { threads, filesOf, indexFile };
}

/** Gives each channel the name the package's index has for it. A channel the index does not name keeps its number. */
export function nameDiscordChannels(threads: readonly ThreadChoice[], indexText: string): ThreadChoice[] {
  let index: unknown;
  try {
    index = JSON.parse(indexText);
  } catch {
    return [...threads];
  }
  if (typeof index !== 'object' || index === null || Array.isArray(index)) return [...threads];
  const names = index as Record<string, unknown>;
  return threads.map((thread) => {
    const name = names[thread.key] ?? names[`c${thread.key}`];
    return typeof name === 'string' && name.trim().length > 0 ? { ...thread, name: name.trim() } : thread;
  });
}

/** A short name to suggest for the conversation, from the name in the package's index. */
export function discordLabel(name: string): string {
  return name.replace(/^Direct Message with\s+/i, '').trim().slice(0, 80);
}

/** Splits CSV text into rows of fields. Fields in double quotes may hold commas, line breaks and doubled quotes. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const char = text.charAt(i);
    const next = text.charAt(i + 1);
    if (quoted) {
      if (char === '"' && next === '"') {
        field += '"';
        i += 1;
      } else if (char === '"') quoted = false;
      else field += char;
    } else if (char === '"' && field.length === 0) quoted = true;
    else if (char === ',') {
      row.push(field);
      field = '';
    } else if (char === '\n' || char === '\r') {
      if (char === '\r' && next === '\n') i += 1;
      row.push(field);
      field = '';
      if (row.length > 1 || row[0] !== '') rows.push(row);
      row = [];
    } else field += char;
  }
  row.push(field);
  if (row.length > 1 || row[0] !== '') rows.push(row);
  return rows;
}

/** When a message was sent, in milliseconds. A time with no zone written is taken as UTC. */
export function discordMoment(raw: unknown): number | null {
  if (typeof raw !== 'string' || raw.trim().length === 0) return null;
  let written = raw.trim().replace(' ', 'T');
  // More than three decimal places of a second are cut, so every reader of dates agrees.
  written = written.replace(/(\.\d{3})\d+/, '$1');
  if (!/(Z|[+-]\d\d:?\d\d)$/i.test(written)) written += 'Z';
  const milliseconds = Date.parse(written);
  return Number.isNaN(milliseconds) ? null : milliseconds;
}

/** The words of a message, with Discord's own codes taken out: custom emoji become their names, and mentions by number are dropped. */
export function discordWords(raw: unknown): string {
  if (typeof raw !== 'string') return '';
  return raw
    .replace(/<a?:(\w+):\d+>/g, ':$1:')
    .replace(/<@[!&]?\d+>|<#\d+>/g, '')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}

interface RawMessage {
  id: string;
  timestamp: unknown;
  contents: unknown;
  attachments: unknown;
}

function pick(record: Record<string, unknown>, ...names: string[]): unknown {
  for (const name of names) if (record[name] !== undefined && record[name] !== null) return record[name];
  return undefined;
}

function rawMessages(text: string, kind: 'json' | 'csv'): RawMessage[] | null {
  if (kind === 'csv') {
    const rows = parseCsv(text.replace(/^﻿/, ''));
    const header = rows[0]?.map((name) => name.trim().toLowerCase());
    if (!header) return [];
    const at = (name: string) => header.indexOf(name);
    const [id, timestamp, contents, attachments] = [at('id'), at('timestamp'), at('contents'), at('attachments')];
    if (timestamp < 0 || contents < 0) return null;
    return rows.slice(1).map((row) => ({ id: row[id] ?? '', timestamp: row[timestamp], contents: row[contents], attachments: row[attachments] }));
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text.replace(/^﻿/, ''));
  } catch {
    return null;
  }
  if (!Array.isArray(parsed)) return null;
  const list: RawMessage[] = [];
  for (const item of parsed) {
    if (typeof item !== 'object' || item === null) continue;
    const record = item as Record<string, unknown>;
    const id = pick(record, 'ID', 'id');
    list.push({
      id: typeof id === 'string' || typeof id === 'number' ? String(id) : '',
      timestamp: pick(record, 'Timestamp', 'timestamp'),
      contents: pick(record, 'Contents', 'contents', 'Content', 'content'),
      attachments: pick(record, 'Attachments', 'attachments'),
    });
  }
  return list;
}

/** Message IDs are numbers that grow with time, so they settle the order of two messages sent in the same second. */
function byId(a: string, b: string): number {
  if (!/^\d+$/.test(a) || !/^\d+$/.test(b)) return 0;
  return a.length - b.length || (a < b ? -1 : a > b ? 1 : 0);
}

/**
 * Reads one channel's messages file. Every message in it was sent by the
 * owner, so all are given the owner's name. Returns null if the file is not a
 * Discord messages file at all.
 */
export function readDiscordMessages(text: string, kind: 'json' | 'csv', me: string): ParsedChat | null {
  const raw = rawMessages(text, kind);
  if (raw === null) return null;
  const read: { order: number; id: string; message: ChatMessage }[] = [];
  let media = 0;
  let notices = 0;
  let notUnderstood = 0;
  for (const item of raw) {
    const milliseconds = discordMoment(item.timestamp);
    if (milliseconds === null) {
      notUnderstood += 1;
      continue;
    }
    const words = discordWords(item.contents);
    if (words.length === 0) {
      const attached = Array.isArray(item.attachments) ? item.attachments.length > 0 : typeof item.attachments === 'string' && item.attachments.trim().length > 0;
      if (attached) media += 1;
      else notices += 1;
      continue;
    }
    read.push({ order: milliseconds, id: item.id, message: { at: localStamp(milliseconds), sender: me, text: words } });
  }
  // A file where nothing has a readable time is not a Discord messages file.
  if (raw.length > 0 && notUnderstood === raw.length) return null;
  read.sort((a, b) => a.order - b.order || byId(a.id, b.id));
  const messages = read.map((item) => item.message);
  return {
    messages,
    senders: messages.length > 0 ? [{ name: me, count: messages.length }] : [],
    dateOrder: 'year-first',
    dateOrderCertain: true,
    media,
    notices,
    notUnderstood,
  };
}
