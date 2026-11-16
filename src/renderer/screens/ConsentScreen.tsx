import { useEffect, useRef, useState } from 'react';
import type { ConsentStatus } from '../../shared/api.ts';
import { Problems } from './Problems.tsx';

type Stage = 'intro' | 'recording';

function when(iso: string): string {
  return new Date(iso).toLocaleString(undefined, { dateStyle: 'long', timeStyle: 'short' });
}

/** Turns a camera or microphone failure into something a person can act on. */
function cameraProblem(error: unknown): string {
  const name = error instanceof DOMException ? error.name : '';
  if (name === 'NotFoundError' || name === 'OverconstrainedError') {
    return 'Echo could not find a camera and microphone. Plug in a webcam, or check the laptop camera is not switched off, then try again.';
  }
  if (name === 'NotAllowedError' || name === 'SecurityError') {
    return 'Windows is not letting Echo use the camera or microphone. Open Windows Settings, go to Privacy and security, then Camera, and turn on "Let desktop apps access your camera". Do the same under Microphone. Then try again.';
  }
  if (name === 'NotReadableError' || name === 'AbortError') {
    return 'The camera or microphone is being used by another app. Close any video call or camera app, then try again.';
  }
  return 'Echo could not start the camera and microphone. Check they are plugged in and not in use, then try again.';
}

function pickFormat(): string {
  const wanted = ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm'];
  return wanted.find((type) => MediaRecorder.isTypeSupported(type)) ?? '';
}

/** Plays the saved consent recording, decrypted only for as long as it is on screen. */
function SavedRecording() {
  const [url, setUrl] = useState('');
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let made = '';
    void window.echo.consent.video().then((video) => {
      if (!video) return;
      // Copy into a fresh buffer: the bytes arrive across the bridge.
      made = URL.createObjectURL(new Blob([new Uint8Array(video.bytes)], { type: video.mimeType.split(';')[0] }));
      setUrl(made);
    });
    return () => {
      if (made) URL.revokeObjectURL(made);
    };
  }, []);

  if (!url) return null;
  return (
    <video
      className="consent-video"
      src={url}
      controls
      data-saved-video
      data-playback-ready={ready ? 'yes' : undefined}
      onLoadedMetadata={() => setReady(true)}
    />
  );
}

function Recorder({
  fullName,
  wording,
  onSaved,
  onCancel,
}: {
  fullName: string;
  wording: string;
  onSaved: () => Promise<void>;
  onCancel: () => void;
}) {
  const [stage, setStage] = useState<'record' | 'review'>('record');
  const [live, setLive] = useState(false);
  const [recording, setRecording] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const [problems, setProblems] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [reviewUrl, setReviewUrl] = useState('');

  const preview = useRef<HTMLVideoElement>(null);
  const stream = useRef<MediaStream | null>(null);
  const recorder = useRef<MediaRecorder | null>(null);
  const pieces = useRef<Blob[]>([]);
  const startedAt = useRef(0);
  const taken = useRef<{ blob: Blob; seconds: number } | null>(null);

  function stopCamera() {
    stream.current?.getTracks().forEach((track) => track.stop());
    stream.current = null;
    setLive(false);
  }

  async function startCamera() {
    setProblems([]);
    try {
      const media = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
      stream.current = media;
      if (preview.current) {
        preview.current.srcObject = media;
        await preview.current.play().catch(() => undefined);
      }
      setLive(true);
    } catch (error) {
      setProblems([cameraProblem(error)]);
    }
  }

  useEffect(() => {
    if (stage === 'record') void startCamera();
    return stopCamera;
    // The camera starts when the recording stage opens and stops when it closes.
  }, [stage]);

  useEffect(() => {
    if (!recording) return;
    const timer = setInterval(() => setSeconds(Math.floor((Date.now() - startedAt.current) / 1000)), 250);
    return () => clearInterval(timer);
  }, [recording]);

  useEffect(
    () => () => {
      if (reviewUrl) URL.revokeObjectURL(reviewUrl);
    },
    [reviewUrl],
  );

  function startRecording() {
    if (!stream.current) return;
    setProblems([]);
    pieces.current = [];
    const format = pickFormat();
    const made = new MediaRecorder(stream.current, format ? { mimeType: format } : undefined);
    made.ondataavailable = (event) => {
      if (event.data.size > 0) pieces.current.push(event.data);
    };
    made.onstop = () => {
      const length = (Date.now() - startedAt.current) / 1000;
      const blob = new Blob(pieces.current, { type: made.mimeType || 'video/webm' });
      taken.current = { blob, seconds: length };
      setReviewUrl(URL.createObjectURL(blob));
      setRecording(false);
      setStage('review');
    };
    recorder.current = made;
    startedAt.current = Date.now();
    setSeconds(0);
    made.start(1000);
    setRecording(true);
  }

  function stopRecording() {
    recorder.current?.stop();
  }

  function again() {
    taken.current = null;
    setReviewUrl('');
    setProblems([]);
    setStage('record');
  }

  async function keep() {
    if (!taken.current) return;
    setBusy(true);
    setProblems([]);
    const bytes = new Uint8Array(await taken.current.blob.arrayBuffer());
    const result = await window.echo.consent.give(fullName, bytes, taken.current.blob.type || 'video/webm', taken.current.seconds);
    setBusy(false);
    if (result.ok) await onSaved();
    else setProblems(result.problems);
  }

  if (stage === 'review') {
    return (
      <section className="panel" data-screen="consent" data-stage="review">
        <h2>Watch it back</h2>
        <p>Check you can be seen and heard clearly, and that you read the whole statement.</p>
        <video className="consent-video" src={reviewUrl} controls data-review-video />
        <Problems problems={problems} />
        <div className="actions">
          <button type="button" className="button" data-action="consent-keep" onClick={keep} disabled={busy}>
            {busy ? 'Saving…' : 'Keep this recording'}
          </button>
          <button type="button" className="button-quiet" data-action="consent-again" onClick={again} disabled={busy}>
            Record it again
          </button>
        </div>
      </section>
    );
  }

  return (
    <section className="panel panel-wide" data-screen="consent" data-stage="record" data-camera={live ? 'live' : 'off'}>
      <h2>Read this aloud to the camera</h2>
      <p className="hint">
        Sit facing the screen in good light. Press Start, read the statement at your own pace, then
        press Stop. It takes about twenty seconds.
      </p>
      <div className="consent-stage">
        <video className="consent-video" ref={preview} muted playsInline data-preview />
        <blockquote className="consent-wording" data-wording>
          {wording}
        </blockquote>
      </div>
      <Problems problems={problems} />
      <div className="actions">
        {!recording ? (
          <button type="button" className="button" data-action="consent-start" onClick={startRecording} disabled={!live}>
            Start recording
          </button>
        ) : (
          <button type="button" className="button button-stop" data-action="consent-stop" onClick={stopRecording}>
            Stop ({seconds}s)
          </button>
        )}
        {!live && !recording && (
          <button type="button" className="button-quiet" onClick={() => void startCamera()}>
            Try the camera again
          </button>
        )}
        {!recording && (
          <button type="button" className="button-quiet" onClick={onCancel}>
            Not now
          </button>
        )}
      </div>
    </section>
  );
}

