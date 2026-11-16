// Speech-to-text on this computer.
//
// Sound is turned into words by a Whisper model running locally. The model is
// downloaded once from Hugging Face and kept on disk. Recordings are never
// sent anywhere: the only thing that crosses the network is the model coming in.

import { existsSync, readdirSync } from 'node:fs';
import path from 'node:path';

/** English-only Whisper "base", in its smaller 8-bit form. */
export const SPEECH_MODEL = 'Xenova/whisper-base.en';

export interface DownloadProgress {
  /** 0 to 100 across all of the model's files. */
  percent: number;
  loadedBytes: number;
  totalBytes: number;
}

export interface Transcriber {
  /** Turns sound (one channel, 16,000 samples a second) into words. */
  transcribe(samples: Float32Array): Promise<string>;
}

/** True if the model has already been downloaded into `modelDir`. */
export function modelIsDownloaded(modelDir: string): boolean {
  const folder = path.join(modelDir, ...SPEECH_MODEL.split('/'));
  if (!existsSync(folder)) return false;
  return readdirSync(folder, { recursive: true }).some((name) => String(name).endsWith('.onnx'));
}

interface ProgressEvent {
  status?: string;
  file?: string;
  loaded?: number;
  total?: number;
}

type SpeechPipeline = (samples: Float32Array, options: Record<string, unknown>) => Promise<{ text?: string } | { text?: string }[]>;

/**
 * Gets the model ready, downloading it first if it is not on disk yet.
 * Throws if it has to be downloaded and the computer is offline.
 */
export async function loadTranscriber(modelDir: string, onProgress?: (progress: DownloadProgress) => void): Promise<Transcriber> {
  const { pipeline, env } = await import('@huggingface/transformers');
  env.cacheDir = modelDir;
  env.allowRemoteModels = true;

  const files = new Map<string, { loaded: number; total: number }>();
  const report = (event: ProgressEvent) => {
    if (!onProgress || event.status !== 'progress' || !event.file) return;
    files.set(event.file, { loaded: event.loaded ?? 0, total: event.total ?? 0 });
    let loadedBytes = 0;
    let totalBytes = 0;
    for (const file of files.values()) {
      loadedBytes += file.loaded;
      totalBytes += file.total;
    }
    onProgress({ percent: totalBytes > 0 ? Math.min(100, Math.round((loadedBytes / totalBytes) * 100)) : 0, loadedBytes, totalBytes });
  };

  const speech = (await pipeline('automatic-speech-recognition', SPEECH_MODEL, {
    dtype: 'q8',
    progress_callback: report,
  })) as unknown as SpeechPipeline;

  return {
    async transcribe(samples: Float32Array): Promise<string> {
      if (samples.length === 0) return '';
      const result = await speech(samples, { chunk_length_s: 30, stride_length_s: 5 });
      const text = Array.isArray(result) ? result.map((part) => part.text ?? '').join(' ') : (result.text ?? '');
      return text.trim();
    },
  };
}
