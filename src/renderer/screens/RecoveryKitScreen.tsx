import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import type { RecoveryKit } from '../../shared/api.ts';
import { Problems } from './Problems.tsx';

type Stage = 'show' | 'prove';

function day(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { dateStyle: 'long' });
}

/** The page that comes out of the printer. Also what is shown on screen at the first stage. */
function KitSheet({ kit }: { kit: RecoveryKit }) {
  return (
    <article className="kit" data-kit>
      <h2>Echo recovery kit</h2>
      <p className="kit-lede">
        This page opens an Echo archive if the passphrase is lost or its owner has died. Keep it
        with your will. Anyone holding this page and the archive folder can open the archive.
      </p>

      <dl className="kit-facts">
        <div>
          <dt>This kit belongs to</dt>
          <dd className="kit-blank">&nbsp;</dd>
        </div>
        <div>
          <dt>Made on</dt>
          <dd>{day(kit.createdAt)}</dd>
        </div>
        <div>
          <dt>Archive folder</dt>
          <dd>
            <code>{kit.archivePath}</code>
          </dd>
        </div>
        <div>
          <dt>Archive number</dt>
          <dd>
            <code>{kit.archiveId}</code>
          </dd>
        </div>
      </dl>

      <h3>Recovery code</h3>
      <ol className="kit-code" data-kit-code={kit.groups.join('-')}>
        {kit.groups.map((group, index) => (
          <li key={index}>
            <span className="kit-group-number">{index + 1}</span>
            <code>{group}</code>
          </li>
        ))}
      </ol>
      <p className="kit-note">
        The code uses the digits 0 to 9 and capital letters. It never contains the letters I, L, O
        or U.
      </p>

      <h3>How to use it</h3>
      <ol className="kit-steps">
        <li>Open Echo on the computer that holds the archive folder shown above.</li>
        <li>
          On the locked screen, choose <strong>Use my recovery kit</strong>.
        </li>
        <li>Type the recovery code, group by group.</li>
        <li>Echo opens the archive and asks you to choose a new passphrase.</li>
      </ol>

      <p className="kit-note">
        Do not photograph this page, email it, or save it on a computer or phone. If you think
        someone has seen it, make a new kit in Echo, which stops this one working.
      </p>
    </article>
  );
}

export function RecoveryKitScreen({
  onDone,
  onCancel,
}: {
  onDone: () => Promise<void>;
  /** Given when this replaces an existing kit, so the person can back out. */
  onCancel?: () => void;
}) {
  const [kit, setKit] = useState<RecoveryKit | null>(null);
  const [stage, setStage] = useState<Stage>('show');
  const [first, setFirst] = useState('');
  const [second, setSecond] = useState('');
  const [problems, setProblems] = useState<string[]>([]);
  const [saved, setSaved] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void window.echo.recoveryKit.begin().then(setKit);
  }, []);

  if (!kit) return null;

  async function print() {
    setProblems([]);
    const result = await window.echo.recoveryKit.print();
    if (!result.ok) setProblems(result.problems);
  }

  async function savePdf() {
    setProblems([]);
    const result = await window.echo.recoveryKit.savePdf();
    if (result.ok) setSaved(result.note ?? '');
    else setProblems(result.problems);
  }

  async function confirm(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setProblems([]);
    const result = await window.echo.recoveryKit.confirm(first, second);
    setBusy(false);
    if (result.ok) await onDone();
    else setProblems(result.problems);
  }

  const [groupA, groupB] = kit.challenge;

  if (stage === 'show') {
    return (
      <section data-screen="recovery-kit" data-stage="show">
        <div className="panel no-print">
          <h2>{onCancel ? 'Print your new recovery kit' : 'Print your recovery kit'}</h2>
          <p>
            If you forget your passphrase, or after your death, this printed page is the only other
            way to open your archive. Print it now and put it with your will.
          </p>
          {onCancel && (
            <p className="warning">
              Your current kit keeps working until you confirm this one. After that, the old page
              opens nothing and should be destroyed.
            </p>
          )}
          <p className="hint">
            No printer? Save it as a PDF, print it somewhere you trust, then delete the PDF.
          </p>
          <Problems problems={problems} />
          {saved && (
            <p className="saved" data-kit-saved>
              Saved to <code>{saved}</code>. Print it, then delete that file.
            </p>
          )}
          <div className="actions">
            <button type="button" className="button" data-action="kit-print" onClick={print}>
              Print the kit
            </button>
            <button type="button" className="button-quiet" data-action="kit-pdf" onClick={savePdf}>
              Save as a PDF
            </button>
            <button
              type="button"
              className="button-quiet"
              data-action="kit-next"
              onClick={() => {
                setProblems([]);
                setStage('prove');
              }}
            >
              I have the printed page in my hand
            </button>
            {onCancel && (
              <button type="button" className="button-quiet" data-action="kit-cancel" onClick={onCancel}>
                Keep my current kit
              </button>
            )}
          </div>
        </div>
        <KitSheet kit={kit} />
      </section>
    );
  }

  return (
    <section className="panel panel-narrow" data-screen="recovery-kit" data-stage="prove">
      <h2>Check your printed kit</h2>
      <p>
        The code is now hidden. Read these two groups from the printed page, to prove the page
        exists and can be read.
      </p>
      <form onSubmit={confirm}>
        <div className="field">
          <label className="label" htmlFor="kit-group-a" data-challenge-a={groupA}>
            Group {groupA}
          </label>
          <input
            id="kit-group-a"
            type="text"
            className="group-input"
            value={first}
            onChange={(e) => setFirst(e.target.value)}
            maxLength={8}
            autoComplete="off"
            spellCheck={false}
            autoFocus
          />
        </div>
        <div className="field">
          <label className="label" htmlFor="kit-group-b" data-challenge-b={groupB}>
            Group {groupB}
          </label>
          <input
            id="kit-group-b"
            type="text"
            className="group-input"
            value={second}
            onChange={(e) => setSecond(e.target.value)}
            maxLength={8}
            autoComplete="off"
            spellCheck={false}
          />
        </div>
        <Problems problems={problems} />
        <div className="actions">
          <button type="submit" className="button" data-action="kit-confirm" disabled={busy}>
            {busy ? 'Checking…' : 'Confirm my kit'}
          </button>
          <button
            type="button"
            className="button-quiet"
            onClick={() => {
              setProblems([]);
              setStage('show');
            }}
          >
            Show the kit again
          </button>
        </div>
      </form>
    </section>
  );
}
