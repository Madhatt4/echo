// What the person is asked to do when capturing their face and voice. These
// recordings are "masters": they are kept at full quality for making the
// talking avatar and the cloned voice later (sub-project 3). Nothing in
// sub-projects 1 and 2 uses them.

export type CaptureGroup = 'face-photo' | 'face-video' | 'voice';

/** One captured photo, video or voice recording, without its contents. */
export interface Capture {
  id: string;
  group: CaptureGroup;
  /** Which pose or passage this was, by its id below. */
  label: string;
  seconds: number;
  takenAt: string;
}

export interface SelfiePose {
  id: string;
  title: string;
  instruction: string;
}

export const SELFIE_POSES: readonly SelfiePose[] = [
  { id: 'front-neutral', title: 'Straight on, relaxed', instruction: 'Look straight at the camera with a relaxed face and your mouth closed.' },
  { id: 'front-smile', title: 'Straight on, smiling', instruction: 'Look straight at the camera and smile the way you do in a photo you like.' },
  { id: 'front-talking', title: 'Straight on, mid-sentence', instruction: 'Say "hello there" and take the photo while your mouth is open.' },
  { id: 'left', title: 'Turned to your left', instruction: 'Turn your head a little to your left, keeping both eyes visible to the camera.' },
  { id: 'right', title: 'Turned to your right', instruction: 'Turn your head a little to your right, keeping both eyes visible to the camera.' },
  { id: 'up', title: 'Chin up', instruction: 'Lift your chin slightly, still looking at the camera.' },
  { id: 'down', title: 'Chin down', instruction: 'Lower your chin slightly, still looking at the camera.' },
  { id: 'everyday', title: 'As your family sees you', instruction: 'Glasses on or off, hat or no hat: however you usually look at home.' },
];

export interface VideoCue {
  /** Seconds into the recording when this cue starts. */
  at: number;
  cue: string;
}

/** The whole guided video lasts at least this long. */
export const FACE_VIDEO_SECONDS = 120;
/** The recording is stopped automatically at this point. */
export const FACE_VIDEO_MAX_SECONDS = 300;

export const FACE_VIDEO_CUES: readonly VideoCue[] = [
  { at: 0, cue: 'Look at the camera. Sit still, relaxed, mouth closed. Breathe normally.' },
  { at: 15, cue: 'Still looking at the camera, say who you are and where you live.' },
  { at: 35, cue: 'Talk about what you did yesterday, the way you would tell a friend.' },
  { at: 65, cue: 'Tell a short story that makes you smile. Let yourself laugh.' },
  { at: 90, cue: 'Talk about something that annoys you. Let it show.' },
  { at: 105, cue: 'Stop talking. Slowly turn your head to the left, then to the right, then back to the camera.' },
  { at: 115, cue: 'Look at the camera and smile. Hold it until the timer reaches two minutes.' },
  { at: 120, cue: 'That is two minutes. Press Stop when you are ready, or keep talking for a better avatar.' },
];

/** The cue that should be on screen this many seconds into the video. */
export function cueAt(seconds: number): string {
  let current = FACE_VIDEO_CUES[0]!.cue;
  for (const cue of FACE_VIDEO_CUES) if (seconds >= cue.at) current = cue.cue;
  return current;
}

export interface VoicePassage {
  id: string;
  title: string;
  kind: 'read' | 'talk';
  /** For reading: the words to read aloud. For talking: what to talk about. */
  text: string;
}

/** How much clean recorded voice a good clone needs. */
export const VOICE_TARGET_SECONDS = 30 * 60;

export const VOICE_PASSAGES: readonly VoicePassage[] = [
  {
    id: 'read-plain',
    title: 'Read: an ordinary morning',
    kind: 'read',
    text: 'I woke before the alarm this morning, which never happens. The house was quiet, so I made a cup of tea and stood at the back door for a while. The sky was grey but it was not raining yet. Somebody down the road was already cutting a hedge. I thought about the day ahead: a few jobs to finish, one phone call I had been putting off, and nothing after six o\'clock. By the time the kettle had cooled I had more or less talked myself into a good mood.',
  },
  {
    id: 'read-warm',
    title: 'Read: something kind',
    kind: 'read',
    text: 'I want you to know that I am proud of you. Not for anything in particular, although there is plenty. I mean the way you carry on when things are hard, and the way you look after people without making a fuss about it. You do not have to get everything right. Nobody does. Just keep being decent, keep turning up, and ring me when you need to. I will always want to hear from you.',
  },
  {
    id: 'read-firm',
    title: 'Read: laying down the law',
    kind: 'read',
    text: 'No. Absolutely not. We have been through this before and the answer has not changed. I do not care who else is doing it, and I do not care how much it costs. If you want to argue about it, you can argue with me tomorrow when we have both calmed down. Right now you are going to put that down, wash your hands, and come and sit at the table like a civilised person.',
  },
  {
    id: 'read-questions',
    title: 'Read: questions and surprise',
    kind: 'read',
    text: 'Hang on, what did you say? You did what? When was this? And nobody thought to tell me? Well, I never. Are you sure? Really? That is brilliant! Why on earth did you keep it quiet? Come here. Who else knows? Does your mother know? What did she say? I bet she cried. Did she cry? I knew it.',
  },
  {
    id: 'read-numbers',
    title: 'Read: numbers, names and places',
    kind: 'read',
    text: 'The appointment is on Thursday the fourteenth of March at quarter past three. The reference number is seven, zero, four, nine, two, eight. It cost one hundred and thirty-six pounds fifty. We drove from Bedford to York by way of Peterborough, Grantham and Doncaster, about a hundred and forty miles, and stopped twice. Monday, Tuesday, Wednesday, Thursday, Friday, Saturday, Sunday. January, April, August, October, December.',
  },
  {
    id: 'talk-day',
    title: 'Talk: your day',
    kind: 'talk',
    text: 'Talk for a few minutes about what you did today or this week, the way you would on the phone to someone in your family.',
  },
  {
    id: 'talk-opinion',
    title: 'Talk: something you feel strongly about',
    kind: 'talk',
    text: 'Pick something you have opinions about, such as work, football, the news or how to do a job properly, and have a good moan or a good rave.',
  },
  {
    id: 'talk-funny',
    title: 'Talk: a story you like telling',
    kind: 'talk',
    text: 'Tell a story you have told many times, the one that always gets a laugh. Tell it the way you tell it.',
  },
  {
    id: 'talk-advice',
    title: 'Talk: advice',
    kind: 'talk',
    text: 'Imagine someone you love has come to you with a problem. Talk them through it, gently, the way you would in person.',
  },
];
