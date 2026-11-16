// A box for words that can be typed or spoken. Spoken words are written down
// on this computer and put in the box to be corrected; the recording is
// handed back so it can be kept with the words.

import { useEffect, useState } from 'react';
import { writeDown } from '../speech.ts';
import { Problems } from './Problems.tsx';
import { SoundRecorder } from './recorders.tsx';
import type { Take } from './recorders.tsx';

type Speaking =
  | { stage: 'off' }
  | { stage: 'recording' }
  | { stage: 'ask-download'; take: Take }
  | { stage: 'preparing' }
  | { stage: 'listening'; done: number; total: number };

export function SpeakOrType({
  id,
  label,
  hint,
  rows = 7,
  value,
  onChange,
  take,
  onTake,
  talkLabel,
  canTalk = true,
  disabled = false,
  onBusy,
}: {
  id: string;
  label: string;
  hint: string;
  rows?: number;
  value: string;
  onChange: (value: string) => void;
  /** The recording kept with these words, if they were spoken. */
  take: Take | null;
  onTake: (take: Take) => void;
  talkLabel: string;
  /** False where the words can only be typed, such as when changing something already saved. */
  canTalk?: boolean;
  disabled?: boolean;
  /** Told when recording or writing down starts and stops, so the screen can hold its other buttons. */
  onBusy?: (busy: boolean) => void;
}) {
  const [speaking, setSpeaking] = useState<Speaking>({ stage: 'off' });
  const [problems, setProblems] = useState<string[]>([]);

  useEffect(() => {
    onBusy?.(speaking.stage !== 'off');
  }, [speaking.stage]);

  /** Writes what was said into the box. `download` is true once the one-off download is agreed. */
  async function hear(heard: Take, download: boolean) {
    setProblems([]);
    if (!download && !(await window.echo.transcription.ready())) {
      setSpeaking({ stage: 'ask-download', take: heard });
      return;
    }
    setSpeaking({ stage: 'preparing' });
    const prepared = await window.echo.transcription.prepare();
    if (!prepared.ok) {
      setSpeaking({ stage: 'off' });
      setProblems(prepared.problems);
      return;
    }
    setSpeaking({ stage: 'listening', done: 0, total: 1 });
    const written = await writeDown(new Uint8Array(await heard.blob.arrayBuffer()), (done, total) => setSpeaking({ stage: 'listening', done, total }));
    setSpeaking({ stage: 'off' });
    if (!written.ok) {
      setProblems(written.problems);
      return;
    }
    if (written.text.length === 0) {
      setProblems(['Echo did not hear any words in that. Try again closer to the microphone, or type it.']);
      return;
    }
    // Saying it again replaces what was said before. Words that were typed are kept, with the spoken ones after them.
    onChange(take === null && value.trim().length > 0 ? `${value.trim()} ${written.text}` : written.text);
    onTake(heard);
  }

  return (
    <div data-speak-or-type data-speaking={speaking.stage}>
      {speaking.stage === 'recording' ? (
        <div className="field">
          <span className="label">{label}</span>
          <SoundRecorder maxSeconds={20 * 60} onTaken={(heard) => void hear(heard, false)} />
          <div className="actions">
            <button type="button" className="button-quiet" onClick={() => setSpeaking({ stage: 'off' })}>
              Type it instead
            </button>
          </div>
        </div>
      ) : (
        <div className="field">
          <label className="label" htmlFor={id}>
            {label}
          </label>
          <p className="hint">{hint}</p>
          <textarea
            id={id}
            rows={rows}
            value={value}
            onChange={(event) => onChange(event.target.value)}
            disabled={disabled || speaking.stage !== 'off'}
            data-spoken={take ? 'yes' : undefined}
          />
          {take && <p className="hint">The recording of you saying this is kept with the words.</p>}
        </div>
      )}

      {speaking.stage === 'ask-download' && (
        <div className="warning">
          <p>
            <strong>One download first.</strong> To write down what you say, Echo needs its
            speech-to-text model, which it downloads once from Hugging Face and keeps on this
            computer.
          </p>
          <div className="actions">
            <button type="button" className="button" data-action="speak-download" onClick={() => void hear(speaking.take, true)}>
              Download it and write this down
            </button>
            <button type="button" className="button-quiet" onClick={() => setSpeaking({ stage: 'off' })}>
              Not now
            </button>
          </div>
        </div>
      )}
      {speaking.stage === 'preparing' && <p className="hint">Getting ready to write down what you said…</p>}
      {speaking.stage === 'listening' && (
        <p className="hint">
          Writing down what you said{speaking.total > 1 ? ` (part ${Math.min(speaking.done + 1, speaking.total)} of ${speaking.total})` : ''}…
        </p>
      )}
      <Problems problems={problems} />

      {canTalk && speaking.stage === 'off' && (
        <div className="actions">
          <button type="button" className="button-quiet" data-action="speak" onClick={() => setSpeaking({ stage: 'recording' })} disabled={disabled}>
            {take ? 'Say it again' : talkLabel}
          </button>
        </div>
      )}
    </div>
  );
}
