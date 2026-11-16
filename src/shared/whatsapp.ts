// Reads the text file inside a WhatsApp "Export chat". Nothing here talks to
// the network: the file is read on this computer and nowhere else.
//
// The export's layout changes with the phone and its language settings, so
// this reader accepts the layouts known at the time of writing:
//
//   iPhone:   [12/11/2026, 09:15:02] Ada: Morning
//   Android:  12/11/2026, 09:15 - Ada: Morning
//
// with day-first, month-first or year-first dates, two or four digit years,
// 24-hour or am/pm times, and messages that run over several lines. Lines
// with a time but no sender are WhatsApp's own notices and are left out.

export interface ChatMessage {
  /** Local date and time as written in the export: YYYY-MM-DDTHH:MM:SS. */
  at: string;
  sender: string;
  text: string;
}

export type DateOrder = 'day-first' | 'month-first' | 'year-first';

export interface ParsedChat {
  messages: ChatMessage[];
  senders: { name: string; count: number }[];
  dateOrder: DateOrder;
  /** False if no date in the file settles whether the day or the month comes first. Day-first is then assumed. */
  dateOrderCertain: boolean;
  /** Photos, voice notes and other attachments, which have no words. */
  media: number;
  /** Notices from WhatsApp itself, and deleted messages. */
  notices: number;
  /** Lines at the top of the file that are not messages at all. A big number means this is not a WhatsApp export. */
  notUnderstood: number;
}

const INVISIBLE = /[‎‏‪-‮⁦-⁩﻿]/g;
const DATE = String.raw`(\d{1,4})[./-](\d{1,2})[./-](\d{1,4})`;
const TIME = String.raw`(\d{1,2})[:.](\d{2})(?:[:.](\d{2}))?(?:\s?([ap])\.?\s?m\.?)?`;
const IPHONE = new RegExp(String.raw`^\[${DATE},?\s+${TIME}\]\s?(.*)$`, 'i');
const ANDROID = new RegExp(String.raw`^${DATE},?\s+${TIME}\s[-–]\s(.*)$`, 'i');

const MEDIA = /^(<media omitted>|<attached: .+>|(image|video|audio|sticker|gif|document|contact card|video note|voice message) omitted|.+\.(jpe?g|png|webp|gif|mp4|mov|opus|m4a|mp3|pdf|vcf|docx?) \(file attached\))$/i;
const DELETED = /^(this message was deleted\.?|you deleted this message\.?)$/i;
// WhatsApp's own opening notice, which an iPhone export writes as if the other person had sent it.
const NOTICE = /^messages and calls are end-to-end encrypted/i;
const EDITED = /\s*<this message was edited>$/i;

interface RawLine {
  a: number;
  b: number;
  c: number;
  aDigits: number;
  hour: number;
  minute: number;
  second: number;
  meridiem: string;
  rest: string;
}

function startOfMessage(line: string): RawLine | null {
  const match = IPHONE.exec(line) ?? ANDROID.exec(line);
  if (!match) return null;
  return {
    a: Number(match[1]),
    b: Number(match[2]),
    c: Number(match[3]),
    aDigits: (match[1] ?? '').length,
    hour: Number(match[4]),
    minute: Number(match[5]),
    second: Number(match[6] ?? 0),
    meridiem: (match[7] ?? '').toLowerCase(),
    rest: match[8] ?? '',
  };
}

const two = (n: number) => String(n).padStart(2, '0');

function timestamp(line: RawLine, order: DateOrder): string | null {
  const fullYear = (y: number) => (y < 100 ? 2000 + y : y);
  const [year, month, day] =
    order === 'year-first' ? [line.a, line.b, line.c] : order === 'month-first' ? [fullYear(line.c), line.a, line.b] : [fullYear(line.c), line.b, line.a];
  let hour = line.hour;
  if (line.meridiem === 'p' && hour < 12) hour += 12;
  if (line.meridiem === 'a' && hour === 12) hour = 0;
  if (month < 1 || month > 12 || day < 1 || day > 31 || hour > 23 || line.minute > 59 || line.second > 59) return null;
  return `${String(year).padStart(4, '0')}-${two(month)}-${two(day)}T${two(hour)}:${two(line.minute)}:${two(line.second)}`;
}

export function parseWhatsApp(file: string): ParsedChat {
  const lines = file
    .replace(INVISIBLE, '')
    .replace(/[  ]/g, ' ')
    .split(/\r\n|\r|\n/);

  // First pass: find the lines that start a message, and settle how the dates are written.
  const starts = lines.map(startOfMessage);
  const found = starts.filter((start) => start !== null);
  let dateOrder: DateOrder = 'day-first';
  let dateOrderCertain = false;
  if (found.some((start) => start.aDigits === 4)) {
    dateOrder = 'year-first';
    dateOrderCertain = true;
  } else if (found.some((start) => start.a > 12)) {
    dateOrderCertain = true;
  } else if (found.some((start) => start.b > 12)) {
    dateOrder = 'month-first';
    dateOrderCertain = true;
  }

  const messages: ChatMessage[] = [];
  let media = 0;
  let notices = 0;
  let notUnderstood = 0;
  /** The message that following lines belong to. Null while inside a notice, or before the first message. */
  let current: ChatMessage | null = null;
  let seenAny = false;

  const finish = () => {
    if (!current) return;
    const text = current.text.replace(EDITED, '').trim();
    if (MEDIA.test(text)) media += 1;
    else if (DELETED.test(text) || NOTICE.test(text) || text.length === 0) notices += 1;
    else messages.push({ ...current, text });
    current = null;
  };

  lines.forEach((line, index) => {
    const start = starts[index];
    const at = start ? timestamp(start, dateOrder) : null;
    if (start && at) {
      finish();
      seenAny = true;
      const colon = start.rest.indexOf(': ');
      const bare = start.rest.endsWith(':') ? start.rest.length - 1 : -1;
      const cut = colon > 0 ? colon : bare;
      if (cut <= 0 || cut > 80) {
        notices += 1; // a time but no sender: a notice from WhatsApp itself
        return;
      }
      current = { at, sender: start.rest.slice(0, cut).trim(), text: colon > 0 ? start.rest.slice(colon + 2) : '' };
      return;
    }
    if (current) current.text += `\n${line}`;
    else if (!seenAny && line.trim().length > 0) notUnderstood += 1;
  });
  finish();

  const counts = new Map<string, number>();
  for (const message of messages) counts.set(message.sender, (counts.get(message.sender) ?? 0) + 1);
  const senders = [...counts.entries()].map(([name, count]) => ({ name, count })).sort((x, y) => y.count - x.count || x.name.localeCompare(y.name));
  return { messages, senders, dateOrder, dateOrderCertain, media, notices, notUnderstood };
}

/** A name for the conversation, taken from the export's file name. */
export function chatNameFromFile(fileName: string): string {
  const stem = fileName.replace(/\.(zip|txt)$/i, '').replace(/\s*\(\d+\)$/, '');
  const name = stem.replace(/^whatsapp chat\s*(-|with)\s*/i, '').replace(/^_chat$/i, '').trim();
  return name;
}
