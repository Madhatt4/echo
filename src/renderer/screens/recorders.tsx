// Recording from the microphone and the camera. Used by stories, the face
// masters and the voice masters.

import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { Problems } from './Problems.tsx';

export interface Take {
  blob: Blob;
  seconds: number;
}

export function length(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  const rest = Math.round(seconds % 60);
  return minutes === 0 ? `${rest} seconds` : `${minutes} min ${rest} s`;
}

export function clock(seconds: number): string {
  const whole = Math.max(0, Math.floor(seconds));
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`;
}

/** Turns a camera or microphone failure into something a person can act on. */
export function deviceProblem(error: unknown, what: 'microphone' | 'camera' | 'camera and microphone'): string {
  const name = error instanceof DOMException ? error.name : '';
  const setting = what === 'microphone' ? 'Microphone' : what === 'camera' ? 'Camera' : 'Camera, and then Microphone';
  if (name === 'NotFoundError' || name === 'OverconstrainedError') {
    return `Echo could not find a ${what}. Plug one in, or check the one in the laptop is not switched off, then try again.`;
  }
  if (name === 'NotAllowedError' || name === 'SecurityError') {
    return `Windows is not letting Echo use the ${what}. Open Windows Settings, go to Privacy and security, then ${setting}, and turn on access for desktop apps. Then try again.`;
  }
  if (name === 'NotReadableError' || name === 'AbortError') {
    return `The ${what} is being used by another app. Close any call, camera or recording app, then try again.`;
  }
  return `Echo could not start the ${what}. Check it is plugged in and not in use, then try again.`;
}

function firstSupported(formats: string[]): string {
  return formats.find((type) => MediaRecorder.isTypeSupported(type)) ?? '';
}

/**
 * Records sound from the microphone, with a level bar so the person can see
 * it is hearing them. `master` records the voice as it is, without the
 * clean-up Windows applies to calls, and at a higher quality.
 */
export function SoundRecorder({
  onTaken,
  maxSeconds,
  master = false,
}: {
  onTaken: (take: Take) => void;
  maxSeconds: number;
  master?: boolean;
}) {
  const [live, setLive] = useState(false);
  const [recording, setRecording] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const [level, setLevel] = useState(0);
  const [problems, setProblems] = useState<string[]>([]);

  const stream = useRef<MediaStream | null>(null);
  const recorder = useRef<MediaRecorder | null>(null);
  const pieces = useRef<Blob[]>([]);
  const startedAt = useRef(0);
  const audioContext = useRef<AudioContext | null>(null);

  function stopMicrophone() {
    stream.current?.getTracks().forEach((track) => track.stop());
    stream.current = null;
    void audioContext.current?.close().catch(() => undefined);
    audioContext.current = null;
    setLive(false);
  }

  async function startMicrophone() {
    setProblems([]);
    try {
      const audio: MediaTrackConstraints | boolean = master
        ? { echoCancellation: false, noiseSuppression: false, autoGainControl: false, channelCount: 1 }
        : true;
      stream.current = await navigator.mediaDevices.getUserMedia({ audio });
      setLive(true);
    } catch (error) {
      setProblems([deviceProblem(error, 'microphone')]);
    }
  }

  useEffect(() => {
    void startMicrophone();
    return stopMicrophone;
  }, []);

  // The level bar: how loud the microphone is hearing things right now.
  useEffect(() => {
    if (!live || !stream.current) return;
    let frame = 0;
    try {
      const context = new AudioContext();
      audioContext.current = context;
      const analyser = context.createAnalyser();
      analyser.fftSize = 512;
      context.createMediaStreamSource(stream.current).connect(analyser);
      const samples = new Uint8Array(analyser.fftSize);
      const tick = () => {
        analyser.getByteTimeDomainData(samples);
        let peak = 0;
        for (const sample of samples) peak = Math.max(peak, Math.abs(sample - 128));
        setLevel(Math.min(100, Math.round((peak / 128) * 160)));
        frame = requestAnimationFrame(tick);
      };
      tick();
    } catch {
      // No level bar is not a reason to stop someone recording.
    }
    return () => cancelAnimationFrame(frame);
  }, [live]);

  useEffect(() => {
    if (!recording) return;
    const timer = setInterval(() => {
      const elapsed = Math.floor((Date.now() - startedAt.current) / 1000);
      setSeconds(elapsed);
      if (elapsed >= maxSeconds) recorder.current?.stop();
    }, 250);
    return () => clearInterval(timer);
  }, [recording, maxSeconds]);

  function start() {
    if (!stream.current) return;
    pieces.current = [];
    const format = firstSupported(['audio/webm;codecs=opus', 'audio/webm']);
    const made = new MediaRecorder(stream.current, {
      ...(format ? { mimeType: format } : {}),
      ...(master ? { audioBitsPerSecond: 256_000 } : {}),
    });
    made.ondataavailable = (event) => {
      if (event.data.size > 0) pieces.current.push(event.data);
    };
    made.onstop = () => {
      setRecording(false);
      onTaken({
        blob: new Blob(pieces.current, { type: made.mimeType || 'audio/webm' }),
        seconds: (Date.now() - startedAt.current) / 1000,
      });
    };
    recorder.current = made;
    startedAt.current = Date.now();
    setSeconds(0);
    made.start(1000);
    setRecording(true);
  }

  return (
    <div data-recorder data-microphone={live ? 'live' : 'off'}>
      <div className="level" aria-hidden="true">
        <div className="level-bar" style={{ width: `${level}%` }} />
      </div>
      <p className="hint">
        {live
          ? 'Say something. The bar should move when you speak. If it does not, check your microphone.'
          : 'Starting the microphone…'}
      </p>
      <Problems problems={problems} />
      <div className="actions">
        {!recording ? (
          <button type="button" className="button" data-action="sound-start" onClick={start} disabled={!live}>
            Start recording
          </button>
        ) : (
          <button type="button" className="button button-stop" data-action="sound-stop" onClick={() => recorder.current?.stop()}>
            Stop ({length(seconds)})
          </button>
        )}
        {!live && !recording && (
          <button type="button" className="button-quiet" onClick={() => void startMicrophone()}>
            Try the microphone again
          </button>
        )}
      </div>
    </div>
  );
}

/**
 * The camera, live, at the best quality it offers. Takes still photos, and
 * records video with sound. `children` is drawn beside the picture, and is
 * told how many seconds into a recording it is.
 */
export function Camera({
  mode,
  onPhoto,
  onVideo,
  maxSeconds = 300,
  children,
}: {
  mode: 'photo' | 'video';
  onPhoto?: (photo: Blob) => void;
  onVideo?: (take: Take) => void;
  maxSeconds?: number;
  children?: (state: { recording: boolean; seconds: number }) => ReactNode;
}) {
  const [live, setLive] = useState(false);
  const [recording, setRecording] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const [problems, setProblems] = useState<string[]>([]);

  const preview = useRef<HTMLVideoElement>(null);
  const stream = useRef<MediaStream | null>(null);
  const recorder = useRef<MediaRecorder | null>(null);
  const pieces = useRef<Blob[]>([]);
  const startedAt = useRef(0);

  function stopCamera() {
    stream.current?.getTracks().forEach((track) => track.stop());
    stream.current = null;
    setLive(false);
  }

  async function startCamera() {
    setProblems([]);
    try {
      const media = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: 1920 }, height: { ideal: 1080 }, frameRate: { ideal: 30 } },
        audio: mode === 'video',
      });
      stream.current = media;
      if (preview.current) {
        preview.current.srcObject = media;
        await preview.current.play().catch(() => undefined);
      }
      setLive(true);
    } catch (error) {
      setProblems([deviceProblem(error, mode === 'video' ? 'camera and microphone' : 'camera')]);
    }
  }

  useEffect(() => {
    void startCamera();
    return stopCamera;
  }, []);

  useEffect(() => {
    if (!recording) return;
    const timer = setInterval(() => {
      const elapsed = (Date.now() - startedAt.current) / 1000;
      setSeconds(Math.floor(elapsed));
      if (elapsed >= maxSeconds) recorder.current?.stop();
    }, 250);
    return () => clearInterval(timer);
  }, [recording, maxSeconds]);

  function takePhoto() {
    const video = preview.current;
    if (!video || video.videoWidth === 0) {
      setProblems(['The camera picture is not ready yet. Wait a moment and try again.']);
      return;
    }
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas.getContext('2d')?.drawImage(video, 0, 0);
    canvas.toBlob((photo) => photo && onPhoto?.(photo), 'image/jpeg', 0.95);
  }

  function startVideo() {
    if (!stream.current) return;
    setProblems([]);
    pieces.current = [];
    const format = firstSupported(['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm']);
    const made = new MediaRecorder(stream.current, {
      ...(format ? { mimeType: format } : {}),
      videoBitsPerSecond: 6_000_000,
      audioBitsPerSecond: 192_000,
    });
    made.ondataavailable = (event) => {
      if (event.data.size > 0) pieces.current.push(event.data);
    };
    made.onstop = () => {
      setRecording(false);
      onVideo?.({
        blob: new Blob(pieces.current, { type: made.mimeType || 'video/webm' }),
        seconds: (Date.now() - startedAt.current) / 1000,
      });
    };
    recorder.current = made;
    startedAt.current = Date.now();
    setSeconds(0);
    made.start(1000);
    setRecording(true);
  }

  return (
    <div data-camera={live ? 'live' : 'off'}>
      <div className="consent-stage">
        <video className="consent-video" ref={preview} muted playsInline />
        <div>{children?.({ recording, seconds })}</div>
      </div>
      <Problems problems={problems} />
      <div className="actions">
        {mode === 'photo' && (
          <button type="button" className="button" data-action="photo-take" onClick={takePhoto} disabled={!live}>
            Take the photo
          </button>
        )}
        {mode === 'video' && !recording && (
          <button type="button" className="button" data-action="video-start" onClick={startVideo} disabled={!live}>
            Start recording
          </button>
        )}
        {mode === 'video' && recording && (
          <button type="button" className="button button-stop" data-action="video-stop" onClick={() => recorder.current?.stop()}>
            Stop ({clock(seconds)})
          </button>
        )}
        {!live && !recording && (
          <button type="button" className="button-quiet" onClick={() => void startCamera()}>
            Try the camera again
          </button>
        )}
      </div>
    </div>
  );
}

/** Shows or plays one saved master, decrypted only for as long as it is on screen. */
export function SavedCapture({ id, kind }: { id: string; kind: 'photo' | 'video' | 'sound' }) {
  const [url, setUrl] = useState('');
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let made = '';
    void window.echo.captures.contents(id).then((contents) => {
      if (!contents) return;
      made = URL.createObjectURL(new Blob([new Uint8Array(contents.bytes)], { type: contents.mimeType.split(';')[0] }));
      setUrl(made);
    });
    return () => {
      if (made) URL.revokeObjectURL(made);
    };
  }, [id]);

  if (!url) return null;
  const marks = { 'data-saved-capture': kind, 'data-playback-ready': ready ? 'yes' : undefined };
  if (kind === 'photo') return <img className="capture-photo" src={url} alt="" {...marks} onLoad={() => setReady(true)} />;
  if (kind === 'video') return <video className="consent-video" src={url} controls {...marks} onLoadedMetadata={() => setReady(true)} />;
  return <audio className="story-audio" src={url} controls {...marks} onLoadedMetadata={() => setReady(true)} />;
}
