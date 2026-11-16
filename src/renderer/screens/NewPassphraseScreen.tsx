import { useState } from 'react';
import type { FormEvent } from 'react';
import { MIN_PASSPHRASE_LENGTH } from '../../shared/passphrase.ts';
import { Problems } from './Problems.tsx';

export function NewPassphraseScreen({ onDone }: { onDone: () => Promise<void> }) {
  const [passphrase, setPassphrase] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [show, setShow] = useState(false);
  const [problems, setProblems] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  async function save(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setProblems([]);
    const result = await window.echo.archive.setNewPassphrase(passphrase, confirmation);
    setBusy(false);
    if (result.ok) await onDone();
    else setProblems(result.problems);
  }

  return (
    <section className="panel panel-narrow" data-screen="new-passphrase">
      <h2>Choose a new passphrase</h2>
      <p>
        The recovery kit opened the archive. The old passphrase will stop working as soon as you
        set a new one. The recovery kit keeps working.
      </p>
      <form onSubmit={save}>
        <div className="field">
          <label className="label" htmlFor="new-passphrase">
            New passphrase
          </label>
          <p className="hint">At least {MIN_PASSPHRASE_LENGTH} characters. Four or more unrelated words works well.</p>
          <input
            id="new-passphrase"
            type={show ? 'text' : 'password'}
            value={passphrase}
            onChange={(e) => setPassphrase(e.target.value)}
            autoComplete="new-password"
            spellCheck={false}
            autoFocus
          />
        </div>
        <div className="field">
          <label className="label" htmlFor="new-passphrase-confirm">
            Type it again
          </label>
          <input
            id="new-passphrase-confirm"
            type={show ? 'text' : 'password'}
            value={confirmation}
            onChange={(e) => setConfirmation(e.target.value)}
            autoComplete="new-password"
            spellCheck={false}
          />
          <label className="check">
            <input type="checkbox" checked={show} onChange={(e) => setShow(e.target.checked)} />
            Show what I am typing
          </label>
        </div>
        <Problems problems={problems} />
        <div className="actions">
          <button type="submit" className="button" data-action="set-passphrase" disabled={busy}>
            {busy ? 'Saving…' : 'Set new passphrase'}
          </button>
        </div>
      </form>
    </section>
  );
}
