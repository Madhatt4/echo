import { useCallback, useEffect, useMemo, useState } from 'react';
import { App as Native } from '@capacitor/app';
import { promptsFor, suggestPrompt } from '../../src/shared/story-prompts.ts';
import { newRecordingId, readPairingCode, sealMemory, sealRecording } from './link.ts';
import type { PairingCode, Picture } from './link.ts';
import { pair, sendWaiting } from './outbox.ts';
import type { PairProblem, SendResult } from './outbox.ts';
import { PhotoStrip, Picker } from './Picker.tsx';
import type { ChosenVideo } from './Picker.tsx';
import { Recorder } from './Recorder.tsx';
import type { Recording } from './Recorder.tsx';
import { NameForm } from './NameForm.tsx';
import { Scanner } from './Scanner.tsx';
import { askedPrompts, forgetPc, keep, markAsked, pairedPc, phoneKeys, waiting } from './store.ts';
import type { PairedPc } from './store.ts';

type Screen =
  | { kind: 'loading' }
  | { kind: 'welcome'; problem?: string }
  | { kind: 'scanning' }
  | { kind: 'naming'; code: PairingCode; problem?: PairProblem; busy?: boolean }
  | { kind: 'home' }
  | { kind: 'picking' }
  | { kind: 'recording'; prompt: string; pictures?: Picture[] };

function sendLine(result: SendResult | null, left: number): string {
  if (!result) return left > 0 ? `${left} waiting to go to your computer.` : '';
  switch (result.kind) {
    case 'all-sent':
      return `Sent to your computer: ${result.count === 1 ? 'one memory' : `${result.count} memories`}. Nothing is waiting.`;
    case 'nothing':
      return 'Everything you have recorded is on your computer.';
    case 'unreachable':
      return `${result.left} waiting. Your computer is not reachable just now. They will go next time both are on your Wi-Fi with Echo open.`;
    case 'locked':
      return `${result.left} waiting. Echo on your computer is locked. Unlock it and they will go.`;
    case 'refused':
      return `${result.left} waiting. ${result.reason}`;
    default:
      return '';
  }
}

