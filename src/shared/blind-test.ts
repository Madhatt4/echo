// The blind test: does the echo sound like the person?
//
// The person writes their own answers to 20 questions. The echo answers the
// same 20 without seeing theirs. Each judge is then shown the two answers to
// each question side by side, unlabelled and in a random order, says how much
// each sounds like the person (1 to 5), and picks which one is real.
//
// The person's own answers are never given to the echo and never enter the
// memory store.

import type { CheckOutcome, Listener } from './persona.ts';

export const BLIND_QUESTIONS: readonly string[] = [
  'What would you say to someone who has just had the worst day of their life?',
  'What is a perfect Sunday for you?',
  'What is the best piece of advice anyone ever gave you?',
  'What makes you lose your temper?',
  'What do you think happens when we die?',
  'What would you do with a bit of money you were not expecting?',
  'What is a meal you would never get tired of?',
  'What do you wish you had known at twenty?',
  'How do you know when someone can be trusted?',
  'What is the funniest thing that ever happened to you?',
  'What are you most stubborn about?',
  'What would you tell someone who is scared of making a big change?',
  'What does a good friend do?',
  'What is something most people get wrong?',
  'What is your idea of hard work?',
  'What do you do when you cannot sleep?',
  'What would you never spend money on?',
  'What is the best place you have ever been?',
  'How should someone say sorry properly?',
  'What do you want people to remember about you?',
];

/** The pass bar Marc agreed (decision B). */
export const MAX_REAL_PICKS = 13;
export const MIN_ECHO_AVERAGE = 4;
export const MAX_BLIND_ANSWER_LENGTH = 4_000;

export interface BlindItem {
  question: string;
  /** The person's own answer. Empty until written. */
  mine: string;
  /** The echo's answer. Null until it has answered. */
  echo: string | null;
  echoCheck?: CheckOutcome;
}

export interface Judgement {
  /** Which question, as its position in the test. */
  item: number;
  pickedReal: boolean;
  /** How much the judge said each answer sounds like the person, 1 to 5. */
  echoScore: number;
  realScore: number;
}

export interface JudgeRun {
  /** 'owner', or the person's id. */
  key: string;
  label: string;
  /** The order this judge is shown the questions in. */
  order: number[];
  /** For each question (by position in the test): is the real answer shown on the left? */
  realOnLeft: boolean[];
  judgements: Judgement[];
}

export interface BlindTest {
  id: string;
  startedAt: string;
  items: BlindItem[];
  judges: JudgeRun[];
}

export type BlindStage = 'none' | 'writing' | 'echo' | 'judging';

export function blindStage(test: BlindTest | null): BlindStage {
  if (!test) return 'none';
  if (test.items.some((item) => item.mine.trim().length === 0)) return 'writing';
  if (test.items.some((item) => item.echo === null)) return 'echo';
  return 'judging';
}

/** A new test with nothing answered yet. */
export function newBlindTest(id: string, startedAt: string): BlindTest {
  return { id, startedAt, items: BLIND_QUESTIONS.map((question) => ({ question, mine: '', echo: null })), judges: [] };
}

/** A fresh run for one judge: the questions in a shuffled order, and each pair's sides decided by a coin. */
export function newJudgeRun(key: string, label: string, count: number, random: () => number): JudgeRun {
  const order = Array.from({ length: count }, (_, index) => index);
  for (let i = order.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    const held = order[i] as number;
    order[i] = order[j] as number;
    order[j] = held;
  }
  return { key, label, order, realOnLeft: Array.from({ length: count }, () => random() < 0.5), judgements: [] };
}

/** One pair as a judge sees it. It does not say which answer is which. */
export interface BlindPair {
  number: number;
  of: number;
  question: string;
  left: string;
  right: string;
}

/** The next pair this judge has not judged, or null when they have finished. */
export function nextPair(test: BlindTest, run: JudgeRun): BlindPair | null {
  const position = run.judgements.length;
  const index = run.order[position];
  const item = index === undefined ? undefined : test.items[index];
  if (index === undefined || !item || item.echo === null) return null;
  const realOnLeft = run.realOnLeft[index] === true;
  return { number: position + 1, of: run.order.length, question: item.question, left: realOnLeft ? item.mine : item.echo, right: realOnLeft ? item.echo : item.mine };
}

export interface PairVerdict {
  /** Which side the judge thinks is the real person. */
  pick: 'left' | 'right';
  leftScore: number;
  rightScore: number;
}

export function verdictProblems(verdict: PairVerdict): string[] {
  const problems: string[] = [];
  const score = (n: number) => Number.isInteger(n) && n >= 1 && n <= 5;
  if (!score(verdict.leftScore) || !score(verdict.rightScore)) problems.push('Give each answer a score from 1 to 5.');
  if (verdict.pick !== 'left' && verdict.pick !== 'right') problems.push('Choose which answer you think is the real one.');
  return problems;
}

