// Holds the speech-to-text model once it is loaded, so it is loaded only once
// per run of the app, and reports download progress to the screen.

import type { ActionResult } from '../shared/api.ts';
import { loadTranscriber, modelIsDownloaded } from '../core/transcribe.ts';
import type { DownloadProgress, Transcriber } from '../core/transcribe.ts';

export class Transcription {
  private readonly modelDir: string;
  private readonly onProgress: (progress: DownloadProgress) => void;
  private loading: Promise<Transcriber> | null = null;

  constructor(modelDir: string, onProgress: (progress: DownloadProgress) => void) {
    this.modelDir = modelDir;
    this.onProgress = onProgress;
  }

  /** True if the model is already on this computer, so nothing needs downloading. */
  ready(): boolean {
    try {
      return modelIsDownloaded(this.modelDir);
    } catch {
      return false;
    }
  }

  private transcriber(): Promise<Transcriber> {
    if (!this.loading) {
      this.loading = loadTranscriber(this.modelDir, this.onProgress).catch((error) => {
        this.loading = null; // let the next attempt try again from scratch
        throw error;
      });
    }
    return this.loading;
  }

  /** Downloads the model if needed and gets it ready. */
  async prepare(): Promise<ActionResult> {
    const alreadyHere = this.ready();
    try {
      await this.transcriber();
      return { ok: true, problems: [] };
    } catch (error) {
      console.error('speech-to-text could not start:', error);
      return {
        ok: false,
        problems: [
          alreadyHere
            ? 'Echo could not start its speech-to-text. Close Echo, open it again and try once more.'
            : 'Echo could not download its speech-to-text model. Check this computer is online, then try again. Your recording is safe.',
        ],
      };
    }
  }

  /** Turns one part of a recording into words. The words come back in `note`. */
  async transcribe(samples: Float32Array): Promise<ActionResult> {
    try {
      const transcriber = await this.transcriber();
      return { ok: true, problems: [], note: await transcriber.transcribe(samples) };
    } catch (error) {
      console.error('speech-to-text failed:', error);
      return { ok: false, problems: ['Echo could not write this recording down. Your recording is safe. Try again, or type the words yourself.'] };
    }
  }
}
