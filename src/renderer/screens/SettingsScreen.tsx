import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import type { AiKeyStatus, BackupStatus } from '../../shared/api.ts';
import type { DoorStatus } from '../../shared/door.ts';
import { MIN_PASSPHRASE_LENGTH } from '../../shared/passphrase.ts';
import { Problems } from './Problems.tsx';

const CONSOLE_KEYS_URL = 'https://platform.claude.com/settings/keys';

function when(iso: string): string {
  return new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

function AiKeySection() {
  const [status, setStatus] = useState<AiKeyStatus | null>(null);
  const [key, setKey] = useState('');
  const [problems, setProblems] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  async function refresh() {
    setStatus(await window.echo.settings.aiKeyStatus());
  }

  useEffect(() => {
    void refresh();
  }, []);

  async function test(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setProblems([]);
    const result = await window.echo.settings.testAndSaveAiKey(key);
    setBusy(false);
    if (result.ok) {
      setKey('');
      await refresh();
    } else {
      setProblems(result.problems);
    }
  }

  async function remove() {
    await window.echo.settings.removeAiKey();
    setProblems([]);
    await refresh();
  }

  return (
    <section className="panel" data-section="ai-key" data-ai-key={status?.saved ? 'saved' : 'none'}>
      <h2>Your AI key</h2>
      <p>
        Echo uses Claude, made by Anthropic, to interview you and to speak as your echo. You pay
        Anthropic directly for what you use, with your own key. Echo never sees a bill and nobody
        else pays for you.
      </p>

      {status?.saved ? (
        <p className="saved" data-ai-key-saved>
          A working key is saved, ending <code>…{status.ending}</code>
          {status.testedAt ? `. Anthropic accepted it on ${when(status.testedAt)}.` : '.'}
        </p>
      ) : (
        <>
          <h3>How to get a key</h3>
          <ol className="steps">
            <li>
              Open the{' '}
              <a href={CONSOLE_KEYS_URL} target="_blank" rel="noreferrer">
                Claude Console
              </a>{' '}
              and create an account. Use an email address your heir will be able to get into. A
              mailbox made just for Echo is best.
            </li>
            <li>
              Add some credit under <strong>Settings</strong>, then <strong>Billing</strong>. A key
              with no credit behind it will pass the test here but will not be able to hold a
              conversation.
            </li>
            <li>
              Go to <strong>Settings</strong>, then <strong>API keys</strong>, and press{' '}
              <strong>Create key</strong>. Name it Echo.
            </li>
            <li>
              Copy the key straight away. It starts with <code>sk-ant-</code> and is shown only
              once.
            </li>
            <li>Paste it below.</li>
          </ol>
          <p className="hint">
            A Claude Pro or Max subscription cannot be used here. Anthropic only allows other apps
            to connect with a key.
          </p>
        </>
      )}

      <form onSubmit={test}>
        <div className="field">
          <label className="label" htmlFor="ai-key">
            {status?.saved ? 'Replace it with a different key' : 'Your key'}
          </label>
          <input
            id="ai-key"
            type="password"
            value={key}
            onChange={(e) => setKey(e.target.value)}
            autoComplete="off"
            spellCheck={false}
            placeholder="sk-ant-…"
          />
          <p className="hint">
            Echo asks Anthropic whether the key is valid, which costs nothing, and saves it only if
            it is. The key is kept encrypted inside your archive and is sent to Anthropic and
            nowhere else.
          </p>
        </div>
        <Problems problems={problems} />
        <div className="actions">
          <button type="submit" className="button" data-action="test-ai-key" disabled={busy || key.trim().length === 0}>
            {busy ? 'Asking Anthropic…' : 'Test and save'}
          </button>
          {status?.saved && (
            <button type="button" className="button-quiet" data-action="remove-ai-key" onClick={remove}>
              Remove the saved key
            </button>
          )}
        </div>
      </form>
    </section>
  );
}

function PassphraseSection() {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [problems, setProblems] = useState<string[]>([]);
  const [changed, setChanged] = useState(false);
  const [busy, setBusy] = useState(false);

  async function change(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setProblems([]);
    setChanged(false);
    const result = await window.echo.settings.changePassphrase(current, next, confirmation);
    setBusy(false);
    if (result.ok) {
      setCurrent('');
      setNext('');
      setConfirmation('');
      setChanged(true);
    } else {
      setProblems(result.problems);
    }
  }

  return (
    <section className="panel" data-section="passphrase">
      <h2>Your passphrase</h2>
      <p>Changing it does not affect your recovery kit, which keeps working.</p>
      <form onSubmit={change}>
        <div className="field">
          <label className="label" htmlFor="current-passphrase">
            Current passphrase
          </label>
          <input
            id="current-passphrase"
            type="password"
            value={current}
            onChange={(e) => setCurrent(e.target.value)}
            autoComplete="current-password"
            spellCheck={false}
          />
        </div>
        <div className="field">
          <label className="label" htmlFor="changed-passphrase">
            New passphrase
          </label>
          <p className="hint">At least {MIN_PASSPHRASE_LENGTH} characters.</p>
          <input
            id="changed-passphrase"
            type="password"
            value={next}
            onChange={(e) => setNext(e.target.value)}
            autoComplete="new-password"
            spellCheck={false}
          />
        </div>
        <div className="field">
          <label className="label" htmlFor="changed-passphrase-confirm">
            Type the new one again
          </label>
          <input
            id="changed-passphrase-confirm"
            type="password"
            value={confirmation}
            onChange={(e) => setConfirmation(e.target.value)}
            autoComplete="new-password"
            spellCheck={false}
          />
        </div>
        <Problems problems={problems} />
        {changed && (
          <p className="saved" data-passphrase-changed>
            Passphrase changed. The old one no longer works.
          </p>
        )}
        <div className="actions">
          <button type="submit" className="button" data-action="change-passphrase" disabled={busy || current.length === 0}>
            {busy ? 'Changing…' : 'Change passphrase'}
          </button>
        </div>
      </form>
    </section>
  );
}

function BackupSection() {
  const [status, setStatus] = useState<BackupStatus | null>(null);
  const [problems, setProblems] = useState<string[]>([]);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState('');

  async function refresh() {
    setStatus(await window.echo.backup.status());
  }

  useEffect(() => {
    void refresh();
  }, []);

  async function run(label: string, action: () => Promise<{ ok: boolean; problems: string[]; note?: string }>, checked = false) {
    setBusy(label);
    setProblems([]);
    setNote('');
    const result = await action();
    setBusy('');
    if (result.ok) setNote((checked ? 'Checked. ' : '') + (result.note ?? ''));
    else setProblems(result.problems);
    await refresh();
  }

  const state = !status?.configured ? 'none' : status.problem ? 'problem' : 'ok';

  return (
    <section className="panel" data-section="backup" data-backup={state}>
      <h2>Your backup</h2>
      <p>
        Your archive lives on this one computer. A backup is a second copy on another drive, so a
        broken or stolen computer does not take everything with it. The backup is encrypted exactly
        like the archive, and opens only with your passphrase or recovery kit.
      </p>

      {status?.configured ? (
        <>
          <p>
            Backup folder: <code>{status.folder}</code>
          </p>
          {status.lastAt ? (
            <p className="saved" data-backup-last>
              Last backed up {when(status.lastAt)}
              {status.lastFiles !== null ? `, ${status.lastFiles} files` : ''}.
            </p>
          ) : null}
          {!status.reachable && (
            <p className="warning" data-backup-unreachable>
              The backup drive is not plugged in. Echo will back up the next time it is, when you
              open or lock your archive.
            </p>
          )}
          <p className="hint">
            Echo brings the backup up to date by itself every time you open, lock or close your
            archive, as long as the drive is plugged in.
          </p>
        </>
      ) : (
        <p className="warning">
          You have no backup yet. Plug in an external drive or USB stick and choose a folder on it.
        </p>
      )}

      <Problems problems={problems} />
      {note && (
        <p className="saved" data-backup-note>
          {note}
        </p>
      )}

      <div className="actions">
        <button
          type="button"
          className={status?.configured ? 'button-quiet' : 'button'}
          data-action="choose-backup"
          disabled={busy !== ''}
          onClick={() => void run('choose', () => window.echo.backup.chooseLocation())}
        >
          {busy === 'choose' ? 'Backing up…' : status?.configured ? 'Use a different folder' : 'Choose where to back up'}
        </button>
        {status?.configured && (
          <>
            <button
              type="button"
              className="button"
              data-action="backup-now"
              disabled={busy !== ''}
              onClick={() => void run('now', () => window.echo.backup.backUpNow())}
            >
              {busy === 'now' ? 'Backing up…' : 'Back up now'}
            </button>
            <button
              type="button"
              className="button-quiet"
              data-action="check-backup"
              disabled={busy !== ''}
              onClick={() => void run('check', () => window.echo.backup.check(), true)}
            >
              {busy === 'check' ? 'Checking…' : 'Check my backup'}
            </button>
          </>
        )}
      </div>
    </section>
  );
}

/** The door for the person's own AI assistant: off by default, and plain about what it shares and what that risks. */
function DoorSection() {
  const [status, setStatus] = useState<DoorStatus | null>(null);
  const [command, setCommand] = useState('');
  const [mcpSettings, setMcpSettings] = useState('');
  const [problems, setProblems] = useState<string[]>([]);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void window.echo.settings.doorStatus().then(setStatus);
    void window.echo.settings.doorCommand().then(setCommand);
    void window.echo.settings.doorMcpSettings().then(setMcpSettings);
  }, []);

  async function turn(on: boolean) {
    setBusy(true);
    setProblems([]);
    const result = on ? await window.echo.settings.turnDoorOn() : await window.echo.settings.turnDoorOff();
    setBusy(false);
    setConfirming(false);
    if (!result.ok) setProblems(result.problems);
    setStatus(await window.echo.settings.doorStatus());
  }

  if (!status) return null;
  const share = status.wouldShare;

  return (
    <section className="panel" data-section="door" data-door={status.on ? 'on' : 'off'} data-door-passages={status.passages} data-door-lines={status.sheetLines}>
      <h2>Your assistant's door</h2>
      <p>
        If you run an AI assistant of your own on this computer, this lets it read your words from Echo at any time, including while Echo is
        closed and locked. It is off unless you turn it on. Most people will never need it.
      </p>
      <Problems problems={problems} />

      {status.on ? (
        <>
          <p className="saved" data-door-on>
            The door is on{status.turnedOnAt ? `, since ${when(status.turnedOnAt)}` : ''}. Your assistant can read {status.passages.toLocaleString()}{' '}
            {status.passages === 1 ? 'passage' : 'passages'} of your own words and {status.sheetLines.toLocaleString()}{' '}
            {status.sheetLines === 1 ? 'line' : 'lines'} from your character sheet and style profile
            {status.writtenAt ? `, as they stood at ${when(status.writtenAt)}` : ''}.
          </p>
          <p className="hint">
            Its store is kept in <code data-door-folder>{status.folder}</code>
          </p>
          <h3 className="group-head">What to tell your assistant</h3>
          <p>
            Your assistant uses the door by running this command. Give it the line below, and tell it to run it with the word <code>help</code>{' '}
            on the end to see what it can ask for.
          </p>
          <p>
            <code data-door-command>{command}</code>
          </p>
          <p>
            If your assistant takes MCP servers, add this block to its settings instead. It gives the assistant the same things as tools whose
            names start with <code>echo_</code>, such as <code>echo_search</code>, <code>echo_read</code> and <code>echo_ask</code>.
          </p>
          <pre className="code-block" data-door-mcp>
            {mcpSettings}
          </pre>
          <p className="hint">
            Either way it can search and read your words, read your character sheet and style profile, and leave things in a tray for you to
            approve. It cannot change anything in your archive. Each use is noted in the activity on your home screen: when, and what kind, never
            the words.
          </p>

          <h3 className="group-head">Asking your echo</h3>
          <p>
            Your assistant can also put questions to your echo and get its answers, in your voice, from your words marked for everyone. Each
            question is answered by the AI service and costs money, so it may ask at most {status.dailyQuestions} a day. Today it has asked{' '}
            <span data-door-asked>{status.askedToday}</span>.
          </p>
          <label className="choice-option">
            <input
              type="checkbox"
              data-door-share-key
              checked={status.sharesAiKey}
              disabled={busy}
              onChange={(event) => {
                const shares = event.target.checked;
                setBusy(true);
                setProblems([]);
                void window.echo.door.shareAiKey(shares).then(async (result) => {
                  if (!result.ok) setProblems(result.problems);
                  setStatus(await window.echo.settings.doorStatus());
                  setBusy(false);
                });
              }}
            />
            <span>
              <strong>Pay for my assistant's questions with my own AI key.</strong> Ticked, Echo puts a copy of your AI key in the assistant's
              store, where anything running on this computer as you can read it. Unticked, your assistant has to bring a key of its own (it runs
              the door with <code>ANTHROPIC_API_KEY</code> set), and yours stays locked in your archive.
            </span>
          </label>
          <p className="hint">
            The daily limit is counted in a plain file your assistant could alter, so it stops a mistake, not a determined program. The spending
            limit you set with the AI service itself is the one that cannot be got round.
          </p>
          <div className="remove-row">
            <button type="button" className="button button-stop" data-action="door-off" onClick={() => void turn(false)} disabled={busy}>
              Turn the door off and delete its store
            </button>
          </div>
        </>
      ) : (
        <>
          <h3 className="group-head">What your assistant would be given</h3>
          <ul>
            <li>
              Your own words that you marked for everyone
              {share ? `: ${share.passages.toLocaleString()} ${share.passages === 1 ? 'passage' : 'passages'} at the moment` : ''}.
            </li>
            <li>
              The lines of your character sheet and style profile that are for everyone
              {share ? `: ${share.sheetLines.toLocaleString()} at the moment` : ''}.
            </li>
          </ul>
          <h3 className="group-head">What it is never given</h3>
          <ul>
            <li>Your passphrase, or the key to your archive.</li>
            <li>Anything you marked for one person only.</li>
            <li>Other people's messages.</li>
            <li>Your face, your voice, or your consent recording.</li>
          </ul>
          <p className="warning">
            <strong>What this costs you.</strong> Echo keeps a separate copy of those words for your assistant, with a key of its own that has to
            sit on this computer so the assistant can use it with nobody there. Anything that runs on this computer as you, and anyone who takes
            the disk out of it, can read that copy. Your archive itself stays locked with your passphrase. Turning on Windows device encryption
            protects the copy if the computer is stolen.
          </p>
          {confirming ? (
            <div className="remove-row">
              <span className="remove-warning">Your assistant will be able to read those words whenever it likes.</span>
              <button type="button" className="button" data-action="door-on-confirm" onClick={() => void turn(true)} disabled={busy}>
                Yes, turn the door on
              </button>
              <button type="button" className="button-quiet" onClick={() => setConfirming(false)} disabled={busy}>
                Leave it off
              </button>
            </div>
          ) : (
            <div className="actions">
              <button type="button" className="button-quiet" data-action="door-on" onClick={() => setConfirming(true)} disabled={!share}>
                Turn the door on
              </button>
              {!share && <span className="status">Needs your consent to be in force.</span>}
            </div>
          )}
        </>
      )}
    </section>
  );
}

