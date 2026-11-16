// Advice: something the person wants to say to one named person about one
// named occasion. Two kinds. "When asked" is brought up by the echo when the
// conversation with that person reaches the occasion. "On the day" is held
// back until the day itself.

import type { Audience, Person } from './people.ts';

export type AdviceKind = 'when-asked' | 'on-the-day';

export interface Advice {
  id: string;
  /** Who it is for. Advice is always for one named person. */
  personId: string;
  occasion: string;
  kind: AdviceKind;
  /** The day it is for, as YYYY-MM-DD, when it is "on the day" and the date is known. Otherwise empty. */
  date: string;
  /** The advice in words. */
  text: string;
  /** True if it was spoken and the recording is kept. */
  spoken: boolean;
  savedAt: string;
}

/** What the person sets when adding advice or changing it. */
export interface AdviceDetails {
  personId: string;
  occasion: string;
  kind: AdviceKind;
  date: string;
  text: string;
}

export const MAX_ADVICE_LENGTH = 20_000;

/** Occasions to choose from. The person can type any other. */
export const OCCASIONS: readonly string[] = [
  'Your wedding day',
  'When your first child is born',
  'Your 18th birthday',
  'Your 21st birthday',
  'Your 30th birthday',
  'Your 40th birthday',
  'Leaving school',
  'Starting your first job',
  'Losing a job',
  'Buying your first home',
  'When a relationship ends',
  'When you are struggling',
  'When someone you love dies',
  'The day of my funeral',
  'The first Christmas without me',
  'When you retire',
];

function isRealDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

/** Plain-English problems with a piece of advice. An empty list means it is fine. */
export function adviceProblems(details: AdviceDetails, people: readonly Person[]): string[] {
  const problems: string[] = [];
  if (!people.some((person) => person.id === details.personId)) {
    problems.push('Choose who this advice is for. If they are not in the list, add them on the People screen first.');
  }
  if (details.occasion.trim().length === 0) problems.push('Say what occasion this advice is for.');
  if (details.occasion.trim().length > 120) problems.push('Keep the occasion to a few words.');
  if (details.kind !== 'when-asked' && details.kind !== 'on-the-day') problems.push('Choose when your echo should share this.');
  if (details.text.trim().length === 0) problems.push('Say or type the advice first.');
  if (details.text.length > MAX_ADVICE_LENGTH) problems.push('That is too much for one piece of advice. Split it into parts.');
  if (details.kind === 'on-the-day' && details.date !== '' && !isRealDate(details.date)) {
    problems.push('That date is not one Echo recognises. Choose it again, or leave it empty.');
  }
  return problems;
}

/** The details as they are stored: trimmed, and with no date unless it is for a day. */
export function tidyAdvice(details: AdviceDetails): AdviceDetails {
  return {
    personId: details.personId,
    occasion: details.occasion.trim(),
    kind: details.kind,
    date: details.kind === 'on-the-day' ? details.date : '',
    text: details.text.trim(),
  };
}

/** Advice is only ever shared with the person it is for. */
export function adviceAudience(advice: { personId: string }): Audience {
  return { kind: 'person', personId: advice.personId };
}

export function adviceKindLabel(kind: AdviceKind): string {
  return kind === 'on-the-day' ? 'Kept for the day' : 'Said when they ask';
}
