// The list of stories, kept encrypted inside the archive. Each story's sound
// is a separate encrypted recording; this file holds the words and details.

import { randomUUID } from 'node:crypto';
import path from 'node:path';
import type { Story, StoryDetails } from '../shared/stories.ts';
import { readSealedFile, writeSealedFile } from './sealed.ts';

const STORIES_FILENAME = 'stories.sealed';
const PURPOSE = 'echo/stories/v1';

/** Where one of a story's pictures is kept. */
export interface StoredPicture {
  mediaId: string;
  mimeType: string;
}

/** A story as stored: what the screen sees, plus where its sound and pictures are kept. */
export interface StoredStory extends Omit<Story, 'pictures'> {
  mediaId: string;
  mimeType: string;
  /** Missing on stories saved before pictures could go with one. */
  pictures?: StoredPicture[];
}

/** What the screen sees: no storage details, just how many pictures there are. */
export function storyView({ mediaId: _mediaId, mimeType: _mimeType, pictures, ...story }: StoredStory): Story {
  return { ...story, pictures: pictures?.length ?? 0 };
}

function file(archiveDir: string): string {
  return path.join(archiveDir, STORIES_FILENAME);
}

export function loadStories(archiveDir: string, masterKey: Buffer): StoredStory[] {
  return readSealedFile<{ stories: StoredStory[] }>(file(archiveDir), masterKey, PURPOSE)?.stories ?? [];
}

function saveStories(archiveDir: string, masterKey: Buffer, stories: StoredStory[]): void {
  writeSealedFile(file(archiveDir), masterKey, PURPOSE, { stories });
}

function tidy(details: StoryDetails): StoryDetails {
  return { title: details.title.trim(), prompt: details.prompt.trim(), audience: details.audience, text: details.text };
}

export function addStory(
  archiveDir: string,
  masterKey: Buffer,
  details: StoryDetails,
  recording: { mediaId: string; mimeType: string; seconds: number; recordedAt?: string },
  pictures: readonly StoredPicture[] = [],
): StoredStory {
  const story: StoredStory = {
    id: randomUUID(),
    ...tidy(details),
    recordedAt: recording.recordedAt ?? new Date().toISOString(),
    seconds: Math.round(recording.seconds),
    mediaId: recording.mediaId,
    mimeType: recording.mimeType,
    ...(pictures.length > 0 ? { pictures: pictures.map(({ mediaId, mimeType }) => ({ mediaId, mimeType })) } : {}),
  };
  saveStories(archiveDir, masterKey, [...loadStories(archiveDir, masterKey), story]);
  return story;
}

/** Returns false if there is no such story. */
export function changeStory(archiveDir: string, masterKey: Buffer, id: string, details: StoryDetails): boolean {
  const stories = loadStories(archiveDir, masterKey);
  if (!stories.some((story) => story.id === id)) return false;
  saveStories(archiveDir, masterKey, stories.map((story) => (story.id === id ? { ...story, ...tidy(details) } : story)));
  return true;
}

/** Removes a story from the list and returns it, so its recording can be removed too. */
export function removeStory(archiveDir: string, masterKey: Buffer, id: string): StoredStory | null {
  const stories = loadStories(archiveDir, masterKey);
  const found = stories.find((story) => story.id === id) ?? null;
  if (found) saveStories(archiveDir, masterKey, stories.filter((story) => story.id !== id));
  return found;
}