/** Takes a copy of everything out of the archive, in files any computer can open. */
function ExportSection() {
  const [busy, setBusy] = useState(false);
  const [problems, setProblems] = useState<string[]>([]);
  const [made, setMade] = useState<{ folder: string; files: number } | null>(null);

  async function run() {
    setBusy(true);
    setProblems([]);
    setMade(null);
    const result = await window.echo.settings.exportEverything();
    setBusy(false);
    if (result.ok) setMade({ folder: result.folder, files: result.files });
    else setProblems(result.problems);
  }

  return (
    <section className="panel" data-section="export" data-exported={made ? made.files : ''}>
      <h2>Take a copy of everything</h2>
      <p>
        Echo writes everything in your archive into a folder you choose, as ordinary files: your words as text, your recordings and pictures as
        they are, and the rest as JSON. Every file opens without Echo.
      </p>
      <p className="warning">
        <strong>The copy is not encrypted.</strong> Anyone who can open that folder can read, see and hear all of it, including other people's
        messages you imported. Put it somewhere safe, and delete it when you are done with it.
      </p>
      <Problems problems={problems} />
      {made && (
        <p className="saved" data-export-done>
          Done: {made.files.toLocaleString()} files in <code data-export-folder>{made.folder}</code>
        </p>
      )}
      <div className="actions">
        <button type="button" className="button" data-action="export-everything" onClick={() => void run()} disabled={busy}>
          {busy ? 'Copying… this can take a while' : 'Choose a folder and take a copy'}
        </button>
      </div>
    </section>
  );
}

