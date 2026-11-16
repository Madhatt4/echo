// The character sheet and the style profile: short first-person lines about
// who the person is and how they talk. Claude drafts them from the person's
// own passages, and every drafted line must point at the passages it rests
// on. The person can confirm, correct, strike or add lines.
//
// Privacy is by construction: general lines are drafted only from passages
// meant for everyone. A line about how the person talks to one named person
// is drafted only from passages meant for that person, and is only ever used
// when the echo is talking to them.

import type { Memory } from './memories.ts';
import { memoryWords, usable } from './memories.ts';
import type { Audience, Person } from './people.ts';

export type SheetKind = 'character' | 'style';

export interface SheetSection {
  id: string;
  title: string;
  /** What belongs in this section, told to Claude and shown to the person. */
  holds: string;
}

/** The section of the style profile that holds lines about one named person. */
export const PEOPLE_SECTION = 'people';

export const SHEET_SECTIONS: Record<SheetKind, readonly SheetSection[]> = {
  character: [
    { id: 'values', title: 'What matters most to me', holds: 'What they care about and put first.' },
    { id: 'beliefs', title: 'What I believe', holds: 'Their convictions about life, people, work, faith or politics, as they put them.' },
    { id: 'humour', title: 'What I find funny', holds: 'Their sense of humour and how they use it.' },
    { id: 'temperament', title: 'How I am with people and under pressure', holds: 'How they react, argue, comfort, worry and decide.' },
    { id: 'never', title: 'What I would never say or do', holds: 'Lines they will not cross and things that are not like them.' },
  ],
  style: [
    { id: 'voice', title: 'How I talk', holds: 'Rhythm, bluntness or gentleness, how formal they are, how long they go on.' },
    { id: 'phrases', title: 'Words and phrases I use', holds: 'Pet phrases, favourite words, dialect and turns of speech, quoted exactly.' },
    { id: 'greetings', title: 'How I start and finish', holds: 'How they greet people, sign off, and say goodbye.' },
    { id: PEOPLE_SECTION, title: 'How I talk to each person', holds: 'What is different about how they speak to one named person: names they use for them, tone, what they joke about.' },
  ],
};

export interface SheetLine {
  id: string;
  section: string;
  text: string;
  /** The passages a drafted line rests on. Empty for a line the person wrote. */
  evidence: string[];
  /** Everyone, or the one person this line is about. */
  audience: Audience;
  /** Who wrote the words as they stand. */
  origin: 'drafted' | 'yours';
  /** True once the person has said "that is me". */
  checked: boolean;
}

export interface Sheet {
  lines: SheetLine[];
  /** Drafted lines the person struck out, so they are not suggested again. */
  rejected: string[];
  draftedAt: string | null;
  /** How many passages the last draft was made from. */
  draftedFrom: number;
}

export const EMPTY_SHEET: Sheet = { lines: [], rejected: [], draftedAt: null, draftedFrom: 0 };

export const MAX_LINE_LENGTH = 400;
export const MAX_LINES_PER_SECTION = 10;
export const MAX_REJECTED_REMEMBERED = 60;
/** The most text sent to Claude for one draft, in characters. */
export const DRAFT_BUDGET = 120_000;

/** Measured from the person's words on this computer, with no AI. */
export interface StyleMeasure {
  words: number;
  sentences: number;
  averageSentenceWords: number;
}

export function measureStyle(texts: readonly string[]): StyleMeasure {
  let words = 0;
  let sentences = 0;
  for (const text of texts) {
    for (const sentence of text.split(/[.!?]+(?:\s+|$)|\n+/)) {
      const count = sentence.split(/\s+/).filter((word) => word.length > 0).length;
      if (count === 0) continue;
      words += count;
      sentences += 1;
    }
  }
  return { words, sentences, averageSentenceWords: sentences === 0 ? 0 : Math.round((words / sentences) * 10) / 10 };
}

/** The passages a general draft may be made from: in use, and meant for everyone. */
export function passagesForEveryone(memories: readonly Memory[]): Memory[] {
  return memories.filter((memory) => usable(memory) && memory.audience.kind === 'everyone');
}

/** The passages a draft about one person may be made from: in use, and meant for that person alone. */
export function passagesForPerson(memories: readonly Memory[], personId: string): Memory[] {
  return memories.filter((memory) => usable(memory) && memory.audience.kind === 'person' && memory.audience.personId === personId);
}

