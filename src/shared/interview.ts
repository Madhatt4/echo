// The character interview: an AI interviewer asks about the person's life
// and follows up on what they say. The topics are fixed; the follow-up
// questions are written by Claude from the person's own answers.

import type { Audience, Person } from './people.ts';

export interface InterviewTopic {
  id: string;
  title: string;
  /** The first question, always the same, so a topic can start without the AI. */
  opening: string;
  /** What this part of the interview is trying to draw out. Given to the interviewer. */
  aim: string;
}

export const INTERVIEW_TOPICS: readonly InterviewTopic[] = [
  {
    id: 'childhood',
    title: 'Childhood and family',
    opening: 'Where did you grow up, and who was in the house with you?',
    aim: 'The people and places that formed them, what home felt like, and what they took from their parents.',
  },
  {
    id: 'work',
    title: 'Work',
    opening: 'What have you done for a living, and how did you end up doing it?',
    aim: 'What work has meant to them, what they are good at, what they cannot stand, and the stories they tell about it.',
  },
  {
    id: 'beliefs',
    title: 'Beliefs and values',
    opening: 'What is something you believe that you would not change your mind about?',
    aim: 'What they think is right and wrong, what they respect in people, and where those views came from.',
  },
  {
    id: 'humour',
    title: 'Humour',
    opening: 'What makes you laugh? Give me an example.',
    aim: 'How they joke, who they tease and how, what they find funny, and what they do not.',
  },
  {
    id: 'pride-regret',
    title: 'Pride and regret',
    opening: 'What are you proudest of?',
    aim: 'What they count as their achievements, what they would do differently, and how they have made peace with it or not.',
  },
  {
    id: 'conflict',
    title: 'Handling conflict',
    opening: 'When you fall out with someone, what usually happens next?',
    aim: 'How they argue, apologise, hold a grudge or let it go, and what they do when someone they love is in the wrong.',
  },
  {
    id: 'money',
    title: 'Money',
    opening: 'What did you learn about money growing up, and do you still believe it?',
    aim: 'Their attitude to earning, spending, saving, lending and risk, and the advice they would give about it.',
  },
  {
    id: 'love',
    title: 'Love and marriage',
    opening: 'How did you meet the person you love, and what made you stay?',
    aim: 'What they think makes a relationship work, what they have learned the hard way, and how they show love.',
  },
  {
    id: 'parenting',
    title: 'Family and bringing up children',
    opening: 'What kind of parent, or grown-up in a child\'s life, did you try to be?',
    aim: 'What they wanted to pass on, what they got right and wrong, and what they hope the next generation keeps.',
  },
  {
    id: 'each-person',
    title: 'What you would tell each person',
    opening: 'Think of one person in your family. What do you most want them to know?',
    aim: 'What they would say to each named person in their life, in their own words. Ask about each person in turn.',
  },
  {
    id: 'phrases',
    title: 'Things you always say',
    opening: 'What sayings or phrases do your family tease you for?',
    aim: 'Their stock phrases, greetings, sign-offs, nicknames for people, and the exact words they use.',
  },
  {
    id: 'never',
    title: 'Things you would never say',
    opening: 'What would be out of character for you? Something that, if your family heard it, they would know it was not you.',
    aim: 'The words, opinions and tones that are not theirs, so an echo of them never uses them.',
  },
];

export interface Exchange {
  question: string;
  answer: string;
  answeredAt: string;
  /** True if the answer was spoken and its recording is kept. */
  spoken: boolean;
  /** Who may hear this answer from the echo: everyone, or one named person alone. */
  audience: Audience;
}

export interface TopicProgress {
  id: string;
  title: string;
  /** The question waiting for an answer. Null while the next one is being thought of, or when done. */
  pending: string | null;
  done: boolean;
  exchanges: Exchange[];
}

export interface InterviewState {
  topics: TopicProgress[];
  /** False until a working AI key has been saved in Setup. */
  keyReady: boolean;
}