export function ConsentScreen({ onBack }: { onBack: () => void }) {
  const [status, setStatus] = useState<ConsentStatus | null>(null);
  const [stage, setStage] = useState<Stage>('intro');
  const [fullName, setFullName] = useState('');
  const [wording, setWording] = useState('');
  const [problems, setProblems] = useState<string[]>([]);
  const [confirmWithdraw, setConfirmWithdraw] = useState(false);

  async function refresh() {
    const latest = await window.echo.consent.status();
    setStatus(latest);
    if (latest.fullName) setFullName(latest.fullName);
  }

  useEffect(() => {
    void refresh();
  }, []);

  async function begin() {
    if (fullName.trim().length < 2) {
      setProblems(['Type your full name, as you would sign it.']);
      return;
    }
    setProblems([]);
    setWording(await window.echo.consent.wording(fullName));
    setStage('recording');
  }

  async function withdraw() {
    await window.echo.consent.withdraw();
    setConfirmWithdraw(false);
    await refresh();
  }

  if (!status) return null;

  if (stage !== 'intro') {
    return (
      <Recorder
        fullName={fullName}
        wording={wording}
        onSaved={async () => {
          setStage('intro');
          await refresh();
        }}
        onCancel={() => setStage('intro')}
      />
    );
  }

  return (
    <div data-screen="consent" data-stage="intro" data-consent={status.state}>
      <div className="actions back-row">
        <button type="button" className="button-quiet" data-action="back-home" onClick={onBack}>
          Back to home
        </button>
      </div>

      {status.state === 'given' && (
        <section className="panel">
          <h2>Your consent is recorded</h2>
          <p>
            {status.fullName} gave consent on {status.givenAt ? when(status.givenAt) : ''}. Echo may
            now capture your face, voice and personality.
          </p>
          <SavedRecording />
          <blockquote className="consent-wording">{status.wording}</blockquote>
        </section>
      )}

      {status.state === 'withdrawn' && (
        <section className="panel">
          <h2>You have withdrawn your consent</h2>
          <p className="warning" data-consent-withdrawn>
            Consent was withdrawn on {status.withdrawnAt ? when(status.withdrawnAt) : ''}. Echo will
            not capture anything, and what is already in your archive stays locked away untouched.
            You can take a copy of it, or delete it, in Setup.
          </p>
        </section>
      )}

      {status.state !== 'given' && (
        <section className="panel">
          <h2>{status.state === 'withdrawn' ? 'Give your consent again' : 'Record your consent'}</h2>
          <p>
            Only you can create your echo. Before Echo captures anything, you record yourself
            reading a short statement that says you agree to your face, voice and personality being
            used to make an AI echo of you. The recording is kept, encrypted, in your archive.
          </p>
          <div className="field">
            <label className="label" htmlFor="consent-name">
              Your full name
            </label>
            <p className="hint">It becomes the first words of the statement.</p>
            <input
              id="consent-name"
              type="text"
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              autoComplete="name"
              spellCheck={false}
            />
          </div>
          <Problems problems={problems} />
          <div className="actions">
            <button type="button" className="button" data-action="consent-begin" onClick={begin}>
              Continue to the camera
            </button>
          </div>
        </section>
      )}

      {status.state === 'given' && (
        <section className="panel" data-section="withdraw">
          <h2>Withdraw your consent</h2>
          <p>
            You can withdraw at any time. Echo stops capturing straight away. Nothing is deleted:
            what you have already captured stays encrypted in your archive, unused. You can give
            consent again later by recording a new statement.
          </p>
          {confirmWithdraw ? (
            <div className="actions">
              <button type="button" className="button button-stop" data-action="consent-withdraw-confirm" onClick={withdraw}>
                Yes, withdraw my consent
              </button>
              <button type="button" className="button-quiet" onClick={() => setConfirmWithdraw(false)}>
                Keep my consent
              </button>
            </div>
          ) : (
            <div className="actions">
              <button type="button" className="button-quiet" data-action="consent-withdraw" onClick={() => setConfirmWithdraw(true)}>
                Withdraw my consent
              </button>
            </div>
          )}
        </section>
      )}
    </div>
  );
}
