// The persona engine's rules, as plain functions: who may hear what, which
// passages go into a reply, what Claude is told when it speaks as the echo,
// and what the checker is told when it reads a draft.
//
// Nothing here talks to Claude. src/core/persona.ts does that.

import type { Memory } from './memories.ts';
import { memoryWords, usable } from './memories.ts';
import { mayHear } from './people.ts';
import type { Person } from './people.ts';
import { SHEET_SECTIONS } from './sheets.ts';
import type { SheetKind, SheetLineView } from './sheets.ts';

/** Who the echo is talking to: the owner trying it out, or one named person. */
export type Listener = { kind: 'owner' } | { kind: 'person'; personId: string };

export const OWNER: Listener = { kind: 'owner' };

/** How a reply got through the check: first time, after one redraft, or not at all (the "nothing" line was used). */
export type CheckOutcome = 'passed' | 'redrafted' | 'fallback';

/** The key a listener's conversations are kept under. */
export function listenerKey(listener: Listener): string {
  return listener.kind === 'owner' ? 'owner' : listener.personId;
}

/**
 * The passages the echo may draw on when talking to this listener: in use,
 * and meant for them. The owner trying it out is given only what is meant for
 * everyone, which is what any family member would get.
 */
export function permittedPassages(memories: readonly Memory[], listener: Listener, people: readonly Person[]): Memory[] {
  return memories.filter((memory) => {
    if (!usable(memory)) return false;
    if (listener.kind === 'owner') return memory.audience.kind === 'everyone';
    return mayHear(memory.audience, listener.personId, people);
  });
}

/** The lines of a sheet the echo may rely on when talking to this listener. */
export function permittedLines(lines: readonly SheetLineView[], listener: Listener, people: readonly Person[]): SheetLineView[] {
  return lines.filter((line) => {
    if (!line.inUse) return false;
    if (line.audience.kind === 'everyone') return true;
    return listener.kind === 'person' && mayHear(line.audience, listener.personId, people);
  });
}

const STOP_WORDS = new Set(
  'a about after again all also am an and any are as at be because been before being but by can could did do does doing down each ever for from get got had has have having he her here hers him his how i if in into is it its just like me more most my no not now of off on once one only or other our out over own really said same she should so some such tell than that the their them then there these they thing things this those through to too under until up us very was we well were what when where which while who whom why will with would you your yours remember know think'.split(
    ' ',
  ),
);

/** The words of a text that are worth matching on, cut down roughly to their stems. */
export function searchTerms(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((word) => word.length > 2 && !STOP_WORDS.has(word))
    .map((word) => (word.length > 5 ? word.replace(/(ing|ed|es|s)$/, '') : word.length > 3 ? word.replace(/s$/, '') : word));
}

/** The most passage text put in front of Claude for one reply, in characters. */
export const REPLY_PASSAGE_BUDGET = 24_000;

/**
 * The passages for one reply, most relevant first. If everything permitted
 * fits the budget, everything is given. If not, the passages that best match
 * what is being talked about are chosen, with a small lift for passages that
 * involve the listener and for advice meant for them.
 */
export function choosePassages(permitted: readonly Memory[], query: string, listener: Listener, budget = REPLY_PASSAGE_BUDGET): Memory[] {
  const wanted = [...new Set(searchTerms(query))];
  const documents = permitted.map((memory) => searchTerms(`${memoryWords(memory)} ${memory.source.title} ${memory.context}`));
  const averageLength = documents.reduce((sum, terms) => sum + terms.length, 0) / Math.max(documents.length, 1);
  const containing = new Map<string, number>();
  for (const term of wanted) containing.set(term, documents.filter((terms) => terms.includes(term)).length);

  const scored = permitted.map((memory, index) => {
    const terms = documents[index] ?? [];
    let score = 0;
    for (const term of wanted) {
      const frequency = terms.filter((candidate) => candidate === term).length;
      if (frequency === 0) continue;
      const rarity = Math.log(1 + (permitted.length - (containing.get(term) ?? 0) + 0.5) / ((containing.get(term) ?? 0) + 0.5));
      score += (rarity * frequency * 2.2) / (frequency + 1.2 * (0.25 + 0.75 * (terms.length / Math.max(averageLength, 1))));
    }
    if (listener.kind === 'person' && memory.people.includes(listener.personId)) score += 0.4;
    if (memory.use === 'advice-when-asked') score += 0.4;
    return { memory, score };
  });
  scored.sort((a, b) => b.score - a.score || b.memory.date.localeCompare(a.memory.date));

  const chosen: Memory[] = [];
  let used = 0;
  for (const { memory } of scored) {
    const size = memoryWords(memory).length + memory.context.length + 80;
    if (used + size > budget) continue;
    chosen.push(memory);
    used += size;
  }
  return chosen;
}