export const MAX_ANSWER_LENGTH = 20_000;
/** A topic is closed automatically after this many answers, whatever the interviewer says. */
export const MAX_EXCHANGES_PER_TOPIC = 12;

/** What Claude is told about its job as the interviewer. */
export function interviewerInstructions(topic: InterviewTopic, ownerName: string | null, people: readonly Person[]): string {
  const who = ownerName ? ownerName : 'the person you are talking to';
  const known = people.length
    ? people.map((person) => `- ${person.name}${person.relationship ? ` (${person.relationship})` : ''}${person.callsMe ? `, who calls them "${person.callsMe}"` : ''}`).join('\n')
    : '- Nobody has been named yet.';
  return [
    `You are interviewing ${who} for Echo, an app that lets a person record who they are so that, after their death, their family can talk to an AI echo of them. Your only job is to ask questions that draw out who this person is: their memories, opinions, humour and the way they talk. What they say is saved in their own words.`,
    '',
    'How to interview:',
    '- Ask one question at a time. Keep it short and plain, the way a curious friend would ask.',
    '- Follow up on what they actually said. Ask for the particular moment, the names, what was said, how it felt, why it mattered. Do not move on while there is still something concrete to ask about.',
    '- Never tell them what they think or feel, never summarise them back to themselves, and never state or assume a fact about them or their family that they have not told you.',
    '- Do not give advice, opinions or comfort beyond a few natural words. You are here to listen.',
    '- If they seem upset, or would rather not talk about something, accept that at once and ask about something easier within the topic.',
    '- Use their language and match how formal or informal they are.',
    '',
    `This part of the interview is about: ${topic.title}.`,
    `What it should draw out: ${topic.aim}`,
    'Stay within this topic.',
    '',
    'People they have told Echo about:',
    known,
    '',
    'When the topic has been covered in real depth, usually after five to eight good answers, or when they clearly have little more to say, finish.',
    '',
    'Reply with one JSON object and nothing else. To ask a question: {"done": false, "question": "your question"}. To finish the topic: {"done": true, "question": ""}.',
  ].join('\n');
}

export interface InterviewMessage {
  role: 'user' | 'assistant';
  content: string;
}

export const SKIPPED = '(They would rather not answer that one. Ask about something else within the topic.)';

/** The conversation so far, in the form Claude is sent. */
export function interviewMessages(
  exchanges: readonly { question: string; answer: string }[],
  skippedQuestion: string | null,
): InterviewMessage[] {
  const messages: InterviewMessage[] = [{ role: 'user', content: 'Please begin.' }];
  for (const exchange of exchanges) {
    messages.push({ role: 'assistant', content: JSON.stringify({ done: false, question: exchange.question }) });
    messages.push({ role: 'user', content: exchange.answer });
  }
  if (skippedQuestion) {
    messages.push({ role: 'assistant', content: JSON.stringify({ done: false, question: skippedQuestion }) });
    messages.push({ role: 'user', content: SKIPPED });
  }
  return messages;
}

export interface InterviewerReply {
  done: boolean;
  question: string;
}

/**
 * Reads the interviewer's reply. Claude is asked for JSON, but if it answers
 * in plain words they are taken as the next question rather than thrown away.
 */
export function readInterviewerReply(text: string): InterviewerReply | null {
  const trimmed = text.trim();
  if (trimmed.length === 0) return null;
  const start = trimmed.indexOf('{');
  const end = trimmed.lastIndexOf('}');
  if (start !== -1 && end > start) {
    try {
      const parsed = JSON.parse(trimmed.slice(start, end + 1)) as { done?: unknown; question?: unknown };
      const question = typeof parsed.question === 'string' ? parsed.question.trim() : '';
      if (parsed.done === true) return { done: true, question: '' };
      if (question.length > 0) return { done: false, question };
      return null;
    } catch {
      // Not JSON after all: fall through and treat it as plain words.
    }
  }
  return { done: false, question: trimmed };
}
