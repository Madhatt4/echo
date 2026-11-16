// The memory prompts: questions about single moments in a life, grouped by
// stage. Some name someone from the person's own list ("How did you meet
// Julie?"), chosen by the relationship they typed for that person.
//
// A prompt is only ever a suggestion. The person can ignore it and say
// whatever they like.

import type { Person } from './people.ts';

/** Which people a named prompt is asked about. */
export type PromptAbout = 'partner' | 'child' | 'friend' | 'anyone';

export interface PromptTemplate {
  /** Plain text, or text with `{name}` where a person's name goes. */
  text: string;
  /** Present only on prompts that name someone. */
  about?: PromptAbout;
}

export interface PromptStage {
  stage: string;
  prompts: readonly PromptTemplate[];
}

/** A prompt ready to show, with any name filled in. */
export interface StoryPrompt {
  stage: string;
  text: string;
}

export interface StoryPromptGroup {
  stage: string;
  prompts: string[];
}

const q = (text: string): PromptTemplate => ({ text });
const about = (who: PromptAbout, text: string): PromptTemplate => ({ text, about: who });

export const PROMPT_STAGES: readonly PromptStage[] = [
  {
    stage: 'Childhood',
    prompts: [
      q('What is the earliest thing you remember?'),
      q('What was the house you grew up in like? Walk me through the front door.'),
      q('Who looked after you, and what were they like?'),
      q('Do you remember your first day at school?'),
      q('Who taught you to ride a bike, and how did it go?'),
      q('What did you play, and where, when you were small?'),
      q('What did Christmas or birthdays look like in your house?'),
      q('What was your favourite meal growing up, and who made it?'),
      q('Did you have a pet? Tell me about it.'),
      q('What got you told off as a child?'),
    ],
  },
  {
    stage: 'Growing up',
    prompts: [
      q('Who was your best friend, and what did you get up to?'),
      q('What was your first night out like?'),
      q('What music did you love as a teenager, and where did you listen to it?'),
      q('What got you into trouble as a teenager?'),
      q('Who was your first crush?'),
      q('What was your first kiss like?'),
      q('Which teacher do you still remember, and why?'),
      q('What did you think your life was going to be?'),
      q('What did you wear to look the part back then?'),
      q('What was the first thing you bought with your own money?'),
    ],
  },
  {
    stage: 'Getting going',
    prompts: [
      q('How did you learn to drive? Who sat next to you?'),
      q('What was your first car, and what happened to it?'),
      q('What was your first job, and what did it teach you?'),
      q('What was it like leaving home for the first time?'),
      q('Where was the first place that was really yours?'),
      q('What was your first holiday without your parents?'),
      q('Tell the story of your worst day at work.'),
      q('What work are you proudest of?'),
      q('Who gave you a chance when you needed one?'),
      q('What did a normal week look like when you were twenty-five?'),
    ],
  },
  {
    stage: 'Love',
    prompts: [
      about('partner', 'How did you meet {name}?'),
      about('partner', 'What was your first date with {name}?'),
      about('partner', 'What made you sure about {name}?'),
      q('Tell me about your wedding day, or the day you knew it was for keeps.'),
      q('Who was the one that got away?'),
      q('Tell me about a love you lost.'),
      q('What is the most romantic thing anyone has done for you?'),
      q('What did you learn about love the hard way?'),
    ],
  },
  {
    stage: 'Family',
    prompts: [
      about('child', 'What do you remember about the day {name} was born?'),
      about('child', 'What was {name} like as a little one?'),
      about('child', 'What is a story about {name} that always gets told?'),
      q('What is a family story that always gets told?'),
      q('What did your family do on Sundays?'),
      q('What was the best holiday you ever had together?'),
      q('What did your parents get right, and what did they get wrong?'),
      q('Who in the family are you most like?'),
    ],
  },
  {
    stage: 'Friends',
    prompts: [
      about('friend', 'How did you meet {name}?'),
      about('friend', 'What is the funniest thing you and {name} have done?'),
      q('Who is the friend you could ring at three in the morning?'),
      q('Which friend do you miss most?'),
    ],
  },
  {
    stage: 'The people in your life',
    prompts: [
      about('anyone', 'What do you want {name} to know about you?'),
      about('anyone', 'What is your favourite memory of {name}?'),
    ],
  },
  {
    stage: 'Times and places',
    prompts: [
      q('What was the best day of your life?'),
      q('Where were you when you heard news you will never forget?'),
      q('What was your first holiday abroad like?'),
      q('Where did you go dancing, and who with?'),
      q('Which song takes you straight back, and to where?'),
      q('Who was the funniest person you have ever known?'),
      q('What has changed most in your lifetime?'),
      q('What job did you secretly want to do?'),
      q('What was your proudest moment as a parent?'),
    ],
  },
  {
    stage: 'Hard times',
    prompts: [
      q('What was the hardest thing you have been through, and how did you get through it?'),
      q('Who have you lost, and what do you remember most about them?'),
      q('When were you most afraid?'),
      q('What do you regret?'),
      q('When did someone let you down, and what did you do?'),
    ],
  },
  {
    stage: 'What I have learned',
    prompts: [
      q('What do you know now that you wish you had known at twenty?'),
      q('What do you believe that most people around you do not?'),
      q('What makes a good life?'),
      q('What would you like to be remembered for?'),
      q('What should the family never forget?'),
    ],
  },
];

