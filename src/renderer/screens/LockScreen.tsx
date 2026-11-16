import { useState } from 'react';
import type { FormEvent } from 'react';
import { Problems } from './Problems.tsx';

export function LockScreen({
  archivePath,
  hasRecoveryKit,
  onDone,
}: {
  archivePath: string;
  hasRecoveryKit: boolean;
  onDone: () => Promise<void>;
}) {
  const [mode, setMode] = useState<'passphrase' | 'recovery'>('passphrase');
  const [secret, setSecret] = useState('');
  const [problems, setProblems] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  function switchTo(next: 'passphrase' | 'recovery') {
    setMode(next);
    setSecret('');
    setProblems([]);
  }

  async function unlock(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setProblems([]);
    const result =
      mode === 'passphrase'
        ? await window.echo.archive.unlock(secret)
        : await window.echo.archive.unlockWithRecoveryCode(secret);
    setBusy(false);
    if (result.ok) {
      await onDone();
    } else {
      if (mode === 'passphrase') setSecret('');
      setProblems(result.problems);
    }
  }

  return (
    <section className="panel panel-narrow" data-screen="lock" data-mode={mode}>
      <h2>Your archive is locked</h2>

      <form onSubmit={unlock}>
        {mode === 'passphrase' ? (
          <div className="field">
            <label className="label" htmlFor="unlock-passphrase">
              Passphrase
            </label>
            <input
              id="unlock-passphrase"
              type="password"
              value={secret}
              onChange={(e) => setSecret(e.target.value)}
              autoComplete="current-password"
              spellCheck={false}
              autoFocus
            />
          </div>
        ) : (
          <div className="field">
            <label className="label" htmlFor="recovery-code">
              Recovery code
            </label>
            <p className="hint">
              Type the six groups from the printed recovery kit. Dashes and spaces do not matter.
            </p>
            <input
              id="recovery-code"
              type="text"
              className="code-input"
              value={secret}
              onChange={(e) => setSecret(e.target.value)}
              autoComplete="off"
              spellCheck={false}
              autoFocus
            />
          </div>
        )}

        <Problems problems={problems} />

        <div className="actions">
          <button
            type="submit"
            className="button"
            data-action={mode === 'passphrase' ? 'unlock' : 'recover'}
            disabled={busy || secret.length === 0}
          >
            {busy ? 'Opening…' : mode === 'passphrase' ? 'Unlock' : 'Open with recovery kit'}
          </button>
          {mode === 'passphrase' && hasRecoveryKit && (
            <button type="button" className="button-quiet" data-action="use-recovery" onClick={() => switchTo('recovery')}>
              Use my recovery kit
            </button>
          )}
          {mode === 'recovery' && (
            <button type="button" className="button-quiet" onClick={() => switchTo('passphrase')}>
              Use my passphrase
            </button>
          )}
        </div>
      </form>

      <p className="hint path-note">
        Archive folder: <code>{archivePath}</code>
      </p>
    </section>
  );
}
