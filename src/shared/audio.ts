// Helpers for preparing recorded sound for speech-to-text.

/** The sample rate the speech-to-text model expects. */
export const SPEECH_RATE = 16_000;

/** Averages any number of channels into one. */
export function mixToMono(channels: readonly Float32Array[]): Float32Array {
  if (channels.length === 0) return new Float32Array(0);
  if (channels.length === 1) return channels[0]!;
  const mono = new Float32Array(channels[0]!.length);
  for (const channel of channels) {
    for (let i = 0; i < mono.length; i += 1) mono[i]! += channel[i]! / channels.length;
  }
  return mono;
}

/**
 * Cuts a long recording into parts of at most `maxSeconds`, so each can be
 * handed over on its own. Each cut is made at the quietest moment in the last
 * `searchSeconds` of the part, so words are not cut in half.
 */
export function splitAtQuietPoints(
  samples: Float32Array,
  rate: number = SPEECH_RATE,
  maxSeconds = 240,
  searchSeconds = 20,
): Float32Array[] {
  const maxLength = Math.floor(maxSeconds * rate);
  const window = Math.max(1, Math.floor(0.3 * rate));
  const parts: Float32Array[] = [];
  let start = 0;
  while (samples.length - start > maxLength) {
    const latest = start + maxLength;
    const earliest = Math.max(start + window, latest - Math.floor(searchSeconds * rate));
    let quietestAt = latest;
    let quietest = Infinity;
    for (let at = earliest; at + window <= latest; at += window) {
      let energy = 0;
      for (let i = at; i < at + window; i += 1) energy += samples[i]! * samples[i]!;
      if (energy < quietest) {
        quietest = energy;
        quietestAt = at + Math.floor(window / 2);
      }
    }
    parts.push(samples.subarray(start, quietestAt));
    start = quietestAt;
  }
  parts.push(samples.subarray(start));
  return parts;
}

/** Joins the words from several parts into one piece of text. */
export function joinTranscripts(pieces: readonly string[]): string {
  return pieces
    .map((piece) => piece.trim())
    .filter((piece) => piece.length > 0)
    .join(' ');
}