/** As many of the passages as fit the budget, newest first. */
export function withinBudget(memories: readonly Memory[], budget = DRAFT_BUDGET): Memory[] {
  const chosen: Memory[] = [];
  let used = 0;
  for (const memory of [...memories].sort((a, b) => b.date.localeCompare(a.date))) {
    const size = memoryWords(memory).length + memory.context.length + 80;
    if (used + size > budget) continue;
    chosen.push(memory);
    used += size;
  }
  return chosen;
}

/** What Claude is told about its job when drafting. `forPerson` is set when drafting how the person talks to one named person. */
export function draftInstructions(kind: SheetKind, ownerName: string | null, forPerson: Person | null): string {
  const who = ownerName ?? 'this person';
  const sections = forPerson ? SHEET_SECTIONS.style.filter((section) => section.id === PEOPLE_SECTION) : SHEET_SECTIONS[kind].filter((section) => section.id !== PEOPLE_SECTION);
  const what =
    kind === 'character'
      ? `a character sheet for ${who}: who they are, what they value and believe, their humour and temperament, and what they would never say or do`
      : forPerson
        ? `notes on how ${who} talks to one particular person, ${forPerson.name}${forPerson.relationship ? ` (${forPerson.relationship})` : ''}`
        : `a style profile for ${who}: how they talk, the words and phrases they use, and how they start and finish`;
  return [
    `You are helping build Echo, an app that lets a person record who they are so that, after their death, their family can talk to an AI echo of them. Your job now is to draft ${what}. The echo will rely on it to sound like them, and ${who} will read every line and correct it.`,
    '',
    forPerson
      ? `You will be given numbered passages that ${who} recorded for ${forPerson.name} alone. They are ${who}'s own words.`
      : `You will be given numbered passages of ${who}'s own words, from their life stories, an interview and advice they have recorded.`,
    '',
    'Rules:',
    '- Every line must rest on what the passages actually say or show. After each line, list the numbers of the passages it rests on. A line with no passage behind it must not be written.',
    '- Stay close to the evidence. Do not guess, flatter, diagnose or generalise beyond it. No psychological labels. If the passages show little about a section, write few lines for it or none. Fewer true lines are better than more.',
    '- Do not record events or facts about their life. Those are kept separately as memories. Write only what the passages show about who they are and how they talk.',
    `- Write each line in the first person, as ${who} would say it about themselves ("I say what I think, even when it costs me"). One or two sentences. Plain words.`,
    kind === 'style' ? '- When you quote a word or phrase they use, quote it exactly as it appears in a passage.' : '- Use their own wording where a passage puts it well.',
    forPerson ? `- Write only what is particular to how they speak to ${forPerson.name}.` : '- Do not write anything about how they speak to one particular person.',
    `- At most ${MAX_LINES_PER_SECTION} lines in a section.`,
    '',
    'Sections:',
    ...sections.map((section) => `- "${section.id}": ${section.title}. ${section.holds}`),
    '',
    'Reply with JSON only, in exactly this shape, and nothing else:',
    '{"lines": [{"section": "<section id>", "text": "<the line>", "passages": [<numbers>]}]}',
  ].join('\n');
}

/** The numbered passages, and anything else Claude needs, as the one message it is sent. */
export function draftMessage(passages: readonly Memory[], rejected: readonly string[], measure: StyleMeasure | null): string {
  const parts: string[] = [];
  if (measure && measure.sentences > 0) {
    parts.push(`Measured from all their recorded words: ${measure.words} words in ${measure.sentences} sentences, ${measure.averageSentenceWords} words to a sentence on average.`, '');
  }
  if (rejected.length > 0) {
    parts.push('They have read earlier drafts and said these lines are NOT them. Do not write these or anything close to them:', ...rejected.map((line) => `- ${line}`), '');
  }
  parts.push('Passages:');
  passages.forEach((memory, index) => {
    const about = memory.context ? `${memory.source.title}; they were asked: ${memory.context}` : memory.source.title;
    parts.push(`[${index + 1}] (${memory.source.kind}: ${about})`, memoryWords(memory), '');
  });
  return parts.join('\n');
}

export interface DraftedLine {
  section: string;
  text: string;
  /** Positions in the list of passages that was sent, counted from 0. */
  passages: number[];
}

/**
 * Reads Claude's draft. Anything that breaks the rules is dropped: an unknown
 * section, an empty or over-long line, a line with no real passage behind it,
 * and lines past the limit for a section. Returns null if it is not a draft at all.
 */