export function App() {
  const [screen, setScreen] = useState<Screen>({ kind: 'loading' });
  const [pc, setPc] = useState<PairedPc | null>(null);
  const [left, setLeft] = useState(0);
  const [result, setResult] = useState<SendResult | null>(null);
  const [asked, setAsked] = useState<string[]>([]);
  const [turn, setTurn] = useState(0);
  const [sending, setSending] = useState(false);
  const [unpairing, setUnpairing] = useState(false);
  const deck = useMemo(() => promptsFor([]), []);
  const prompt = suggestPrompt(deck, asked, turn);

  const send = useCallback(async () => {
    setSending(true);
    try {
      setResult(await sendWaiting());
    } finally {
      setLeft((await waiting()).length);
      setSending(false);
    }
  }, []);

  useEffect(() => {
    void (async () => {
      await phoneKeys();
      const known = await pairedPc();
      setPc(known);
      setAsked(await askedPrompts());
      setLeft((await waiting()).length);
      setScreen(known ? { kind: 'home' } : { kind: 'welcome' });
      if (known) await send();
    })();
    const listener = Native.addListener('resume', () => void send());
    return () => {
      void listener.then((handle) => handle.remove());
    };
  }, [send]);

  const scanned = useCallback((text: string) => {
    const code = readPairingCode(text);
    setScreen(code ? { kind: 'naming', code } : { kind: 'welcome', problem: 'That is not an Echo pairing code. On your computer, open Echo, Tell a story, Your phone, Pair a phone.' });
  }, []);

  async function finishPairing(code: PairingCode, name: string) {
    setScreen({ kind: 'naming', code, busy: true });
    const problem = await pair(code, name.trim() || 'iPhone');
    if (problem) {
      setScreen({ kind: 'naming', code, problem });
      return;
    }
    setPc(await pairedPc());
    setScreen({ kind: 'home' });
    await send();
  }

  async function kept(recording: Recording, question: string, pictures: readonly Picture[] = []) {
    if (!pc) return;
    const id = newRecordingId();
    const header = { id, recordedAt: recording.recordedAt.toISOString(), prompt: question, seconds: recording.seconds, mimeType: recording.mimeType };
    await keep({ id, recordedAt: header.recordedAt, prompt: question, seconds: recording.seconds }, sealMemory(await phoneKeys(), pc.pc, header, recording.audio, pictures));
    if (question) {
      await markAsked(question);
      setAsked(await askedPrompts());
      setTurn(0);
    }
    setScreen({ kind: 'home' });
    await send();
  }

  /** A video is the memory itself: no question, no separate sound. */
  async function keptVideo(video: ChosenVideo) {
    if (!pc) return;
    const id = newRecordingId();
    const recordedAt = new Date().toISOString();
    const header = { id, recordedAt, prompt: '', seconds: video.seconds, mimeType: video.mimeType };
    await keep({ id, recordedAt, prompt: '', seconds: video.seconds }, sealRecording(await phoneKeys(), pc.pc, header, video.bytes));
    setScreen({ kind: 'home' });
    // Sending can take minutes; the picker only waits for the video to be kept.
    void send();
  }

  async function unpair() {
    await forgetPc();
    setPc(null);
    setUnpairing(false);
    setScreen({ kind: 'welcome' });
  }

  if (screen.kind === 'loading') return <main className="app" />;

  if (screen.kind === 'scanning') {
    return (
      <main className="app">
        <Scanner onCode={scanned} onCancel={() => setScreen({ kind: 'welcome' })} />
      </main>
    );
  }

  if (screen.kind === 'naming') {
    return (
      <main className="app">
        <NameForm
          code={screen.code}
          busy={screen.busy ?? false}
          problem={screen.problem}
          onPair={finishPairing}
          onRescan={() => setScreen({ kind: 'scanning' })}
          onCancel={() => setScreen({ kind: 'welcome' })}
        />
      </main>
    );
  }

  if (screen.kind === 'picking') {
    return (
      <main className="app">
        <Picker
          onPhotos={(pictures) => setScreen({ kind: 'recording', prompt: '', pictures })}
          onVideo={keptVideo}
          onCancel={() => setScreen({ kind: 'home' })}
        />
      </main>
    );
  }

  if (screen.kind === 'recording') {
    return (
      <main className="app">
        {screen.pictures && <PhotoStrip pictures={screen.pictures} />}
        {screen.prompt && <p className="prompt">{screen.prompt}</p>}
        <Recorder onKeep={(recording) => kept(recording, screen.prompt, screen.pictures)} onCancel={() => setScreen({ kind: 'home' })} />
      </main>
    );
  }

  if (screen.kind === 'welcome' || !pc) {
    return (
      <main className="app">
        <h1>Echo</h1>
        <p>Record a memory wherever you are. It is locked on this phone so only your own computer can open it, and it goes there over your Wi-Fi, never the internet.</p>
        <p>First, pair this phone with Echo on your computer: open Echo, go to Tell a story, scroll to Your phone and press Pair a phone.</p>
        {screen.kind === 'welcome' && screen.problem && <p className="problem">{screen.problem}</p>}
        <button type="button" className="big" onClick={() => setScreen({ kind: 'scanning' })}>
          Scan the code
        </button>
        {left > 0 && <p className="hint">{left} recorded before are still kept here, locked, and will go once this phone is paired with the same computer again.</p>}
      </main>
    );
  }

  return (
    <main className="app">
      <h1>Echo</h1>
      {prompt ? (
        <section className="card">
          <p className="label">{prompt.stage}</p>
          <p className="prompt">{prompt.text}</p>
          <button type="button" className="big" onClick={() => setScreen({ kind: 'recording', prompt: prompt.text })}>
            Record a memory
          </button>
          <button type="button" className="quiet" onClick={() => setTurn(turn + 1)}>
            Ask me something else
          </button>
        </section>
      ) : (
        <p>You have answered every question in the deck.</p>
      )}
      <button type="button" className="quiet" onClick={() => setScreen({ kind: 'recording', prompt: '' })}>
        Just talk about anything
      </button>
      <button type="button" className="quiet" onClick={() => setScreen({ kind: 'picking' })}>
        Add a photo or video
      </button>

      <section className="status">
        <p>{sending ? 'Sending to your computer…' : sendLine(result, left)}</p>
        {left > 0 && !sending && (
          <button type="button" className="quiet" onClick={() => void send()}>
            Try sending now
          </button>
        )}
      </section>

      <footer className="foot">
        <p className="hint">
          Paired as {pc.name} with the computer at {pc.host}.
        </p>
        {unpairing ? (
          <>
            <p className="hint">This phone will stop sending to that computer. Anything still waiting stays here, locked.</p>
            <button type="button" className="quiet danger" onClick={() => void unpair()}>
              Unpair this phone
            </button>
            <button type="button" className="quiet" onClick={() => setUnpairing(false)}>
              Keep it paired
            </button>
          </>
        ) : (
          <button type="button" className="quiet" onClick={() => setUnpairing(true)}>
            Unpair
          </button>
        )}
      </footer>
    </main>
  );
}