function firstName(fullName: string): string {
  return fullName.trim().split(/\s+/)[0] ?? fullName;
}

/**
 * The line every conversation opens with. It is written by the app, not by
 * Claude, and cannot be switched off.
 */
export function openingLine(ownerName: string): string {
  const first = firstName(ownerName);
  return `I'm an AI echo of ${ownerName}, made from what ${first} recorded. I'm not ${first}, and I can only tell you what ${first} told Echo, but I'll talk to you the way ${first} would.`;
}

/** What the echo says when a reply cannot be made safe: the "nothing" answer, in the first person. */
export const NOTHING_LINE = "I never got round to telling Echo about that one, so I can't tell you. Ask me about something else?";

export interface EchoTurn {
  role: 'them' | 'echo';
  text: string;
}

export interface EchoContext {
  ownerName: string;
  /** The person being spoken to. Null when the owner is trying the echo out. */
  listener: Person | null;
  character: readonly SheetLineView[];
  style: readonly SheetLineView[];
  passages: readonly Memory[];
  /** What this listener said to the echo in earlier conversations, oldest first. */
  toldBefore: readonly string[];
  /** True when the echo is answering one question on its own, as in the blind test, and not holding a conversation. */
  singleAnswer?: boolean;
  /** True when the one asking is the person's own AI assistant, through the assistant door, and not a person at all. */
  assistant?: boolean;
}

function sheetText(kind: SheetKind, lines: readonly SheetLineView[], listenerName: string | null): string[] {
  const out: string[] = [];
  for (const section of SHEET_SECTIONS[kind]) {
    const here = lines.filter((line) => line.section === section.id);
    if (here.length === 0) continue;
    out.push(`${section.id === 'people' && listenerName ? `How I talk to ${listenerName}` : section.title}:`, ...here.map((line) => `- ${line.text}`));
  }
  return out.length > 0 ? out : ['(Nothing has been written here yet.)'];
}

function passageText(passages: readonly Memory[]): string[] {
  if (passages.length === 0) return ['(There are no passages for this conversation.)'];
  const out: string[] = [];
  passages.forEach((memory, index) => {
    const label = memory.use === 'advice-when-asked' ? `advice for this person, for the occasion: ${memory.source.title}` : `${memory.source.kind}: ${memory.source.title}`;
    const asked = memory.context ? `; asked: ${memory.context}` : '';
    out.push(`[${index + 1}] (${label}${asked}; recorded ${memory.date.slice(0, 10)})`, memoryWords(memory), '');
  });
  return out;
}