export function readDraft(text: string, allowedSections: readonly string[], passageCount: number): DraftedLine[] | null {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(text.slice(start, end + 1));
  } catch {
    return null;
  }
  const lines = (parsed as { lines?: unknown }).lines;
  if (!Array.isArray(lines)) return null;

  const kept: DraftedLine[] = [];
  const perSection = new Map<string, number>();
  for (const candidate of lines) {
    if (typeof candidate !== 'object' || candidate === null) continue;
    const { section, text: words, passages } = candidate as { section?: unknown; text?: unknown; passages?: unknown };
    if (typeof section !== 'string' || !allowedSections.includes(section)) continue;
    if (typeof words !== 'string') continue;
    const line = words.replace(/\s+/g, ' ').trim();
    if (line.length === 0 || line.length > MAX_LINE_LENGTH) continue;
    const behind = Array.isArray(passages)
      ? [...new Set(passages.filter((n): n is number => Number.isInteger(n) && n >= 1 && n <= passageCount).map((n) => n - 1))]
      : [];
    if (behind.length === 0) continue;
    if ((perSection.get(section) ?? 0) >= MAX_LINES_PER_SECTION) continue;
    perSection.set(section, (perSection.get(section) ?? 0) + 1);
    kept.push({ section, text: line, passages: behind });
  }
  return kept;
}

function same(a: string, b: string): boolean {
  const plain = (text: string) => text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
  return plain(a) === plain(b);
}

/**
 * Puts a new draft into the sheet. Lines the person wrote, corrected or
 * confirmed are kept. Drafted lines they never confirmed are replaced, but
 * only those for the same audience as this draft. A drafted line that repeats
 * a kept line, or one they struck out, is dropped.
 */
export function mergeDraft(sheet: Sheet, drafted: readonly Omit<SheetLine, 'id' | 'origin' | 'checked'>[], audience: Audience, newId: () => string): SheetLine[] {
  const sameAudience = (line: SheetLine) =>
    audience.kind === 'everyone' ? line.audience.kind === 'everyone' : line.audience.kind === 'person' && line.audience.personId === audience.personId;
  const kept = sheet.lines.filter((line) => !sameAudience(line) || line.origin === 'yours' || line.checked);
  const fresh: SheetLine[] = [];
  for (const line of drafted) {
    if ([...kept, ...fresh].some((other) => same(other.text, line.text))) continue;
    if (sheet.rejected.some((struck) => same(struck, line.text))) continue;
    fresh.push({ ...line, id: newId(), origin: 'drafted', checked: false });
  }
  return [...kept, ...fresh];
}

/** Plain-English problems with the words of a line. An empty list means they are fine. */
export function lineProblems(text: string): string[] {
  const line = text.trim();
  if (line.length === 0) return ['A line cannot be empty. To take it off the sheet, strike it out instead.'];
  if (line.length > MAX_LINE_LENGTH) return ['Keep each line to a sentence or two.'];
  return [];
}

/** A change the person makes to one line. New words make the line theirs; `checked` says "that is me". */
export interface SheetLineChange {
  text?: string;
  checked?: true;
}

/** One passage a line rests on, for showing under the line. */
export interface Support {
  memoryId: string;
  title: string;
  excerpt: string;
}

/** A line as the screen shows it. */
export interface SheetLineView extends SheetLine {
  /** The passages behind the line that are still there, still in use, and may be heard by the line's audience. */
  support: Support[];
  /**
   * True if the echo may rely on this line. A line the person wrote or
   * confirmed is always in use. A drafted line is in use only while at least
   * one passage still stands behind it.
   */
  inUse: boolean;
}

export interface SheetView {
  kind: SheetKind;
  lines: SheetLineView[];
  draftedAt: string | null;
  draftedFrom: number;
  /** Passages a new general draft would be made from. */
  passagesAvailable: number;
  keyReady: boolean;
  /** Only for the style profile. */
  measure: StyleMeasure | null;
}

/** Works out what stands behind each line now, and whether the echo may rely on it. */
export function viewLines(lines: readonly SheetLine[], memories: readonly Memory[]): SheetLineView[] {
  return lines.map((line) => {
    const support: Support[] = [];
    for (const id of line.evidence) {
      const memory = memories.find((candidate) => candidate.id === id);
      if (!memory || !usable(memory)) continue;
      const mayStandBehind =
        memory.audience.kind === 'everyone' || (line.audience.kind === 'person' && memory.audience.personId === line.audience.personId);
      if (!mayStandBehind) continue;
      const words = memoryWords(memory);
      support.push({ memoryId: memory.id, title: memory.source.title, excerpt: words.length > 220 ? `${words.slice(0, 220)}…` : words });
    }
    return { ...line, support, inUse: line.origin === 'yours' || line.checked || support.length > 0 };
  });
}

export function sheetTitle(kind: SheetKind): string {
  return kind === 'character' ? 'Character sheet' : 'Style profile';
}
