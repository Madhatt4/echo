import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { MIN_PASSPHRASE_LENGTH } from '../../shared/passphrase.ts';
import { Problems } from './Problems.tsx';

export function CreateArchiveScreen({ onDone }: { onDone: () => Promise<void> }) {
  const [location, setLocation] = useState('');
  const [passphrase, setPassphrase] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [show, setShow] = useState(false);
  const [problems, setProblems] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void window.echo.archive.suggestedLocation().then(setLocation);
  }, []);

  async function chooseLocation() {
    const chosen = await window.echo.archive.chooseLocation();
    if (chosen) setLocation(chosen);
  }

  async function create(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setProblems([]);
    const result = await window.echo.archive.create(location, passphrase, confirmation);
    setBusy(false);
    if (result.ok) await onDone();
    else setProblems(result.problems);
  }

  async function findExisting() {
    setProblems([]);
    const result = await window.echo.archive.findExisting();
    if (result.ok) await onDone();
    else setProblems(result.problems);
  }

  async function restore() {
    setProblems([]);
    setBusy(true);
    const result = await window.echo.archive.restoreFromBackup();
    setBusy(false);
    if (result.ok) await onDone();
    else setProblems(result.problems);
  }

  return (
    <section className="panel" data-screen="create-archive">
      <h2>Set up your archive</h2>
      <p>
        Your archive is the folder where everything you capture is kept. It is locked with a
        passphrase, and nothing in it can be read without that passphrase.
      </p>

      <form onSubmit={create}>
        <div className="field">
          <span className="label">Where to keep it</span>
          <p className="hint">
            Echo will make a folder called <strong>Echo Archive</strong> inside this one.
          </p>
          <div className="location">
            <code data-location>{location || '…'}</code>
            <button type="button" className="button-quiet" onClick={chooseLocation}>
              Choose a different folder
            </button>
          </div>
        </div>

        <div className="field">
          <label className="label" htmlFor="passphrase">
            Passphrase
          </label>
          <p className="hint">
            At least {MIN_PASSPHRASE_LENGTH} characters. Four or more unrelated words is strong and
            easy to remember, for example a line only you would think of.
          </p>
          <input
            id="passphrase"
            type={show ? 'text' : 'password'}
            value={passphrase}
            onChange={(e) => setPassphrase(e.target.value)}
            autoComplete="new-password"
            spellCheck={false}
            autoFocus
          />
        </div>

        <div className="field">
          <label className="label" htmlFor="passphrase-confirm">
            Type it again
          </label>
          <input
            id="passphrase-confirm"
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

        <p className="warning">
          <strong>If you forget this passphrase, nobody can open your archive.</strong> Not you, not
          your family, and not the people who made Echo. The next screen gives you a printed
          recovery kit that protects against this.
        </p>

        <Problems problems={problems} />

        <div className="actions">
          <button type="submit" className="button" data-action="create" disabled={busy}>
            {busy ? 'Creating your archive…' : 'Create my archive'}
          </button>
          <button type="button" className="button-quiet" onClick={findExisting} disabled={busy}>
            I already have an archive
          </button>
          <button type="button" className="button-quiet" data-action="restore" onClick={restore} disabled={busy}>
            Restore from a backup
          </button>
        </div>
      </form>
    </section>
  );
}
