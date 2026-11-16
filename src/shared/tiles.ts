// The home screen tiles. One per kind of material the person captures, plus
// setup and the chat. Each tile names the build step that switches it on, so
// the home screen always tells the truth about what works yet.

export type TileId =
  | 'setup'
  | 'consent'
  | 'people'
  | 'stories'
  | 'face'
  | 'voice'
  | 'interview'
  | 'advice'
  | 'messages'
  | 'chat';

export interface Tile {
  id: TileId;
  title: string;
  description: string;
  /** Build step (see docs/plan-1-2-build-order.md) that makes this tile work. */
  arrivesAtStep: number;
  /** True once the tile's feature has been built. */
  ready: boolean;
}

export const TILES: readonly Tile[] = [
  {
    id: 'setup',
    title: 'Setup',
    description: 'Your passphrase, recovery kit, AI key and where your archive is kept.',
    arrivesAtStep: 4,
    ready: true,
  },
  {
    id: 'consent',
    title: 'Consent',
    description: 'Record yourself agreeing to an AI echo of you being made. Nothing else can start until this is done.',
    arrivesAtStep: 5,
    ready: true,
  },
  {
    id: 'people',
    title: 'People',
    description: 'The family members who will be able to talk to your echo.',
    arrivesAtStep: 6,
    ready: true,
  },
  {
    id: 'stories',
    title: 'Life stories',
    description: 'Tell your stories out loud, and keep the words alongside the sound.',
    arrivesAtStep: 8,
    ready: true,
  },
  {
    id: 'face',
    title: 'Face',
    description: 'Selfies and a guided two-minute video, kept for your talking avatar later.',
    arrivesAtStep: 9,
    ready: true,
  },
  {
    id: 'voice',
    title: 'Voice',
    description: 'Guided recordings of you speaking, kept for your cloned voice later.',
    arrivesAtStep: 9,
    ready: true,
  },
  {
    id: 'interview',
    title: 'Character interview',
    description: 'An interviewer asks about your life and beliefs, and follows up on what you say.',
    arrivesAtStep: 10,
    ready: true,
  },
  {
    id: 'advice',
    title: 'Advice',
    description: 'Advice for a particular person on a particular occasion.',
    arrivesAtStep: 11,
    ready: true,
  },
  {
    id: 'messages',
    title: 'Messages and letters',
    description: 'Bring in your messages, emails and letters so your echo learns how you talk.',
    arrivesAtStep: 15,
    ready: true,
  },
  {
    id: 'chat',
    title: 'Talk to your echo',
    description: 'Have a written conversation with your echo and judge whether it sounds like you.',
    arrivesAtStep: 13,
    ready: true,
  },
];

/**
 * The label shown on a tile. `progress`, when given, replaces the usual label
 * with something more specific in plain words.
 */
export function statusLabel(tile: Tile, progress?: string): string {
  if (progress) return progress;
  return tile.ready ? 'Ready' : `Arrives at build step ${tile.arrivesAtStep}`;
}

/** The one thing to do next on the way from a new archive to a first conversation with the echo. */
export interface NextStep {
  id: 'consent' | 'consent-again' | 'ai-key' | 'words' | 'talk';
  title: string;
  why: string;
  /** The tile whose screen does it. */
  opens: TileId;
  button: string;
}

/**
 * Works out what a person should do next, from where they have got to. The
 * order is the order things depend on: consent, then the AI key, then some of
 * their own words, then talking to the echo.
 */
export function nextStep(state: { consent: 'none' | 'given' | 'withdrawn'; aiKeySaved: boolean; passages: number }): NextStep {
  if (state.consent === 'none') {
    return {
      id: 'consent',
      title: 'Start here: record your consent',
      why: 'Only you can make your echo. Echo captures nothing until you have recorded yourself agreeing to it.',
      opens: 'consent',
      button: 'Record my consent',
    };
  }
  if (state.consent === 'withdrawn') {
    return {
      id: 'consent-again',
      title: 'You have withdrawn your consent',
      why: 'Echo will not capture anything, or speak as you, unless you give your consent again. You can still take a copy of your archive or delete it in Setup.',
      opens: 'consent',
      button: 'Open Consent',
    };
  }
  if (!state.aiKeySaved) {
    return {
      id: 'ai-key',
      title: 'Next: add your AI key',
      why: 'The interviewer and your echo both use an AI service that you pay for directly. Setup explains how to get a key and what it costs.',
      opens: 'setup',
      button: 'Open Setup',
    };
  }
  if (state.passages === 0) {
    return {
      id: 'words',
      title: 'Next: give your echo something to speak from',
      why: 'Your echo only ever answers from what you have told it. The interview is the quickest way to start: answer a few questions, typed or spoken.',
      opens: 'interview',
      button: 'Start the interview',
    };
  }
  return {
    id: 'talk',
    title: 'Your echo is ready to talk',
    why: 'Try it as yourself first. The more you tell it, in stories, the interview, advice and your own messages, the more it has to answer from. Then add the people who will talk to it.',
    opens: 'chat',
    button: 'Talk to my echo',
  };
}
