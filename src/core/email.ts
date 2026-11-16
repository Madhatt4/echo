// Reads a mailbox file (mbox), the format Gmail's export and most mail
// programs can save.
//
// Only the emails the owner sent are ever read for their words. Other people's
// emails are looked at for who sent them and nothing else, and are not kept.
// A reply usually carries the email it answers underneath: that part is other
// people's words and is cut off before anything is kept.

import { createReadStream, closeSync, openSync, readSync } from 'node:fs';
import { localStamp } from '../shared/messenger.ts';
import type { ChatMessage, ParsedChat } from '../shared/whatsapp.ts';

/** How much of one email is looked at. The words come first; what is cut is attachments. */
export const EMAIL_BYTES_KEPT = 2 * 1024 * 1024;

/** One email in a mailbox, from its headers alone. */
export interface MailEntry {
  /** Where the email starts in the file, and how much of it to read. */
  offset: number;
  length: number;
  from: string;
  fromName: string;
  /** Who it was written to (the To line only), in the order written. */
  to: { address: string; name: string }[];
  at: number | null;
  /** Gmail's labels for it, lower-cased, if the mailbox came from Gmail. */
  labels: string[];
  messageId: string;
  automatic: boolean;
}

// ---------- headers ----------

/** Splits an email (as bytes read one-to-one into characters) into its headers and its body. */
export function splitEmail(raw: string): { headers: Map<string, string>; body: string } {
  const match = /\r?\n\r?\n/.exec(raw);
  const head = match ? raw.slice(0, match.index) : raw;
  const body = match ? raw.slice(match.index + match[0].length) : '';
  const headers = new Map<string, string>();
  let name = '';
  for (const line of head.split(/\r?\n/)) {
    if (/^[ \t]/.test(line) && name) {
      headers.set(name, `${headers.get(name) ?? ''} ${line.trim()}`);
      continue;
    }
    const colon = line.indexOf(':');
    if (colon <= 0) continue;
    name = line.slice(0, colon).trim().toLowerCase();
    // The first of a repeated header is the one that counts.
    if (headers.has(name)) name = '';
    else headers.set(name, line.slice(colon + 1).trim());
  }
  return { headers, body };
}

function decodeBytes(bytes: Buffer, charset: string): string {
  try {
    return new TextDecoder(charset.trim().toLowerCase() || 'utf-8').decode(bytes);
  } catch {
    return new TextDecoder('utf-8').decode(bytes);
  }
}

function quotedPrintable(text: string, header = false): Buffer {
  const plain = (header ? text.replace(/_/g, ' ') : text.replace(/=\r?\n/g, '')).replace(/=([0-9A-Fa-f]{2})/g, (_all, hex: string) => String.fromCharCode(parseInt(hex, 16)));
  return Buffer.from(plain, 'latin1');
}

/** Puts right the coded form headers use for anything that is not plain English letters ("=?UTF-8?B?...?="). */
export function decodeHeader(value: string): string {
  return value
    .replace(/(\?=)\s+(=\?)/g, '$1$2')
    .replace(/=\?([^?\s]+)\?([bBqQ])\?([^?]*)\?=/g, (_all, charset: string, kind: string, words: string) =>
      decodeBytes(kind.toLowerCase() === 'b' ? Buffer.from(words, 'base64') : quotedPrintable(words, true), charset),
    );
}

/** The addresses in a From or To line, with the name written beside each. */
export function addressesIn(value: string | undefined): { address: string; name: string }[] {
  if (!value) return [];
  const found: { address: string; name: string }[] = [];
  const pattern = /(?:"([^"]*)"|([^<>,;"]*?))\s*<([^<>\s]+@[^<>\s]+)>|([^\s<>,;"]+@[^\s<>,;"]+)/g;
  for (const match of decodeHeader(value).matchAll(pattern)) {
    const address = (match[3] ?? match[4] ?? '').toLowerCase();
    if (address) found.push({ address, name: (match[1] ?? match[2] ?? '').trim() });
  }
  return found;
}

function parameter(value: string | undefined, name: string): string {
  const match = new RegExp(`${name}\\s*=\\s*(?:"([^"]*)"|([^;\\s]+))`, 'i').exec(value ?? '');
  return match?.[1] ?? match?.[2] ?? '';
}

