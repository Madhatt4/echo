// Letters the person wrote: a photo or scan of each page, and its words.
//
// Only letters the person wrote themselves are kept. A letter someone else
// wrote to them is that person's words, and Echo has no use for those.
//
// The words can be read off the picture by the AI service, using the person's
// own key. Whatever it reads is only a first go: the person checks it against
// the letter and corrects it by hand before it is saved.

import type { Audience, Person } from './people.ts';

export interface Letter {
  id: string;
  /** What the person calls it: "To Julie before the wedding". */
  title: string;
  /** Who it was written to, if they are one of the named people. */
  personId: string | null;
  /** When it was written, as far as the person knows: "", "1998", "1998-06" or "1998-06-14". */
  writtenOn: string;
  text: string;
  audience: Audience;
  /** How many pictures of its pages are kept. */
  pages: number;
  savedAt: string;
}

/** What the person sets when adding a letter or changing it. */
export interface LetterDetails {
  title: string;
  personId: string | null;
  writtenOn: string;
  text: string;
  audience: Audience;
  /** The person says they wrote this letter themselves. */
  mine: boolean;
  /** The person says they have read the words against the letter and they are right. */
  checked: boolean;
}

export const MAX_LETTER_LENGTH = 40_000;
export const MAX_LETTER_PAGES = 12;
/**
 * A page picture is made smaller on the screen before it is kept or sent, so this is generous.
 * It stays under the AI service's limit of 5 MB for a picture once it is coded for sending, which adds a third.
 */
export const MAX_PAGE_BYTES = 3.5 * 1024 * 1024;
/** The longest side of a page picture, in dots, after it is made smaller. Enough to read handwriting. */
export const PAGE_LONGEST_SIDE = 2000;
export const PAGE_TYPES: readonly string[] = ['image/jpeg', 'image/png', 'image/webp'];

/** The mark put where a word could not be read. */
export const UNREAD = '[?]';

export function unreadCount(text: string): number {
  return text.split(UNREAD).length - 1;
}

function isRoughDate(value: string): boolean {
  const match = /^(\d{4})(?:-(\d{2})(?:-(\d{2}))?)?$/.exec(value);
  if (!match) return false;
  const [year, month, day] = [Number(match[1]), match[2] ? Number(match[2]) : 1, match[3] ? Number(match[3]) : 1];
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return year >= 1900 && parsed.getUTCFullYear() === year && parsed.getUTCMonth() === month - 1 && parsed.getUTCDate() === day && parsed.getTime() <= Date.now();
}

/** Plain-English problems with a letter. An empty list means it can be saved. */
export function letterProblems(details: LetterDetails, people: readonly Person[]): string[] {
  const problems: string[] = [];
  if (!details.mine) problems.push('Echo only keeps letters you wrote yourself. A letter someone wrote to you is their words, not yours.');
  if (details.title.trim().length === 0) problems.push('Give the letter a name, so you can find it again.');
  if (details.title.trim().length > 120) problems.push('Keep the name to a few words.');
  if (details.personId !== null && !people.some((person) => person.id === details.personId)) {
    problems.push('Choose who the letter was to again. That person is no longer in your list.');
  }
  if (details.writtenOn !== '' && !isRoughDate(details.writtenOn)) {
    problems.push('Write when it was written as a year (1998), a year and month (1998-06) or a full date (1998-06-14), or leave it empty.');
  }
  if (details.text.trim().length === 0) problems.push('Type the words of the letter, or have Echo read a page.');
  if (details.text.length > MAX_LETTER_LENGTH) problems.push('That is too long for one letter. Split it into parts.');
  const unread = unreadCount(details.text);
  if (unread > 0) {
    problems.push(`${unread === 1 ? 'One place is' : `${unread} places are`} still marked ${UNREAD}. Type what the letter says there, or take the mark out.`);
  }
  if (details.audience.kind === 'person' && !people.some((person) => person.id === (details.audience as { personId: string }).personId)) {
    problems.push('Choose who may hear this again. That person is no longer in your list.');
  }
  if (!details.checked) problems.push('Read the words against the letter, then tick the box to say they are right.');
  return problems;
}

/** The details as they are stored. */
export function tidyLetter(details: LetterDetails): Omit<LetterDetails, 'mine' | 'checked'> {
  return {
    title: details.title.trim(),
    personId: details.personId,
    writtenOn: details.writtenOn,
    text: details.text.replace(/\r\n?/g, '\n').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim(),
    audience: details.audience,
  };
}

/** How a letter is named in the memory store, so the echo knows what it is drawing on and from when. */
export function letterSourceTitle(letter: { title: string; writtenOn: string }, toName: string | null): string {
  const to = toName ? `to ${toName}` : '';
  const when = letter.writtenOn ? `written ${letter.writtenOn}` : '';
  const about = [to, when].filter((part) => part.length > 0).join(', ');
  return about ? `${letter.title} (${about})` : letter.title;
}

/** What the AI service is told when it is shown a page. */
export const READ_PAGE_INSTRUCTIONS = [
  'You are reading a letter from a photo or scan of one page, for the person who wrote it. They will check your reading against the page and correct it.',
  'Write out the words on the page exactly as they are written, in the order they are read.',
  'Rules:',
  '- Copy, do not improve. Keep the spelling, the punctuation and the wording as written, mistakes included.',
  `- Where you cannot read a word, write ${UNREAD} in its place. Never guess a word you cannot read, and never fill a gap with what would make sense.`,
  '- Keep paragraphs as paragraphs, with an empty line between them. Join lines that are one paragraph.',
  '- Leave out anything that is not part of the letter: printed letterheads, page numbers, stamps, the background.',
  '- Add nothing of your own: no heading, no description of the page, no comment before or after.',
  '- If there is no writing you can read on the page at all, answer with exactly: NOTHING',
].join('\n');

export const READ_PAGE_MESSAGE = 'Here is the page. Write out its words.';

/** Makes sense of what came back from a reading. */
export function readPageAnswer(answer: string): { ok: true; text: string } | { ok: false; problem: string } {
  const text = answer.replace(/\r\n?/g, '\n').trim();
  if (text.length === 0 || /^NOTHING\.?$/i.test(text)) {
    return { ok: false, problem: 'Echo could not find any writing to read in that picture. Try a sharper photo in better light, or type the words.' };
  }
  return { ok: true, text };
}
