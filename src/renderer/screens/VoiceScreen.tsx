import { useEffect, useState } from 'react';
import { VOICE_PASSAGES, VOICE_TARGET_SECONDS } from '../../shared/capture-guides.ts';
import type { Capture } from '../../shared/capture-guides.ts';
import { Problems } from './Problems.tsx';
import { SavedCapture, SoundRecorder, length } from './recorders.tsx';
import type { Take } from './recorders.tsx';

type Doing = { kind: 'nothing' } | { kind: 'recording'; passageId: string } | { kind: 'review'; passageId: string; take: Take; url: string };

export function VoiceScreen({ onBack }: { onBack: () => void }) {
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
      if (doing.kind === 'review') URL.revokeObjectURL(doing.url);
    },
    [doing],
  );

  if (!captures) return null;

  const samples = captures.filter((capture) => capture.group === 'voice');
  const total = samples.reduce((sum, sample) => sum + sample.seconds, 0);
  const percent = Math.min(100, Math.round((total / VOICE_TARGET_SECONDS) * 100));

  async function keep(passageId: string, take: Take) {
    setBusy(true);
    setProblems([]);
    const result = await window.echo.captures.add('voice', passageId, new Uint8Array(await take.blob.arrayBuffer()), take.blob.type || 'audio/webm', take.seconds);
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

  const passage = doing.kind === 'nothing' ? undefined : VOICE_PASSAGES.find((candidate) => candidate.id === doing.passageId);

  return (
    <div data-screen="voice" data-doing={doing.kind} data-voice-seconds={total} data-voice-count={samples.length}>
      <div className="actions back-row">
        <button type="button" className="button-quiet" data-action="back-home" onClick={onBack}>
          Back to home
        </button>
      </div>

      {doing.kind === 'recording' && passage && (
        <section className="panel panel-wide" data-section="record-voice">
          <h2>{passage.title}</h2>
          <p className="hint">
            {passage.kind === 'read'
              ? 'Read this aloud in your normal voice. Do not perform it. If you stumble, carry on.'
              : 'Talk for two or three minutes. There is no script. The more natural, the better.'}
          </p>
          <blockquote className="consent-wording" data-passage>
            {passage.text}
          </blockquote>
          <SoundRecorder master maxSeconds={15 * 60} onTaken={(take) => setDoing({ kind: 'review', passageId: passage.id, take, url: URL.createObjectURL(take.blob) })} />
          <div className="actions">
            <button type="button" className="button-quiet" onClick={() => setDoing({ kind: 'nothing' })}>
              Not now
            </button>
          </div>
        </section>
      )}

      {doing.kind === 'review' && passage && (
        <section className="panel" data-section="review-voice">
          <h2>Listen back</h2>
          <p>
            {length(doing.take.seconds)} recorded for “{passage.title}”. Keep it if your voice is
            clear and there is no television, traffic or other voices behind it.
          </p>
          <audio className="story-audio" src={doing.url} controls />
          <Problems problems={problems} />
          <div className="actions">
            <button type="button" className="button" data-action="voice-keep" onClick={() => void keep(passage.id, doing.take)} disabled={busy}>
              {busy ? 'Saving…' : 'Keep this recording'}
            </button>
            <button
              type="button"
              className="button-quiet"
              onClick={() => {
                setProblems([]);
                setDoing({ kind: 'recording', passageId: passage.id });
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
          <section className="panel" data-section="voice-meter">
            <h2>Your voice</h2>
            <p>
              A good voice clone needs about thirty minutes of you speaking clearly. Record in a
              quiet room, close to the microphone, a little at a time. These recordings are kept,
              encrypted, for making your cloned voice later. Nothing uses them until then.
            </p>
            <div className="meter" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent}>
              <div className="meter-bar" style={{ width: `${percent}%` }} />
            </div>
            <p className="hint" data-voice-total>
              {length(total)} of 30 minutes recorded ({percent}%).
            </p>
          </section>

          <section className="panel" data-section="passages">
            <h2>Things to record</h2>
            <p className="hint">
              Do them in any order, and do the talking ones more than once. Reading gives the clone
              your clear speech. Talking gives it the way you really sound.
            </p>
            <ul className="people">
              {VOICE_PASSAGES.map((candidate) => {
                const done = samples.filter((sample) => sample.label === candidate.id);
                return (
                  <li key={candidate.id} data-passage-id={candidate.id}>
                    <div className="person-head">
                      <strong>{candidate.title}</strong>
                      <span className="status">
                        {done.length === 0 ? 'Not recorded' : `${done.length} recorded · ${length(done.reduce((sum, sample) => sum + sample.seconds, 0))}`}
                      </span>
                    </div>
                    <div className="actions">
                      <button type="button" className="button-quiet" data-action="voice-record" onClick={() => setDoing({ kind: 'recording', passageId: candidate.id })}>
                        {done.length === 0 ? 'Record this' : 'Record it again'}
                      </button>
                    </div>
                    {done.map((sample) => (
                      <div key={sample.id} className="saved-item" data-voice-sample>
                        <SavedCapture id={sample.id} kind="sound" />
                        <div className="actions">
                          <button type="button" className="button-quiet" data-action="voice-remove" onClick={() => void remove(sample.id)}>
                            Delete this recording
                          </button>
                        </div>
                      </div>
                    ))}
                  </li>
                );
              })}
            </ul>
          </section>
        </>
      )}
    </div>
  );
}