/** Deleting: the conversations with the echo, or everything. */
function DeleteSection({ onDeleted }: { onDeleted: () => void }) {
  const [problems, setProblems] = useState<string[]>([]);
  const [note, setNote] = useState('');
  const [confirmingChats, setConfirmingChats] = useState(false);
  const [confirmingAll, setConfirmingAll] = useState(false);
  const [passphrase, setPassphrase] = useState('');
  const [alsoBackup, setAlsoBackup] = useState(true);
  const [busy, setBusy] = useState(false);
  const [gone, setGone] = useState<'deleted' | 'kept' | 'none' | 'unreachable' | null>(null);

  async function deleteChats() {
    setProblems([]);
    const result = await window.echo.settings.deleteConversations();
    setConfirmingChats(false);
    if (result.ok) setNote('Every conversation with your echo has been deleted.');
    else setProblems(result.problems);
  }

  async function deleteAll(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setProblems([]);
    const result = await window.echo.settings.deleteEverything(passphrase, alsoBackup);
    setBusy(false);
    setPassphrase('');
    if (result.ok) setGone(result.backup);
    else setProblems(result.problems);
  }

  if (gone) {
    return (
      <section className="panel" data-section="deleted" data-backup-outcome={gone}>
        <h2>Your archive has been deleted</h2>
        <p>Everything Echo held on this computer is gone.</p>
        <p>
          {gone === 'deleted' && 'The backup was deleted too.'}
          {gone === 'kept' && 'The backup was left where it is, as you asked. It is still encrypted.'}
          {gone === 'unreachable' && (
            <strong>The backup could not be reached, so it is still there. Plug that drive in and delete the "Echo Backup" folder on it yourself.</strong>
          )}
          {gone === 'none' && 'There was no backup.'}
        </p>
        <p className="hint">
          It was a plain delete. What was stored was encrypted, so anyone recovering the files from the drive would also need your passphrase. Any
          copy you took with "Take a copy of everything" is not touched: delete that yourself.
        </p>
        <div className="actions">
          <button type="button" className="button" data-action="deleted-close" onClick={onDeleted}>
            Close
          </button>
        </div>
      </section>
    );
  }

  return (
    <section className="panel" data-section="delete">
      <h2>Delete</h2>
      <p>
        A single story, piece of advice, letter, recording or imported conversation is removed on its own screen, and your echo stops drawing on
        it straight away. Here you can delete more.
      </p>
      <Problems problems={problems} />
      {note && (
        <p className="saved" data-delete-note>
          {note}
        </p>
      )}

      <h3 className="group-head">The conversations with your echo</h3>
      <p className="hint">
        Conversations keep what your echo said at the time, so one may still repeat something you have since removed. Deleting them clears that.
      </p>
      <div className="remove-row">
        {confirmingChats ? (
          <>
            <span className="remove-warning">This deletes every conversation, for you and for every person, for good.</span>
            <button type="button" className="button button-stop" data-action="delete-chats-confirm" onClick={() => void deleteChats()}>
              Yes, delete them
            </button>
            <button type="button" className="button-quiet" onClick={() => setConfirmingChats(false)}>
              Keep them
            </button>
          </>
        ) : (
          <button type="button" className="button-quiet" data-action="delete-chats" onClick={() => setConfirmingChats(true)}>
            Delete all conversations
          </button>
        )}
      </div>

      <h3 className="group-head">Everything</h3>
      <p className="hint">
        Deletes your whole archive from this computer: every recording, every word, your consent, your echo. There is no undo, and the recovery
        kit cannot bring it back. Take a copy first if there is anything you want to keep.
      </p>
      {confirmingAll ? (
        <form onSubmit={(event) => void deleteAll(event)} data-delete-all-form>
          <div className="field">
            <label className="label" htmlFor="delete-passphrase">
              Type your passphrase to delete everything
            </label>
            <input id="delete-passphrase" type="password" value={passphrase} onChange={(event) => setPassphrase(event.target.value)} autoComplete="off" disabled={busy} />
          </div>
          <label className="choice-option">
            <input id="delete-backup" type="checkbox" checked={alsoBackup} onChange={(event) => setAlsoBackup(event.target.checked)} disabled={busy} />
            <span>Delete the backup as well, if there is one and its drive is plugged in.</span>
          </label>
          <div className="remove-row">
            <span className="remove-warning">This cannot be undone.</span>
            <button type="submit" className="button button-stop" data-action="delete-everything-confirm" disabled={busy || passphrase.length === 0}>
              {busy ? 'Deleting…' : 'Delete everything for good'}
            </button>
            <button type="button" className="button-quiet" data-action="delete-everything-cancel" onClick={() => setConfirmingAll(false)} disabled={busy}>
              Keep my archive
            </button>
          </div>
        </form>
      ) : (
        <div className="remove-row">
          <button type="button" className="button-quiet" data-action="delete-everything" onClick={() => setConfirmingAll(true)}>
            Delete everything
          </button>
        </div>
      )}
    </section>
  );
}

