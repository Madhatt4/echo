import { useState } from 'react';
import type { PairingCode } from './link.ts';
import type { PairProblem } from './outbox.ts';

interface NameFormProps {
  code: PairingCode;
  busy: boolean;
  problem?: PairProblem;
  onPair: (code: PairingCode, name: string) => Promise<void>;
  onRescan: () => void;
  onCancel: () => void;
}

// After a failure the problem and the ways forward sit above the name box,
// because the iPhone keyboard covers the bottom half of the screen.
export function NameForm({ code, busy, problem, onPair, onRescan, onCancel }: NameFormProps) {
  const [name, setName] = useState('');
  return (
    <form
      className="naming"
      onSubmit={(event) => {
        event.preventDefault();
        // The keyboard's Go key submits too, so a dead code must not be resent.
        if (busy || (problem && !problem.canRetry)) return;
        void onPair(code, name);
      }}
    >
      <h1>Nearly there</h1>
      {problem && (
        <div className="trouble" role="alert">
          <p className="problem">{problem.message}</p>
          {problem.canRetry && (
            <button type="submit" className="big" disabled={busy}>
              {busy ? 'Trying again…' : 'Try again'}
            </button>
          )}
          <button type="button" className={problem.canRetry ? 'quiet' : 'big'} disabled={busy} onClick={onRescan}>
            Scan a new code
          </button>
          <button type="button" className="quiet" disabled={busy} onClick={onCancel}>
            Start again
          </button>
        </div>
      )}
      <label htmlFor="phone-name">What should your computer call this phone?</label>
      <input id="phone-name" value={name} maxLength={60} placeholder="For example, Dad's iPhone" onChange={(event) => setName(event.target.value)} />
      {!problem && (
        <button type="submit" className="big" disabled={busy}>
          {busy ? 'Pairing…' : 'Pair'}
        </button>
      )}
      {!problem && (
        <button type="button" className="quiet" disabled={busy} onClick={onCancel}>
          Start again
        </button>
      )}
    </form>
  );
}
