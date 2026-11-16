import { useEffect, useRef, useState } from 'react';

/** The desktop refuses a single story longer than this. */
const MAX_SECONDS = 60 * 60;

export interface Recording {
  audio: Uint8Array;
  mimeType: string;
  seconds: number;
  recordedAt: Date;
}

function clock(seconds: number): string {
  return `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`;
}

function bestType(): string {
  for (const type of ['audio/mp4', 'audio/aac', 'audio/webm']) {
    if (typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(type)) return type;
  }
  return '';
}

/** Records one memory, lets the person listen back, and hands it over only when they keep it. */
export function Recorder({ onKeep, onCancel }: { onKeep: (recording: Recording) => Promise<void>; onCancel: () => void }) {
  const [stage, setStage] = useState<'starting' | 'recording' | 'review' | 'saving'>('starting');
  const [seconds, setSeconds] = useState(0);
  const [problem, setProblem] = useState('');
  const [result, setResult] = useState<{ recording: Recording; url: string } | null>(null);
  const recorder = useRef<MediaRecorder | null>(null);
  const started = useRef(0);

  useEffect(() => {
    let stream: MediaStream | null = null;
    let tick: ReturnType<typeof setInterval> | null = null;
    const chunks: Blob[] = [];

    void navigator.mediaDevices
      .getUserMedia({ audio: true })
      .then((opened) => {
        stream = opened;
        const type = bestType();
        const made = new MediaRecorder(opened, type ? { mimeType: type } : undefined);
        made.ondataavailable = (event) => {
          if (event.data.size > 0) chunks.push(event.data);
        };
        made.onstop = async () => {
          if (tick) clearInterval(tick);
          stream?.getTracks().forEach((track) => track.stop());
          const blob = new Blob(chunks, { type: made.mimeType || type || 'audio/mp4' });
          const recording: Recording = {
            audio: new Uint8Array(await blob.arrayBuffer()),
            mimeType: (blob.type || 'audio/mp4').split(';')[0]!,
            seconds: Math.max(1, Math.round((Date.now() - started.current) / 1000)),
            recordedAt: new Date(started.current),
          };
          setResult({ recording, url: URL.createObjectURL(blob) });
          setStage('review');
        };
        recorder.current = made;
        started.current = Date.now();
        made.start(1000);
        setStage('recording');
        tick = setInterval(() => {
          const elapsed = (Date.now() - started.current) / 1000;
          setSeconds(elapsed);
          if (elapsed >= MAX_SECONDS && made.state === 'recording') made.stop();
        }, 250);
      })
      .catch(() => setProblem('Echo needs the microphone to record. Allow it in Settings, Echo, Microphone, then try again.'));

    return () => {
      if (tick) clearInterval(tick);
      if (recorder.current?.state === 'recording') {
        recorder.current.onstop = null;
        recorder.current.stop();
      }
      stream?.getTracks().forEach((track) => track.stop());
    };
  }, []);

  useEffect(() => () => {
    if (result) URL.revokeObjectURL(result.url);
  }, [result]);

  if (problem) {
    return (
      <section className="recorder">
        <p className="problem">{problem}</p>
        <button type="button" className="quiet" onClick={onCancel}>
          Back
        </button>
      </section>
    );
  }

  if (stage === 'review' || stage === 'saving') {
    return (
      <section className="recorder">
        <p>That was {clock(result?.recording.seconds ?? 0)}. Listen back if you like.</p>
        {result && <audio controls src={result.url} />}
        <button
          type="button"
          className="big"
          disabled={stage === 'saving' || !result}
          onClick={async () => {
            if (!result) return;
            setStage('saving');
            await onKeep(result.recording);
          }}
        >
          Keep it
        </button>
        <button type="button" className="quiet" disabled={stage === 'saving'} onClick={onCancel}>
          Throw it away
        </button>
      </section>
    );
  }

  return (
    <section className="recorder">
      <p className="clock" aria-live="off">
        {stage === 'starting' ? 'Getting ready…' : clock(seconds)}
      </p>
      <button type="button" className="big stop" disabled={stage !== 'recording'} onClick={() => recorder.current?.stop()}>
        I&apos;ve finished
      </button>
    </section>
  );
}
