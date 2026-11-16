// Life stories: the person talking about their life, recorded and written down.

import type { Audience, Person } from './people.ts';

export interface Story {
  id: string;
  title: string;
  /** The question that prompted it, if one was used. */
  prompt: string;
  recordedAt: string;
  seconds: number;
  audience: Audience;
  /** The story in words. Typed or corrected by the person; empty until then. */
  text: string;
  /** How many pictures go with it, shown while the story plays. */
  pictures: number;
}

/** A picture that goes with a story, for example the old photo it is about. */
export interface StoryPicture {
  bytes: Uint8Array;
  mimeType: string;
}

/** What the person can set when recording a story or changing one. */
export interface StoryDetails {
  title: string;
  prompt: string;
  audience: Audience;
  text: string;
}

export const MAX_STORY_MINUTES = 60;
export const MAX_STORY_PICTURES = 12;
export const MAX_PICTURE_BYTES = 25 * 1024 * 1024;

/** Picture kinds every screen that shows a story can display. */
export function isPictureType(mimeType: string): boolean {
  return /^image\/(jpeg|png|webp)$/i.test(mimeType.split(';')[0]!.trim());
}

/** Plain-English problems with the pictures going with a story. An empty list means they are fine. */
export function pictureProblems(pictures: readonly StoryPicture[]): string[] {
  if (pictures.length > MAX_STORY_PICTURES) return [`One story can have up to ${MAX_STORY_PICTURES} pictures. Tell the rest in another story.`];
  for (const picture of pictures) {
    if (!(picture.bytes instanceof Uint8Array) || picture.bytes.length === 0) return ['One of the pictures is empty. Choose it again.'];
    if (picture.bytes.length > MAX_PICTURE_BYTES) return ['One of the pictures is too large. Choose a smaller copy of it.'];
    if (!isPictureType(picture.mimeType)) return ['Echo can keep photos saved as JPEG, PNG or WebP.'];
  }
  return [];
}

/** Plain-English problems with a story's details. An empty list means they are fine. */
export function storyProblems(details: StoryDetails, people: readonly Person[]): string[] {
  const problems: string[] = [];
  if (details.title.trim().length === 0) problems.push('Give the story a short title so you can find it again.');
  if (details.title.trim().length > 120) problems.push('Keep the title to a few words.');
  if (details.text.length > 200_000) problems.push('That is too much text for one story. Split it into parts.');
  if (details.audience.kind === 'person') {
    const personId = details.audience.personId;
    if (!people.some((person) => person.id === personId)) {
      problems.push('The person this story is for is no longer in your list. Choose again.');
    }
  }
  return problems;
}