/** What Echo needs to know about an email without reading its words. */
export function mailEntry(raw: string, offset: number, length: number): MailEntry | null {
  const { headers } = splitEmail(raw.slice(0, 64 * 1024));
  const from = addressesIn(headers.get('from'))[0];
  if (!from) return null;
  const date = (headers.get('date') ?? '').replace(/\s*\([^)]*\)\s*$/, '');
  const at = Date.parse(date);
  const submitted = (headers.get('auto-submitted') ?? 'no').toLowerCase();
  return {
    offset,
    length,
    from: from.address,
    fromName: from.name,
    to: addressesIn(headers.get('to')),
    at: Number.isNaN(at) ? null : at,
    labels: (headers.get('x-gmail-labels') ?? '').split(',').map((label) => decodeHeader(label).trim().toLowerCase()).filter((label) => label.length > 0),
    messageId: headers.get('message-id') ?? '',
    automatic: submitted !== 'no' || headers.has('x-autoreply') || headers.has('x-autorespond'),
  };
}

// ---------- the mailbox file ----------

const BOUNDARY = Buffer.from('\nFrom ');
// "From someone@example.com Mon Jan  1 10:00:00 2024": the line that starts each email in a mailbox file.
const FROM_LINE = /^From \S+.*\d\d:\d\d/;

/**
 * Walks a mailbox file from start to end without holding it in memory, and
 * calls `each` with the start of every email in it (up to EMAIL_BYTES_KEPT),
 * where it sits in the file, and how far through the file the walk is.
 */
export async function scanMailbox(filePath: string, each: (start: Buffer, offset: number) => void): Promise<void> {
  let carry: Buffer = Buffer.alloc(0);
  let position = 0; // where `carry` starts in the file
  let parts: Buffer[] = [];
  let kept = 0;
  let inside = false;
  let startedAt = 0;
  const keep = (piece: Buffer) => {
    if (!inside || kept >= EMAIL_BYTES_KEPT || piece.length === 0) return;
    const take = piece.subarray(0, EMAIL_BYTES_KEPT - kept);
    parts.push(Buffer.from(take));
    kept += take.length;
  };
  const finish = () => {
    if (inside && kept > 0) each(Buffer.concat(parts), startedAt);
    parts = [];
    kept = 0;
  };

  for await (const chunk of createReadStream(filePath, { highWaterMark: 4 * 1024 * 1024 }) as AsyncIterable<Buffer>) {
    const data = carry.length > 0 ? Buffer.concat([carry, chunk]) : chunk;
    let start = 0;
    if (position === 0 && !inside && FROM_LINE.test(data.subarray(0, 200).toString('latin1').split('\n')[0] ?? '')) {
      inside = true;
      startedAt = 0;
    }
    let search = 0;
    for (;;) {
      const found = data.indexOf(BOUNDARY, search);
      if (found < 0) break;
      const lineEnd = data.indexOf(10, found + 1);
      if (lineEnd < 0) break; // the line is not all here yet: it is judged with the next piece of the file
      search = found + 1;
      // A new email starts after an empty line. The same words in the middle of an email do not count.
      const emptyLineBefore = found >= 1 && (data[found - 1] === 10 || (data[found - 1] === 13 && found >= 2 && data[found - 2] === 10));
      if (!emptyLineBefore && !(found === 0 && position === 0)) continue;
      if (!FROM_LINE.test(data.subarray(found + 1, lineEnd).toString('latin1'))) continue;
      keep(data.subarray(start, found + 1));
      finish();
      inside = true;
      startedAt = position + found + 1;
      start = found + 1;
    }
    // The last stretch is held back so a starting line cut in two by the read is still seen whole.
    const hold = Math.max(start, data.length - 4096);
    keep(data.subarray(start, hold));
    carry = Buffer.from(data.subarray(hold));
    position += hold;
  }
  keep(carry);
  finish();
}

/** Reads the kept part of one email back out of the mailbox file. */
export function readMailAt(filePath: string, offset: number, length: number): string {
  const fd = openSync(filePath, 'r');
  try {
    const bytes = Buffer.alloc(length);
    const read = readSync(fd, bytes, 0, length, offset);
    return bytes.subarray(0, read).toString('latin1');
  } finally {
    closeSync(fd);
  }
}