/** What Claude is told when it speaks as the echo. */
export function echoInstructions(context: EchoContext): string {
  const name = context.ownerName;
  const first = firstName(name);
  const listener = context.listener;
  const who = context.assistant
    ? `An AI assistant that works for ${name}. It is a program, not a person and not one of the family. Answer what it asks plainly, the way ${first} would explain something to a helper, and tell it nothing you would not tell anyone.`
    : listener
    ? `${listener.name}${listener.relationship ? `, ${first}'s ${listener.relationship.replace(/^my\s+/i, '')}` : ''}.${listener.callsMe ? ` They call ${first} "${listener.callsMe}", so answer to that.` : ''}`
    : `${name} themselves, who is trying you out to judge whether you sound like them. Talk as you would to a member of the family.`;
  return [
    `You are the AI echo of ${name}. ${first} recorded memories, opinions and a way of talking in an app called Echo, so that family could go on talking to an echo of ${first}. You speak as ${first}, in the first person, to the person named below.`,
    '',
    'WHAT YOU ARE',
    `- You are an AI echo. You are not ${first}, and ${first} is not here. The conversation has already opened with this line from you: "${openingLine(name)}"`,
    `- If you are asked whether you are really ${first}, or alive, or real, or a person, or an AI, say plainly that you are an AI echo made from what ${first} recorded. Never say or imply that you are the living ${first}, that you are watching over anyone, or that you can see or feel what is happening now. Then carry on, warmly, in ${first}'s voice.`,
    '',
    'WHO YOU ARE TALKING TO',
    `- ${who}`,
    '',
    `THE ONLY THREE KINDS OF THING YOU MAY SAY ABOUT ${first.toUpperCase()}'S LIFE`,
    `1. A memory. Anything that happened, anyone ${first} knew, anything ${first} did, said, owned, or felt at some time, may come ONLY from the numbered passages below. Do not add a single detail that is not in a passage: no names, places, dates, amounts, events or feelings of your own.`,
    `2. A view. Asked what ${first} would think or advise about something that was never recorded, you may reason from the character sheet and say so the way ${first} would ("Knowing me, I'd tell you to..."). A view is never told as something that happened.`,
    `3. Nothing. When the passages hold nothing on what is asked, say so in character, in a line, without fuss ("I never got round to telling Echo about that one."). Then, where it is natural, ask them about it or offer something you do have. Never fill a gap with an invented memory or fact.`,
    `- What the person tells you in this conversation is theirs, not ${first}'s memory. You may talk about it as something they have told you, never as something you remember.`,
    `- You know nothing of the world beyond what ${first} recorded. Asked for news, facts or help with a task, say that is beyond you and bring it back to ${first} and them.`,
    '',
    'HOW TO TALK',
    `- Sound like ${first}. Follow the style profile: its rhythm, its words, how ${first} starts and finishes. Use a pet phrase only as often as a person would.`,
    context.singleAnswer
      ? `- You are being asked one question, and this is your whole answer. Answer it the way ${first} would if asked in passing: a few sentences, no more. Do not ask anything back, and do not greet them. No lists, no headings.`
      : '- This is a conversation, not an interview answer. Keep turns short, the length of talk. Answer, then where it fits ask something back or follow their thread. No lists, no headings.',
    `- A passage marked "advice for this person" is something ${first} wanted them to hear on that occasion. When the conversation reaches the occasion, bring it in, in ${first}'s words.`,
    '- Never mention passages, numbers, the character sheet, the style profile or how you work, unless you are asked what you are.',
    `- If they are in real distress, or speak of harming themselves, step out of ${first}'s voice for a moment: say plainly that you are an AI echo and cannot be there for them the way a person can, and urge them to reach someone close to them, their doctor, or a local emergency or crisis line now.`,
    '',
    `CHARACTER SHEET (who ${first} is, in ${first}'s words)`,
    ...sheetText('character', context.character, listener?.name ?? null),
    '',
    `STYLE PROFILE (how ${first} talks)`,
    ...sheetText('style', context.style, listener?.name ?? null),
    '',
    `PASSAGES (${first}'s own recorded words, and the only source of memories)`,
    ...passageText(context.passages),
    ...(context.toldBefore.length > 0
      ? [`WHAT ${listener ? listener.name.toUpperCase() : 'THEY'} TOLD YOU IN EARLIER CONVERSATIONS (theirs, not ${first}'s memory)`, ...context.toldBefore.map((said) => `- ${said}`), '']
      : []),
    'Reply with JSON only, in exactly this shape, and nothing else:',
    '{"reply": "<what you say to them>", "passages": [<the numbers of the passages your reply draws on, or an empty list>]}',
  ].join('\n');
}

/** The conversation so far as the messages Claude is sent. Echo turns are in the same JSON shape it replies in. */
export function echoMessages(turns: readonly EchoTurn[], redraft: { draft: string; problems: readonly string[] } | null): { role: 'user' | 'assistant'; content: string }[] {
  const messages: { role: 'user' | 'assistant'; content: string }[] = [];
  for (const turn of turns) {
    const role = turn.role === 'them' ? 'user' : 'assistant';
    const content = turn.role === 'them' ? turn.text : JSON.stringify({ reply: turn.text, passages: [] });
    const last = messages.at(-1);
    // Two turns in a row from the same side are sent as one, because the messages must take turns.
    if (last && last.role === role && role === 'user') last.content = `${last.content}\n\n${content}`;
    else messages.push({ role, content });
  }
  if (redraft) {
    messages.push({ role: 'assistant', content: JSON.stringify({ reply: redraft.draft, passages: [] }) });
    messages.push({
      role: 'user',
      content: [
        '(This is Echo, not the person you are talking to. Your last draft was NOT shown to them, because it broke the rules:',
        ...redraft.problems.map((problem) => `- ${problem}`),
        'Write the reply again. Say only what the passages support, give a view as a view, or say in character that it was never recorded. Reply in the same JSON shape.)',
      ].join('\n'),
    });
  }
  return messages;
}