const PARTNER = /\b(wife|husband|partner|girlfriend|boyfriend|fianc[eé]e?|spouse|other half)\b/i;
const CHILD = /\b(son|daughter|child|kid|boy|girl|stepson|stepdaughter)\b/i;
const FRIEND = /\b(friend|mate|pal|neighbour)\b/i;

/** What kind of person this is to the owner, from the relationship they typed. */
export function relationshipKind(relationship: string): Exclude<PromptAbout, 'anyone'> | 'other' {
  if (PARTNER.test(relationship)) return 'partner';
  if (/\bgrand(son|daughter|child|kid)/i.test(relationship)) return 'other';
  if (CHILD.test(relationship)) return 'child';
  if (FRIEND.test(relationship)) return 'friend';
  return 'other';
}

function fits(template: PromptTemplate, person: Person): boolean {
  if (template.about === 'anyone') return true;
  return relationshipKind(person.relationship) === template.about;
}

/**
 * The prompts for this person's life, stage by stage, with named prompts
 * filled in once for each person they fit. A named prompt nobody fits is left out.
 */
export function promptsFor(people: readonly Person[]): StoryPromptGroup[] {
  const named = people.filter((person) => person.name.trim().length > 0);
  return PROMPT_STAGES.map((stage) => ({
    stage: stage.stage,
    prompts: stage.prompts.flatMap((template) =>
      template.about === undefined
        ? [template.text]
        : named.filter((person) => fits(template, person)).map((person) => template.text.replace('{name}', person.name.trim())),
    ),
  })).filter((group) => group.prompts.length > 0);
}

/**
 * The prompt to suggest next: the first one not yet answered, taking one
 * stage at a time in turn so a run of sessions moves through a whole life.
 * `asked` is the prompts already used. `turn` moves the suggestion on when
 * the person asks for another. Null when every prompt has been answered.
 */
export function suggestPrompt(groups: readonly StoryPromptGroup[], asked: readonly string[], turn = 0): StoryPrompt | null {
  const used = new Set(asked.map((prompt) => prompt.trim()));
  const open = groups.map((group) => ({ stage: group.stage, prompts: group.prompts.filter((prompt) => !used.has(prompt)) }));
  const order: StoryPrompt[] = [];
  const longest = Math.max(0, ...open.map((group) => group.prompts.length));
  for (let round = 0; round < longest; round += 1) {
    for (const group of open) {
      const prompt = group.prompts[round];
      if (prompt !== undefined) order.push({ stage: group.stage, text: prompt });
    }
  }
  if (order.length === 0) return null;
  return order[((turn % order.length) + order.length) % order.length]!;
}