export function SettingsScreen({
  archivePath,
  onBack,
  onNewKit,
  onDeleted,
}: {
  archivePath: string;
  onBack: () => void;
  onNewKit: () => void;
  /** Called once the whole archive has been deleted and the person has read what happened. */
  onDeleted: () => void;
}) {
  return (
    <div data-screen="settings">
      <div className="actions back-row">
        <button type="button" className="button-quiet" data-action="back-home" onClick={onBack}>
          Back to home
        </button>
      </div>

      <AiKeySection />
      <BackupSection />
      <PassphraseSection />

      <section className="panel" data-section="recovery-kit">
        <h2>Your recovery kit</h2>
        <p>
          You have a recovery kit. Make a new one if the page is lost, or if someone who should not
          have seen it may have. The old page stops working once the new one is confirmed.
        </p>
        <div className="actions">
          <button type="button" className="button-quiet" data-action="new-kit" onClick={onNewKit}>
            Make a new recovery kit
          </button>
        </div>
      </section>

      <section className="panel" data-section="archive">
        <h2>Where your archive is kept</h2>
        <p>
          <code>{archivePath}</code>
        </p>
        <p className="hint">Everything in that folder is encrypted.</p>
      </section>

      <DoorSection />
      <ExportSection />
      <DeleteSection onDeleted={onDeleted} />
    </div>
  );
}