/** Records a judge's verdict on the pair they are on. Returns the run unchanged if they have finished. */
export function recordVerdict(run: JudgeRun, verdict: PairVerdict): JudgeRun {
  const index = run.order[run.judgements.length];
  if (index === undefined) return run;
  const realOnLeft = run.realOnLeft[index] === true;
  const judgement: Judgement = {
    item: index,
    pickedReal: (verdict.pick === 'left') === realOnLeft,
    realScore: realOnLeft ? verdict.leftScore : verdict.rightScore,
    echoScore: realOnLeft ? verdict.rightScore : verdict.leftScore,
  };
  return { ...run, judgements: [...run.judgements, judgement] };
}

export interface JudgeResult {
  key: string;
  label: string;
  judged: number;
  of: number;
  finished: boolean;
  /** Filled once the judge has finished. */
  pickedReal: number | null;
  echoAverage: number | null;
  realAverage: number | null;
  /** True if this judge picked the real person no more often than the bar allows. */
  withinBar: boolean | null;
}

export interface BlindResult {
  judges: JudgeResult[];
  /** True once the person and at least one other judge have finished. */
  complete: boolean;
  /** The echo's average score across every finished judge. */
  echoAverage: number | null;
  passed: boolean | null;
  /** Every question with both answers labelled and each judge's verdict. Only once the test is complete. */
  breakdown:
    | {
        question: string;
        mine: string;
        echo: string;
        echoCheck: CheckOutcome | null;
        verdicts: { label: string; pickedReal: boolean; echoScore: number; realScore: number }[];
      }[]
    | null;
}

function average(numbers: readonly number[]): number {
  return Math.round((numbers.reduce((sum, n) => sum + n, 0) / numbers.length) * 100) / 100;
}

/**
 * Scores the test against the agreed bar: each judge picks the real person
 * at most 13 times in 20, and the echo's answers average 4 out of 5 or
 * better across the judges. Numbers are held back until a judge has finished,
 * and the labelled answers until the whole test is complete.
 */
export function blindResult(test: BlindTest): BlindResult {
  const judges: JudgeResult[] = test.judges.map((run) => {
    const finished = run.judgements.length >= run.order.length && run.order.length > 0;
    const pickedReal = run.judgements.filter((judgement) => judgement.pickedReal).length;
    return {
      key: run.key,
      label: run.label,
      judged: run.judgements.length,
      of: run.order.length,
      finished,
      pickedReal: finished ? pickedReal : null,
      echoAverage: finished ? average(run.judgements.map((judgement) => judgement.echoScore)) : null,
      realAverage: finished ? average(run.judgements.map((judgement) => judgement.realScore)) : null,
      withinBar: finished ? pickedReal <= Math.round((MAX_REAL_PICKS / 20) * run.order.length) : null,
    };
  });
  const finished = test.judges.filter((run) => run.judgements.length >= run.order.length && run.order.length > 0);
  const complete = finished.some((run) => run.key === 'owner') && finished.some((run) => run.key !== 'owner');
  const scores = finished.flatMap((run) => run.judgements.map((judgement) => judgement.echoScore));
  const echoAverage = scores.length > 0 ? average(scores) : null;
  return {
    judges,
    complete,
    echoAverage,
    passed: complete && echoAverage !== null ? judges.filter((judge) => judge.finished).every((judge) => judge.withinBar) && echoAverage >= MIN_ECHO_AVERAGE : null,
    breakdown: complete
      ? test.items.map((item, index) => ({
          question: item.question,
          mine: item.mine,
          echo: item.echo ?? '',
          echoCheck: item.echoCheck ?? null,
          verdicts: finished.flatMap((run) => {
            const judgement = run.judgements.find((candidate) => candidate.item === index);
            return judgement ? [{ label: run.label, pickedReal: judgement.pickedReal, echoScore: judgement.echoScore, realScore: judgement.realScore }] : [];
          }),
        }))
      : null,
  };
}

/** What the screen is given. It never holds labelled answers while judging is still going on. */
export interface BlindTestView {
  stage: BlindStage;
  /** Why the test cannot run right now. Null when it can. */
  blocked: string | null;
  keyReady: boolean;
  ownerName: string;
  /** The questions with the person's own answers. Only while they are still writing them. */
  writing: { question: string; mine: string }[];
  echoAnswered: number;
  of: number;
  /** Who can judge: the person, and each family member allowed to talk to the echo. */
  possibleJudges: { listener: Listener; label: string }[];
  result: BlindResult | null;
  earlierTests: number;
}
