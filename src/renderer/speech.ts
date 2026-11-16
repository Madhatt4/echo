import { SPEECH_RATE, joinTranscripts, mixToMono, splitAtQuietPoints } from '../shared/audio.ts';

/** Decodes a recording into one channel at the rate the speech-to-text model expects. */
async function decodeForSpeech(recording: Uint8Array): Promise<Float32Array> {
  const context = new AudioContext({ sampleRate: SPEECH_RATE });
  try {
    // decodeAudioData takes ownership of the buffer it is given, so it gets its own copy.
    const decoded = await context.decodeAudioData(new Uint8Array(recording).buffer);
    const channels: Float32Array[] = [];
    for (let channel = 0; channel < decoded.numberOfChannels; channel += 1) channels.push(decoded.getChannelData(channel));
    return mixToMono(channels);
  } finally {
    void context.close().catch(() => undefined);
  }
}

export type WritingDown =
  | { ok: true; text: string }
  | { ok: false; problems: string[] };

/**
 * Writes a recording down. Long recordings are handed over in parts, cut at
 * quiet moments, and `onPart` is told how far it has got.
 */
export async function writeDown(recording: Uint8Array, onPart: (done: number, total: number) => void): Promise<WritingDown> {
  let samples: Float32Array;
  try {
    samples = await decodeForSpeech(recording);
  } catch {
    return { ok: false, problems: ['Echo could not read this recording to write it down. You can still play it and type the words yourself.'] };
  }
  const parts = splitAtQuietPoints(samples);
  const pieces: string[] = [];
  for (const [index, part] of parts.entries()) {
    onPart(index, parts.length);
    // A fresh copy: a view onto part of a larger buffer cannot be sent across on its own.
    const result = await window.echo.transcription.transcribe(new Float32Array(part));
    if (!result.ok) return { ok: false, problems: result.problems };
    pieces.push(result.note ?? '');
  }
  onPart(parts.length, parts.length);
  return { ok: true, text: joinTranscripts(pieces) };
}
