// Notes: words the person's assistant wrote up and the person then read,
// corrected and approved as their own. Until approved they are only a draft
// in the assistant's tray; once approved they are the person's words like any
// other, and are named so the echo and the person can tell where they began.

import type { Audience, Person } from './people.ts';

export interface Note {
  id: string;
  title: string;
  text: string;
  audience: Audience;
  approvedAt: string;
}

/** What the person sets when approving a draft. */
export interface NoteDetails {
  title: string;
  text: string;
  audience: Audience;
  /** The person says they have read the words and they are theirs. */
  mine: boolean;
}

export const MAX_NOTE_LENGTH = 20_000;

/** Plain-English problems with a note. An empty list means it can be saved. */
export function noteProblems(details: NoteDetails, people: readonly Person[]): string[] {
  const problems: string[] = [];
  if (details.title.trim().length === 0) problems.push('Give it a short title so you can find it again.');
  if (details.title.trim().length > 120) problems.push('Keep the title to a few words.');
  if (details.text.trim().length === 0) problems.push('There are no words to keep.');
  if (details.text.length > MAX_NOTE_LENGTH) problems.push('That is too long for one note. Split it into parts.');
  const hears = details.audience;
  const hearsId = hears.kind === 'person' ? hears.personId : null;
  if (hearsId !== null && !people.some((person) => person.id === hearsId)) problems.push('Choose who may hear this again. That person is no longer in your list.');
  if (!details.mine) problems.push('Read it through, put right anything that is not how you would say it, then tick the box to say these are your words.');
  return problems;
}

/** How a note is named in the memory store. */
export function noteSourceTitle(title: string): string {
  return `${title} (written up by my assistant, read and approved by me)`;
}