// ---------- the words ----------

function decodePart(headers: Map<string, string>, body: string): string {
  const encoding = (headers.get('content-transfer-encoding') ?? '').toLowerCase();
  const bytes = encoding === 'base64' ? Buffer.from(body, 'base64') : encoding === 'quoted-printable' ? quotedPrintable(body) : Buffer.from(body, 'latin1');
  return decodeBytes(bytes, parameter(headers.get('content-type'), 'charset'));
}

function textParts(headers: Map<string, string>, body: string, depth: number, into: { plain: string[]; html: string[] }): void {
  const type = (headers.get('content-type') ?? 'text/plain').toLowerCase();
  if (type.startsWith('multipart/')) {
    const boundary = parameter(headers.get('content-type'), 'boundary');
    if (!boundary || depth > 6) return;
    for (const piece of body.split(`--${boundary}`).slice(1)) {
      if (piece.startsWith('--')) break; // the closing line
      const part = splitEmail(piece.replace(/^[ \t]*\r?\n/, ''));
      textParts(part.headers, part.body, depth + 1, into);
    }
    return;
  }
  if (/attachment/i.test(headers.get('content-disposition') ?? '')) return;
  if (type.startsWith('text/plain')) into.plain.push(decodePart(headers, body));
  else if (type.startsWith('text/html')) into.html.push(decodePart(headers, body));
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

/** The words in an HTML email, as plain text. Anything quoted from another email is cut off first. */
export function htmlToText(html: string): string {
  // Quoted email sits in a blockquote, in Gmail's quote box, or under the rule Outlook draws.
  const quoted = html.search(/<blockquote|class\s*=\s*"?[^">]*gmail_quote|<hr[\s>/]|id\s*=\s*"?(divRplyFwdMsg|appendonsend)/i);
  // The cut is made at the start of the tag the mark was found in.
  const cut = quoted >= 0 && html.charAt(quoted) !== '<' ? Math.max(0, html.lastIndexOf('<', quoted)) : quoted;
  return (cut >= 0 ? html.slice(0, cut) : html)
    .replace(/<(style|script|head)[\s\S]*?<\/\1>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|tr|li|h[1-6])\s*>/gi, '\n')
    .replace(/<[^>]*>/g, '')
    .replace(/&#(\d+);/g, (_all, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_all, code: string) => String.fromCodePoint(parseInt(code, 16)))
    .replace(/&([a-z]+);/gi, (all, name: string) => ENTITIES[name.toLowerCase()] ?? all);
}

const WROTE = /^(On|Le|El|Am|Il|Op)\b.{3,300}(wrote|a écrit|escribió|schrieb|ha scritto|schreef)\s*:\s*$/i;

/** Where other people's words start in the text of an email, as a line number, or -1 if they do not. */
function quoteStartsAt(lines: readonly string[]): number {
  for (let i = 0; i < lines.length; i += 1) {
    const line = (lines[i] ?? '').trim();
    const next = (lines[i + 1] ?? '').trim();
    if (line.startsWith('>')) return i;
    if (WROTE.test(line) || (/^(On|Le|El|Am|Il|Op)\b/i.test(line) && WROTE.test(`${line} ${next}`))) return i;
    if (/^-{2,}\s*(Original Message|Forwarded message)\s*-{2,}/i.test(line)) return i;
    if (/^Begin forwarded message:/i.test(line)) return i;
    if (/^_{10,}$/.test(line)) return i;
    // The block Outlook puts above a quoted email: "From: ...", then "Sent:" or "Date:", "To:", "Subject:".
    if (/^(From|De|Von):\s?\S/i.test(line) && lines.slice(i + 1, i + 5).some((after) => /^(Sent|Date|To|Subject|Envoyé|Gesendet):/i.test(after.trim()))) return i;
  }
  return -1;
}

/** The owner's own words in an email they wrote: what they quoted from other people, and their signature, are cut off. */
export function ownWords(text: string): string {
  let lines = text.replace(/\r\n?/g, '\n').split('\n');
  const quote = quoteStartsAt(lines);
  if (quote >= 0) lines = lines.slice(0, quote);
  const signature = lines.findIndex((line) => /^-- ?$/.test(line) || /^(Sent from my |Sent from Outlook|Get Outlook for )/i.test(line.trim()));
  if (signature >= 0) lines = lines.slice(0, signature);
  return lines
    .map((line) => line.replace(/[ \t]+$/, ''))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** The words the sender wrote in one email, and its subject if the sender chose it. */
export function emailWords(raw: string): string {
  const { headers, body } = splitEmail(raw);
  const found = { plain: [] as string[], html: [] as string[] };
  textParts(headers, body, 0, found);
  const words = ownWords(found.plain[0] ?? htmlToText(found.html[0] ?? ''));
  if (words.length === 0) return '';
  // The subject of a reply or a forward was written by someone else. Only a subject the sender chose is kept.
  const subject = decodeHeader(headers.get('subject') ?? '').trim();
  const theirs = headers.has('in-reply-to') || headers.has('references') || /^(re|fwd?|aw|tr|sv|wg)\s*:/i.test(subject);
  return subject.length > 0 && !theirs ? `${subject}\n${words}` : words;
}

// ---------- choosing what is the owner's ----------

/** Gmail's labels for mail that is not something the owner sent and kept. */
const LEFT_OUT = ['drafts', 'draft', 'spam', 'trash', 'bin'];

/** The addresses email was sent from, most first, for the owner to say which are theirs. Ones Gmail filed as sent are suggested. */
export function senderAddresses(entries: readonly MailEntry[]): { addresses: { address: string; name: string; count: number }[]; suggested: string[] } {
  const counts = new Map<string, { address: string; name: string; count: number; sent: number }>();
  for (const entry of entries) {
    const known = counts.get(entry.from) ?? { address: entry.from, name: entry.fromName, count: 0, sent: 0 };
    known.count += 1;
    if (entry.labels.includes('sent')) known.sent += 1;
    if (!known.name) known.name = entry.fromName;
    counts.set(entry.from, known);
  }
  const all = [...counts.values()].sort((a, b) => b.sent - a.sent || b.count - a.count || a.address.localeCompare(b.address));
  let suggested = all.filter((sender) => sender.sent > 0 && sender.sent * 2 >= sender.count).map((sender) => sender.address);
  // A mailbox that is nearly all from one address is that person's sent mail.
  const most = [...all].sort((a, b) => b.count - a.count)[0];
  if (suggested.length === 0 && most && most.count * 10 >= entries.length * 9) suggested = [most.address];
  return { addresses: all.slice(0, 40).map(({ address, name, count }) => ({ address, name, count })), suggested };
}

/** The owner's sent emails, grouped by who each was written to (the first person on the To line). */
export function sentByRecipient(entries: readonly MailEntry[], mine: ReadonlySet<string>): Map<string, { name: string; emails: MailEntry[] }> {
  const groups = new Map<string, { name: string; emails: MailEntry[] }>();
  const seen = new Set<string>();
  for (const entry of entries) {
    if (!mine.has(entry.from) || entry.automatic || entry.at === null) continue;
    if (entry.labels.some((label) => LEFT_OUT.includes(label))) continue;
    if (entry.messageId) {
      if (seen.has(entry.messageId)) continue;
      seen.add(entry.messageId);
    }
    const first = entry.to[0];
    const key = first?.address ?? '(nobody on the To line)';
    const group = groups.get(key) ?? { name: first?.name || key, emails: [] };
    if (group.name === key && first?.name) group.name = first.name;
    group.emails.push(entry);
    groups.set(key, group);
  }
  for (const group of groups.values()) group.emails.sort((a, b) => (a.at ?? 0) - (b.at ?? 0));
  return groups;
}

/** Reads the owner's sent emails to one person as a conversation with one side: theirs. */
export function readSentEmails(filePath: string, emails: readonly MailEntry[], me: string): ParsedChat {
  const messages: ChatMessage[] = [];
  let empty = 0;
  for (const entry of emails) {
    const words = emailWords(readMailAt(filePath, entry.offset, entry.length));
    if (words.length === 0 || entry.at === null) empty += 1;
    else messages.push({ at: localStamp(entry.at), sender: me, text: words });
  }
  return {
    messages,
    senders: messages.length > 0 ? [{ name: me, count: messages.length }] : [],
    dateOrder: 'year-first',
    dateOrderCertain: true,
    media: empty,
    notices: 0,
    notUnderstood: 0,
  };
}
