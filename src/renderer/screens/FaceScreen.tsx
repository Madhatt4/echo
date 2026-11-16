import { useEffect, useState } from 'react';
import { FACE_VIDEO_MAX_SECONDS, FACE_VIDEO_SECONDS, SELFIE_POSES, cueAt } from '../../shared/capture-guides.ts';
import type { Capture } from '../../shared/capture-guides.ts';
import { Problems } from './Problems.tsx';
import { Camera, SavedCapture, clock, length } from './recorders.tsx';
import type { Take } from './recorders.tsx';

function day(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { dateStyle: 'long' });
}

type Doing = { kind: 'nothing' } | { kind: 'photo'; poseId: string } | { kind: 'video' } | { kind: 'video-review'; take: Take; url: string };

export function FaceScreen({ onBack }: { onBack: () => void }) {
  const [captures, setCaptures] = useState<Capture[] | null>(null);
  const [doing, setDoing] = useState<Doing>({ kind: 'nothing' });
  const [problems, setProblems] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  async function refresh() {
    setCaptures(await window.echo.captures.list());
  }

  useEffect(() => {
    void refresh();
  }, []);

  useEffect(
    () => () => {
      if (doing.kind === 'video-review') URL.revokeObjectURL(doing.url);
    },
    [doing],
  );

  if (!captures) return null;

  const photos = captures.filter((capture) => capture.group === 'face-photo');
  const videos = captures.filter((capture) => capture.group === 'face-video');
  const posesDone = new Set(photos.map((photo) => photo.label)).size;

  async function savePhoto(poseId: string, photo: Blob) {
    setBusy(true);
    setProblems([]);
    const result = await window.echo.captures.add('face-photo', poseId, new Uint8Array(await photo.arrayBuffer()), 'image/jpeg', 0);
    setBusy(false);
    if (result.ok) {
      await refresh();
      setDoing({ kind: 'nothing' });
    } else {
      setProblems(result.problems);
    }
  }

  async function keepVideo(take: Take) {
    setBusy(true);
    setProblems([]);
    const result = await window.echo.captures.add('face-video', '', new Uint8Array(await take.blob.arrayBuffer()), take.blob.type || 'video/webm', take.seconds);
    setBusy(false);
    if (result.ok) {
      await refresh();
      setDoing({ kind: 'nothing' });
    } else {
      setProblems(result.problems);
    }
  }

  async function remove(id: string) {
    await window.echo.captures.remove(id);
    await refresh();
  }

  const pose = doing.kind === 'photo' ? SELFIE_POSES.find((candidate) => candidate.id === doing.poseId) : undefined;

  return (
    <div data-screen="face" data-doing={doing.kind} data-photo-count={photos.length} data-video-count={videos.length}>
      <div className="actions back-row">
        <button type="button" className="button-quiet" data-action="back-home" onClick={onBack}>
          Back to home
        </button>
      </div>

      {doing.kind === 'photo' && pose && (
        <section className="panel panel-wide" data-section="take-photo">
          <h2>{pose.title}</h2>
          <Camera mode="photo" onPhoto={(photo) => void savePhoto(pose.id, photo)}>
            {() => (
              <blockquote className="consent-wording">
                {pose.instruction}
                <br />
                Good, even light on your face. Nothing bright behind you.
              </blockquote>
            )}
          </Camera>
          <Problems problems={problems} />
          <div className="actions">
            <button type="button" className="button-quiet" onClick={() => setDoing({ kind: 'nothing' })} disabled={busy}>
              Not now
            </button>
          </div>
        </section>
      )}

      {doing.kind === 'video' && (
        <section className="panel panel-wide" data-section="record-video">
          <h2>The two-minute video</h2>
          <p className="hint">
            One continuous take, at least two minutes. Sit facing the screen in good light, with a
            plain background and nobody else in shot. Follow the instruction beside the picture as
            it changes.
          </p>
          <Camera
            mode="video"
            maxSeconds={FACE_VIDEO_MAX_SECONDS}
            onVideo={(take) => setDoing({ kind: 'video-review', take, url: URL.createObjectURL(take.blob) })}
          >
            {({ recording, seconds }) => (
              <div>
                <p className="video-clock" data-video-clock>
                  {clock(seconds)} <span>of {clock(FACE_VIDEO_SECONDS)}</span>
                </p>
                <blockquote className="consent-wording" data-video-cue>
                  {recording ? cueAt(seconds) : 'Press Start recording when you are settled. The first instruction will appear here.'}
                </blockquote>
              </div>
            )}
          </Camera>
          <div className="actions">
            <button type="button" className="button-quiet" onClick={() => setDoing({ kind: 'nothing' })}>
              Not now
            </button>
          </div>
        </section>
      )}

      {doing.kind === 'video-review' && (
        <section className="panel" data-section="review-video">
          <h2>Watch it back</h2>
          <p>
            {length(doing.take.seconds)} recorded. Check your whole face stays in shot, the light is
            even, and you can be heard.
          </p>
          <video className="consent-video" src={doing.url} controls />
          <Problems problems={problems} />
          <div className="actions">
            <button type="button" className="button" data-action="video-keep" onClick={() => void keepVideo(doing.take)} disabled={busy}>
              {busy ? 'Saving…' : 'Keep this video'}
            </button>
            <button
              type="button"
              className="button-quiet"
              data-action="video-again"
              onClick={() => {
                setProblems([]);
                setDoing({ kind: 'video' });
              }}
              disabled={busy}
            >
              Record it again
            </button>
          </div>
        </section>
      )}

      {doing.kind === 'nothing' && (
        <>
          <section className="panel panel-wide" data-section="photos">
            <h2>Selfies</h2>
            <p>
              Eight photos of your face from different angles. They are kept, encrypted, for making
              your talking avatar later. Nothing uses them until then. {posesDone} of {SELFIE_POSES.length} done.
            </p>
            <ul className="poses">
              {SELFIE_POSES.map((candidate) => {
                const taken = photos.filter((photo) => photo.label === candidate.id);
                const latest = taken[taken.length - 1];
                return (
                  <li key={candidate.id} data-pose={candidate.id} data-pose-done={latest ? 'yes' : 'no'}>
                    {latest ? <SavedCapture id={latest.id} kind="photo" /> : <div className="capture-photo capture-empty" />}
                    <strong>{candidate.title}</strong>
                    <div className="actions">
                      <button type="button" className="button-quiet" data-action="pose-take" onClick={() => setDoing({ kind: 'photo', poseId: candidate.id })}>
                        {latest ? 'Take it again' : 'Take this photo'}
                      </button>
                      {latest && (
                        <button type="button" className="button-quiet" data-action="pose-remove" onClick={() => void remove(latest.id)}>
                          Delete
                        </button>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          </section>

          <section className="panel" data-section="videos">
            <h2>The two-minute video</h2>
            <p>
              A single, continuous video of you talking and moving your head. It is what gives the
              avatar your expressions, so it matters more than the photos.
            </p>
            {videos.map((video) => (
              <div key={video.id} className="saved-item" data-saved-video-item>
                <SavedCapture id={video.id} kind="video" />
                <p className="hint">
                  Recorded {day(video.takenAt)} · {length(video.seconds)}
                </p>
                <div className="actions">
                  <button type="button" className="button-quiet" data-action="video-remove" onClick={() => void remove(video.id)}>
                    Delete this video
                  </button>
                </div>
              </div>
            ))}
            <div className="actions">
              <button type="button" className="button" data-action="video-new" onClick={() => setDoing({ kind: 'video' })}>
                {videos.length > 0 ? 'Record another' : 'Record the video'}
              </button>
            </div>
          </section>
        </>
      )}
    </div>
  );
}
