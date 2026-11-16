// Pieces of reading iPhone texts that need no files or database: turning
// Apple's packed text into words, and matching phone numbers to contacts.

/** One iPhone backup found on this computer. */
export interface IphoneBackup {
  /** The backup's folder. */
  folder: string;
  /** The phone's name, from the backup. Empty if the backup does not say. */
  device: string;
  /** When the backup was made, if the backup says. */
  madeAt: string | null;
}

function indexOf(haystack: Uint8Array, needle: readonly number[], from = 0): number {
  outer: for (let i = from; i + needle.length <= haystack.length; i += 1) {
    for (let j = 0; j < needle.length; j += 1) if (haystack[i + j] !== needle[j]) continue outer;
    return i;
  }
  return -1;
}

const NSSTRING = [...'NSString'].map((character) => character.charCodeAt(0));

/**
 * Newer iPhones keep a message's words inside a packed block (Apple's
 * "typedstream") and leave the plain text empty. The words sit after the
 * marker "NSString": a few bytes, then "+", then how long the text is, then
 * the text itself. Returns null if the block is not laid out that way.
 */
export function textFromAttributedBody(block: Uint8Array): string | null {
  const marker = indexOf(block, NSSTRING);
  if (marker < 0) return null;
  let at = marker + NSSTRING.length;
  const plus = block.indexOf(0x2b, at);
  if (plus < 0 || plus - at > 12) return null;
  at = plus + 1;
  let length = block[at] ?? 0;
  at += 1;
  if (length === 0x81) {
    // A length too big for one byte is written as two, low byte first.
    length = (block[at] ?? 0) | ((block[at + 1] ?? 0) << 8);
    at += 2;
  } else if (length === 0x82) {
    length = ((block[at] ?? 0) | ((block[at + 1] ?? 0) << 8) | ((block[at + 2] ?? 0) << 16) | ((block[at + 3] ?? 0) << 24)) >>> 0;
    at += 4;
  }
  if (length === 0 || at + length > block.length) return null;
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(block.subarray(at, at + length));
  } catch {
    return null;
  }
}

/** The words of a message, from its plain text or, failing that, its packed block. Attachment markers are taken out. */
export function messageWords(text: unknown, attributedBody: unknown): string {
  const plain = typeof text === 'string' && text.length > 0 ? text : attributedBody instanceof Uint8Array ? (textFromAttributedBody(attributedBody) ?? '') : '';
  return plain.replace(/￼/g, '').trim();
}

/**
 * A phone number or email address in a form that can be compared: an email
 * in lower case, a phone number as its last nine digits, so that
 * "+44 7700 900123" and "07700 900123" are the same.
 */
export function comparableHandle(handle: string): string {
  if (handle.includes('@')) return handle.trim().toLowerCase();
  const digits = handle.replace(/\D/g, '');
  return digits.length >= 9 ? digits.slice(-9) : digits;
}

/** Apple counts time from the start of 2001. In milliseconds since 1970, that moment is: */
export const APPLE_EPOCH_MS = 978_307_200_000;