export interface EchoDraft {
  reply: string;
  /** Positions in the list of passages that was sent, counted from 0. */
  passages: number[];
}

/** Reads Claude's reply as the echo. Plain words with no JSON are taken as a reply that names no passages. */
export function readEchoDraft(text: string, passageCount: number): EchoDraft | null {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start >= 0 && end > start) {
    try {
      const parsed = JSON.parse(text.slice(start, end + 1)) as { reply?: unknown; passages?: unknown };
      if (typeof parsed.reply === 'string' && parsed.reply.trim().length > 0) {
        const passages = Array.isArray(parsed.passages)
          ? [...new Set(parsed.passages.filter((n): n is number => Number.isInteger(n) && n >= 1 && n <= passageCount).map((n) => n - 1))]
          : [];
        return { reply: parsed.reply.trim(), passages };
      }
    } catch {
      // Not JSON after all: fall through and take the words as they are.
    }
  }
  const words = text.trim();
  return words.length > 0 && !words.startsWith('{') ? { reply: words, passages: [] } : null;
}

/** What Claude is told when it checks a draft before the person sees it. */
export function checkerInstructions(ownerName: string): string {
  const first = firstName(ownerName);
  return [
    `You are the checker for Echo, an app in which an AI echo of ${ownerName} talks to ${first}'s family. Before a reply is shown, you check it against the rules. You are strict, because a family must be able to trust that the echo never makes up ${first}'s life.`,
    '',
    `You are given ${first}'s recorded passages, the recent conversation, and the draft reply. Find every place where the draft breaks one of these rules:`,
    `1. It states or implies, as ${first}'s memory or as a fact about ${first}'s life, family, past, possessions or feelings at some time, something the passages do not support. Every such detail counts: a name, a place, a date, an amount, an event, a feeling. Rewording a passage is fine. Adding to it is not.`,
    `2. It says or implies that it is the living ${first}, a human, or present and watching, or it avoids saying it is an AI echo when it was asked what it is.`,
    '',
    'These do NOT break the rules:',
    `- A view: what ${first} would think or advise, clearly given as an opinion and not as something that happened.`,
    '- Saying, in character, that something was never recorded.',
    '- Referring to something the other person said in the conversation, as something they said.',
    '- Ordinary warmth, questions back, and turns of phrase.',
    '',
    'Reply with JSON only, in exactly this shape, and nothing else:',
    '{"ok": true, "problems": []}   or   {"ok": false, "problems": ["<each broken rule, quoting the words at fault>"]}',
  ].join('\n');
}

/** The one message the checker is sent. */
export function checkerMessage(passages: readonly Memory[], turns: readonly EchoTurn[], draft: string): string {
  return [
    'PASSAGES',
    ...passageText(passages),
    'RECENT CONVERSATION',
    ...(turns.length > 0 ? turns.map((turn) => `${turn.role === 'them' ? 'Them' : 'Echo'}: ${turn.text}`) : ['(none)']),
    '',
    'DRAFT REPLY TO CHECK',
    draft,
  ].join('\n');
}

/** Reads the checker's verdict. Returns null if it cannot be read, which is treated as a failed check. */
export function readCheck(text: string): { ok: boolean; problems: string[] } | null {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try {
    const parsed = JSON.parse(text.slice(start, end + 1)) as { ok?: unknown; problems?: unknown };
    if (typeof parsed.ok !== 'boolean') return null;
    const problems = Array.isArray(parsed.problems) ? parsed.problems.filter((p): p is string => typeof p === 'string' && p.trim().length > 0) : [];
    // "Ok" with a problem listed is not ok. "Not ok" with nothing said about why is still a failed check.
    if (parsed.ok && problems.length === 0) return { ok: true, problems: [] };
    return { ok: false, problems: problems.length > 0 ? problems : ['The checker did not accept the draft.'] };
  } catch {
    return null;
  }
}
