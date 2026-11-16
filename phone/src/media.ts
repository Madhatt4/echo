// Getting photos and videos ready to keep. Photos are redrawn as JPEG so the
// computer can always show them (an iPhone may hand over HEIC), and redrawing
// also leaves behind the hidden details a photo carries, such as where it was taken.

import type { Picture } from './link.ts';

/** The computer keeps up to this many photos with one memory. */
export const MAX_PHOTOS = 12;
/** Marc's limit for one video from the phone. Longer memories can be told as sound. */
export const MAX_VIDEO_SECONDS = 5 * 60;
/** The whole video has to be held and locked in the phone's memory at once, so keep well clear of the computer's limit. */
export const MAX_VIDEO_BYTES = 150 * 1024 * 1024;

const LONGEST_SIDE = 2560;
const JPEG_QUALITY = 0.85;

/** A photo, redrawn as a JPEG no larger than it needs to be on a screen. */
export async function preparePhoto(file: File): Promise<Picture> {
  // Turned the right way up from the start: phone photos are often stored sideways with a note saying so.
  const image = await createImageBitmap(file, { imageOrientation: 'from-image' });
  try {
    const scale = Math.min(1, LONGEST_SIDE / Math.max(image.width, image.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(image.width * scale));
    canvas.height = Math.max(1, Math.round(image.height * scale));
    const context = canvas.getContext('2d');
    if (!context) throw new Error('No drawing surface.');
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((done) => canvas.toBlob(done, 'image/jpeg', JPEG_QUALITY));
    if (!blob) throw new Error('The photo could not be redrawn.');
    return { bytes: new Uint8Array(await blob.arrayBuffer()), mimeType: 'image/jpeg' };
  } finally {
    image.close();
  }
}

/** How long a video runs, read from the file itself. */
export function videoSeconds(file: File): Promise<number> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const video = document.createElement('video');
    video.preload = 'metadata';
    video.onloadedmetadata = () => {
      URL.revokeObjectURL(url);
      resolve(video.duration);
    };
    video.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('The video could not be read.'));
    };
    video.src = url;
  });
}

/**
 * The kind the computer should play the video as. An iPhone labels its videos
 * QuickTime, but the computer's player only takes them labelled MP4, which
 * they also are inside.
 */
export function videoType(file: File): string {
  const type = file.type.toLowerCase();
  return type === '' || type === 'video/quicktime' ? 'video/mp4' : type;
}
