// The people in the person's life who matter to their echo, and the rule that
// decides who may see what.

export interface Person {
  id: string;
  /** What the owner calls them: "Julie", "Mum", "our Sam". */
  name: string;
  /** In the owner's words: "my wife", "eldest son", "best friend". */
  relationship: string;
  /** What they call the owner: "Dad", "Grandad", a first name. The echo answers to it. */
  callsMe: string;
  /** True if this person is to be allowed to talk to the echo. */
  mayTalkToEcho: boolean;
  addedAt: string;
}

/** What the person types when adding or changing someone. */
export interface PersonDetails {
  name: string;
  relationship: string;
  callsMe: string;
  mayTalkToEcho: boolean;
}

/** Plain-English problems with someone's details. An empty list means they are fine. */
export function personProblems(details: PersonDetails, others: readonly Person[]): string[] {
  const problems: string[] = [];
  const name = details.name.trim();
  if (name.length === 0) problems.push('Type their name, the way you say it.');
  if (name.length > 80) problems.push('That name is too long.');
  if (details.relationship.trim().length > 80) problems.push('Keep the relationship to a few words.');
  if (details.callsMe.trim().length > 80) problems.push('Keep what they call you to a few words.');
  if (name.length > 0 && others.some((other) => other.name.trim().toLowerCase() === name.toLowerCase())) {
    problems.push(`You already have someone called ${name}. Add something to tell them apart, like a surname.`);
  }
  return problems;
}

/** Who a captured item is meant for. */
export type Audience =
  /** Any named family member may hear it. This is the default. */
  | { kind: 'everyone' }
  /** Only this one person may ever hear it. */
  | { kind: 'person'; personId: string };

export const EVERYONE: Audience = { kind: 'everyone' };

/**
 * The privacy rule, in one place. May the person with `listenerId` be given
 * an item meant for `audience`?
 *
 * - Something for everyone goes to any person who is still in the list.
 * - Something for one person goes to that person and nobody else.
 * - If the person it was for has been removed, it goes to nobody. It never
 *   falls back to everyone.
 * - Someone who is not in the list is given nothing at all.
 */
export function mayHear(audience: Audience, listenerId: string, people: readonly Person[]): boolean {
  if (!people.some((person) => person.id === listenerId)) return false;
  if (audience.kind === 'everyone') return true;
  return audience.personId === listenerId && people.some((person) => person.id === audience.personId);
}

/** The items a listener may be given, in their original order. */
export function onlyWhatTheyMayHear<T extends { audience: Audience }>(
  items: readonly T[],
  listenerId: string,
  people: readonly Person[],
): T[] {
  return items.filter((item) => mayHear(item.audience, listenerId, people));
}

/** Who an item is for, in words, for showing on screen. */
export function audienceLabel(audience: Audience, people: readonly Person[]): string {
  if (audience.kind === 'everyone') return 'Everyone';
  const person = people.find((p) => p.id === audience.personId);
  return person ? `Only ${person.name}` : 'Nobody (the person it was for has been removed)';
}
