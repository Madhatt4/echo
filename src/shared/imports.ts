// Imported conversations. One importer, one small reader per service.
//
// Every imported message is either the owner's or someone else's. Someone
// else's words are marked `thirdParty` when the conversation is imported, and
// nothing can change that mark afterwards. They stay in the encrypted archive
// on this computer so the owner can read the conversation, and they go
// nowhere else: not into the memory store, not to Claude, not into any reply.

import type { MemorySource } from './memories.ts';
import type { Audience, Person } from './people.ts';

export type ImportService = 'whatsapp' | 'messenger' | 'iphone' | 'discord' | 'email';

export const SERVICE_NAMES: Record<ImportService, string> = { whatsapp: 'WhatsApp', messenger: 'Messenger', iphone: 'iPhone texts', discord: 'Discord', email: 'Email' };

export interface ImportedMessage {
  /** Local date and time as written in the export: YYYY-MM-DDTHH:MM:SS. */
  at: string;
  sender: string;
  text: string;
  /** True for anyone but the owner. Set at import and never changed. */
  thirdParty: boolean;
}

export interface ImportSummary {
  id: string;
  service: ImportService;
  /** What the owner calls this conversation: "Ada", "Family group". */
  label: string;
  importedAt: string;
  /** A fingerprint of the exported text, so the same export is not imported twice. */
  fileHash: string;
  /** The sender name that is the owner. */
  me: string;
  /** The person in the People list this conversation is with, if it is with one of them. */
  personId: string | null;
  /** Who may hear what the owner said in it. Null means nobody: it is kept but the echo does not use it. */
  audience: Audience | null;
  mine: number;
  others: number;
  from: string;
  to: string;
}

/** What the owner is shown before anything is saved. */
export interface ImportPreview {
  token: string;
  service: ImportService;
  fileName: string;
  suggestedLabel: string;
  messages: number;
  senders: { name: string; count: number }[];
  from: string;
  to: string;
  /** Set when no date in the file settles whether the day or the month comes first. */
  datesAssumedDayFirst: boolean;
  media: number;
  notices: number;
  /** The first few messages, so the owner can see it was read properly. */
  sample: { at: string; sender: string; text: string }[];
  /** The label of an earlier import of exactly this export, if there is one. */
  alreadyImportedAs: string | null;
  /** The sender Echo thinks is the owner, from earlier imports or their name. The owner still has to confirm it. */
  suggestedMe: string | null;
}

/** One conversation found inside a download that holds many, before it has been opened. */
export interface ThreadChoice {
  key: string;
  name: string;
  files: number;
  /** How big the conversation's files are, where that is all that is known before opening it. */
  bytes: number;
  /** How many messages it holds, where that is known. */
  messages?: number;
}

/** What choosing a file gives back: one conversation to check, or a list of conversations to pick from. */
/** What Echo found in a mailbox file, before it knows which emails are the owner's. */
export interface MailboxFound {
  fileName: string;
  emails: number;
  /** The addresses the most email was sent from. */
  addresses: { address: string; name: string; count: number }[];
  /** The ones Echo thinks are the owner's. */
  suggested: string[];
}

export type ImportChosen =
  | { ok: true; preview: ImportPreview }
  | { ok: true; threads: ThreadChoice[]; fileName: string }
  /** A mailbox has been read: the owner says which of the addresses mail was sent from are theirs. */
  | { ok: true; mailbox: MailboxFound }
  /** `needsPassword` is set when an iPhone backup is encrypted and its password has to be typed; `folder` says which backup. */
  | { ok: false; problems: string[]; needsPassword?: boolean; folder?: string };

/** What the owner decides at import. */
export interface ImportChoice {
  me: string;
  label: string;
  personId: string | null;
  audience: Audience | null;
}

export function importChoiceProblems(choice: ImportChoice, senders: readonly { name: string }[], people: readonly Person[]): string[] {
  const problems: string[] = [];
  if (!senders.some((sender) => sender.name === choice.me)) problems.push('Choose which of the names in this conversation is you.');
  if (choice.label.trim().length === 0) problems.push('Give this conversation a name, like the person it is with.');
  if (choice.label.trim().length > 80) problems.push('Keep the name of the conversation short.');
  if (choice.personId !== null && !people.some((person) => person.id === choice.personId)) problems.push('The person you chose is no longer in your list. Choose again.');
  const audience = choice.audience;
  if (audience?.kind === 'person') {
    if (audience.personId !== choice.personId) problems.push('What you said here can be for everyone, for the person the conversation is with, or for nobody.');
  }
  return problems;
}

/** The longest gap, in minutes, between two of the owner's messages that still count as one thing said. */
const BURST_GAP_MINUTES = 10;
/** A burst shorter than this many words says too little to be a memory. */
const MIN_BURST_WORDS = 3;

/**
 * The owner's own words from a conversation, as the memory store takes them:
 * messages sent one after another, with nobody else speaking in between, are
 * joined into one. Other people's messages are never included, and neither is
 * anything about what they said.
 */
export function messageSources(summary: ImportSummary, messages: readonly ImportedMessage[]): MemorySource[] {
  const audience = summary.audience;
  if (audience === null) return [];
  const sources: MemorySource[] = [];
  let burst: ImportedMessage[] = [];
  const used = new Map<string, number>();

  const finish = () => {
    const first = burst[0];
    if (!first) return;
    const text = burst.map((message) => message.text).join('\n');
    burst = [];
    if (text.split(/\s+/).filter((word) => word.length > 0).length < MIN_BURST_WORDS) return;
    const seen = used.get(first.at) ?? 0;
    used.set(first.at, seen + 1);
    sources.push({
      kind: 'message',
      id: `${summary.id}/${first.at}${seen > 0 ? `#${seen}` : ''}`,
      title: `${SERVICE_NAMES[summary.service]} with ${summary.label}`,
      context: '',
      text,
      date: first.at,
      audience,
      use: 'memory',
    });
  };

  for (const message of messages) {
    if (message.thirdParty) {
      finish();
      continue;
    }
    const last = burst.at(-1);
    if (last && (new Date(message.at).getTime() - new Date(last.at).getTime()) / 60_000 > BURST_GAP_MINUTES) finish();
    burst.push(message);
  }
  finish();
  return sources;
}

/** How many words in a row a reply must share with someone else's message to count as repeating it. */
export const QUOTE_LENGTH = 8;

function plainWords(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^\p{L}\p{N}']+/u)
    .filter((word) => word.length > 0);
}

/** Every run of eight words in other people's messages, for checking replies against. */
export function thirdPartyRuns(messages: readonly ImportedMessage[], into: Set<string> = new Set()): Set<string> {
  for (const message of messages) {
    if (!message.thirdParty) continue;
    const words = plainWords(message.text);
    for (let i = 0; i + QUOTE_LENGTH <= words.length; i += 1) into.add(words.slice(i, i + QUOTE_LENGTH).join(' '));
  }
  return into;
}

/** The first run of words in a reply that repeats someone else's message, or null if there is none. */
export function repeatsThirdParty(reply: string, runs: ReadonlySet<string>): string | null {
  if (runs.size === 0) return null;
  const words = plainWords(reply);
  for (let i = 0; i + QUOTE_LENGTH <= words.length; i += 1) {
    const run = words.slice(i, i + QUOTE_LENGTH).join(' ');
    if (runs.has(run)) return run;
  }
  return null;
}
