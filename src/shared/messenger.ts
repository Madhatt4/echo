// Reads Messenger conversations from Meta's two downloads. Both are read on
// this computer and nowhere else.
//
//   1. "Export your information", in JSON. One folder per conversation,
//      holding message_1.json, message_2.json and so on:
//        { "title", "participants": [{ "name" }],
//          "messages": [{ "sender_name", "timestamp_ms", "content", "type" }] }
//      Older exports write accented letters and emoji in a broken way
//      (UTF-8 bytes written out one by one), which is put right here.
//
//   2. "Download secure storage data", for end-to-end encrypted chats. One
//      file per conversation:
//        { "threadName", "participants": [...],
//          "messages": [{ "senderName", "timestamp", "text", "type", "isUnsent" }] }
//
// The reader takes either spelling of each field, so a conversation in one
// layout with a field from the other is still read.

import type { ThreadChoice } from './imports.ts';
import type { ChatMessage, ParsedChat } from './whatsapp.ts';

/** Puts right text that was written as UTF-8 bytes one character at a time. Text that is already right is left alone. */
export function repairText(text: string): string {
  let needsRepair = false;
  for (let i = 0; i < text.length; i += 1) {
    const code = text.charCodeAt(i);
    if (code > 0xff) return text;
    if (code >= 0x80) needsRepair = true;
  }
  if (!needsRepair) return text;
  try {
    const bytes = Uint8Array.from(text, (character) => character.charCodeAt(0));
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return text;
  }
}

const two = (n: number) => String(n).padStart(2, '0');

/** A moment as the date and time on this computer's clock: YYYY-MM-DDTHH:MM:SS. */
export function localStamp(milliseconds: number): string {
  const d = new Date(milliseconds);
  return `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())}T${two(d.getHours())}:${two(d.getMinutes())}:${two(d.getSeconds())}`;
}

// Lines Messenger writes itself, as if the person had sent them.
const NOTICE =
  /^(.{1,80} sent an? (attachment|photo|video|gif|sticker|link|voice message|location|live location)\.?|reacted .+ to your message ?|.{1,80} reacted .+ to (your|their|his|her) message\.?|.{1,80} (missed|started) (a|an|your) (video chat|video call|call|audio call).*|you called .+|you missed a call from .+|.{1,80} set (the|your|his|her|their|own) nickname.*|.{1,80} (named|changed) the group.*|.{1,80} (unsent a message|joined the (call|video chat)|left the group)\.?|this message was unsent\.?)$/i;

function field(record: Record<string, unknown>, ...names: string[]): unknown {
  for (const name of names) if (record[name] !== undefined) return record[name];
  return undefined;
}

export interface MessengerThread {
  title: string;
  /** Everything in the file that is a message with words, in no particular order. */
  messages: (ChatMessage & { order: number })[];
  media: number;
  notices: number;
}

/**
 * Reads one conversation file. Returns null if the file is not a Messenger
 * conversation at all.
 */
export function readMessengerFile(json: unknown): MessengerThread | null {
  if (typeof json !== 'object' || json === null) return null;
  const top = json as Record<string, unknown>;
  const list = top.messages;
  if (!Array.isArray(list)) return null;
  const title = field(top, 'title', 'threadName');

  const messages: (ChatMessage & { order: number })[] = [];
  let media = 0;
  let notices = 0;
  let recognised = 0;
  for (const entry of list) {
    if (typeof entry !== 'object' || entry === null) continue;
    const message = entry as Record<string, unknown>;
    const sender = field(message, 'sender_name', 'senderName');
    const stamp = field(message, 'timestamp_ms', 'timestamp');
    if (typeof sender !== 'string' || typeof stamp !== 'number' || !Number.isFinite(stamp)) continue;
    recognised += 1;
    // Seconds in very old exports, milliseconds otherwise.
    const milliseconds = stamp < 100_000_000_000 ? stamp * 1000 : stamp;
    const words = field(message, 'content', 'text');
    const kind = typeof message.type === 'string' ? message.type.toLowerCase() : '';
    if (message.is_unsent === true || message.isUnsent === true) {
      notices += 1;
      continue;
    }
    if (typeof words !== 'string' || words.trim().length === 0) {
      media += 1;
      continue;
    }
    const text = repairText(words).trim();
    if (kind === 'call' || kind === 'subscribe' || kind === 'unsubscribe' || NOTICE.test(text)) {
      notices += 1;
      continue;
    }
    messages.push({ at: localStamp(milliseconds), sender: repairText(sender).trim(), text, order: milliseconds });
  }
  if (list.length > 0 && recognised === 0) return null;
  return { title: typeof title === 'string' ? repairText(title).trim() : '', messages, media, notices };
}

/** Puts the files of one conversation together, oldest message first, in the shape every import uses. */
export function mergeMessengerFiles(files: readonly MessengerThread[]): ParsedChat & { title: string } {
  const all = files.flatMap((file) => file.messages).sort((a, b) => a.order - b.order);
  const messages: ChatMessage[] = all.map(({ at, sender, text }) => ({ at, sender, text }));
  const counts = new Map<string, number>();
  for (const message of messages) counts.set(message.sender, (counts.get(message.sender) ?? 0) + 1);
  return {
    title: files.find((file) => file.title.length > 0)?.title ?? '',
    messages,
    senders: [...counts.entries()].map(([name, count]) => ({ name, count })).sort((x, y) => y.count - x.count || x.name.localeCompare(y.name)),
    dateOrder: 'year-first',
    dateOrderCertain: true,
    media: files.reduce((sum, file) => sum + file.media, 0),
    notices: files.reduce((sum, file) => sum + file.notices, 0),
    notUnderstood: 0,
  };
}

const STANDARD = /^(.*\/)?messages\/(inbox|archived_threads|filtered_threads|message_requests|e2ee_cutover)\/([^/]+)\/message_\d+\.json$/i;

/**
 * Finds the conversations in a download from the names of the files in it.
 * A standard export has a folder per conversation. A secure storage download
 * has a file per conversation. Biggest first.
 */
export function findThreads(entries: readonly { name: string; size: number }[]): { threads: ThreadChoice[]; filesOf: Map<string, string[]> } {
  const filesOf = new Map<string, string[]>();
  const sizes = new Map<string, number>();
  const names = new Map<string, string>();
  const add = (key: string, name: string, file: string, size: number) => {
    filesOf.set(key, [...(filesOf.get(key) ?? []), file]);
    sizes.set(key, (sizes.get(key) ?? 0) + size);
    names.set(key, name);
  };

  for (const entry of entries) {
    const match = STANDARD.exec(entry.name);
    if (match) {
      const folder = match[3] ?? '';
      add(entry.name.slice(0, entry.name.lastIndexOf('/')), folder.replace(/_\d+$/, ''), entry.name, entry.size);
    }
  }
  if (filesOf.size === 0) {
    for (const entry of entries) {
      if (!/\.json$/i.test(entry.name) || /(^|\/)media\//i.test(entry.name) || entry.name.startsWith('__MACOSX')) continue;
      const file = entry.name.slice(entry.name.lastIndexOf('/') + 1);
      add(entry.name, file.replace(/\.json$/i, '').replace(/_\d+$/, ''), entry.name, entry.size);
    }
  }

  const threads = [...filesOf.keys()]
    .map((key) => ({ key, name: names.get(key) ?? key, files: filesOf.get(key)?.length ?? 0, bytes: sizes.get(key) ?? 0 }))
    .sort((a, b) => b.bytes - a.bytes || a.name.localeCompare(b.name));
  return { threads, filesOf };
}
