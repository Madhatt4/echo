import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { SERVICE_NAMES } from '../../shared/imports.ts';
import type { ImportChosen, ImportPreview, ImportService, ImportSummary, ImportedMessage, MailboxFound, ThreadChoice } from '../../shared/imports.ts';
import type { TrayService } from '../../shared/door.ts';
import { audienceLabel } from '../../shared/people.ts';
import type { IphoneBackup } from '../../shared/iphone.ts';
import type { Audience, Person } from '../../shared/people.ts';
import { Problems } from './Problems.tsx';

const PAGE = 200;

function day(at: string): string {
  return new Date(at).toLocaleDateString(undefined, { dateStyle: 'medium' });
}

function moment(at: string): string {
  return new Date(at).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

function heardBy(audience: Audience | null, people: readonly Person[]): string {
  return audience === null ? 'Nobody: your echo does not use it' : audienceLabel(audience, people);
}

/** What was found in the file, and the choices only the person can make, before anything is saved. */
function Preview({ preview, people, onDone, onCancel }: { preview: ImportPreview; people: readonly Person[]; onDone: () => Promise<void>; onCancel: () => void }) {
  const [me, setMe] = useState(preview.suggestedMe ?? '');
  const [label, setLabel] = useState(preview.suggestedLabel);
  const [personId, setPersonId] = useState('');
  const [hears, setHears] = useState<'person' | 'everyone' | 'nobody'>('nobody');
  const [problems, setProblems] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const person = people.find((candidate) => candidate.id === personId);

  async function save(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    const audience: Audience | null = hears === 'everyone' ? { kind: 'everyone' } : hears === 'person' && personId ? { kind: 'person', personId } : null;
    const result = await window.echo.imports.confirm(preview.token, { me, label, personId: personId || null, audience });
    setBusy(false);
    if (result.ok) await onDone();
    else setProblems(result.problems);
  }

  return (
    <section className="panel panel-wide" data-section="import-preview" data-import-messages={preview.messages}>
      <h2>Check this before it is imported</h2>
      <p>
        {SERVICE_NAMES[preview.service]}. Echo read <strong>{preview.fileName}</strong> on this computer and found {preview.messages.toLocaleString()} messages with words, from{' '}
        {day(preview.from)} to {day(preview.to)}.
        {preview.media > 0 &&
          (preview.service === 'email'
            ? ` ${preview.media.toLocaleString()} more had no words of yours in them (a forward, or only an attachment) and are left out.`
            : ` ${preview.media.toLocaleString()} photos, voice notes and other attachments have no words and are left out.`)}
      </p>
      {preview.datesAssumedDayFirst && (
        <p className="warning" data-import-dates-assumed>
          Echo could not tell from this file whether dates are written day first or month first, and has read them as day first. If the dates above
          look wrong, do not import this conversation.
        </p>
      )}
      {preview.alreadyImportedAs && (
        <p className="warning" data-import-duplicate>
          You have already imported this export, as "{preview.alreadyImportedAs}".
        </p>
      )}

      <form onSubmit={save}>
        <fieldset className="field choice">
          <legend className="label">Which one is you?</legend>
          {preview.service === 'discord' ? (
            <p className="hint" data-import-one-sided>
              A Discord package holds only what you sent, so every message here is yours. What other people said is not in it.
            </p>
          ) : preview.service === 'email' ? (
            <p className="hint" data-import-one-sided>
              Only the emails you sent are read, so every one here is yours. Anything you quoted from the other person's email is cut off, and so is
              your signature. <strong>Read the sample below: if any of it is someone else's words, do not import this.</strong>
            </p>
          ) : (
            <>
              <p className="hint">Everyone else's messages are marked as other people's words. That cannot be changed afterwards.</p>
              {preview.suggestedMe && <p className="hint">Echo has picked the name you were in earlier imports. Check it is right.</p>}
            </>
          )}
          {preview.senders.map((sender) => (
            <label key={sender.name} className="choice-option">
              <input type="radio" name="import-me" data-sender={sender.name} checked={me === sender.name} onChange={() => setMe(sender.name)} />
              <span>
                <strong>{sender.name}</strong> · {sender.count.toLocaleString()} messages
              </span>
            </label>
          ))}
        </fieldset>

        <div className="field">
          <label className="label" htmlFor="import-label">
            What do you call this conversation?
          </label>
          <input id="import-label" type="text" value={label} onChange={(event) => setLabel(event.target.value)} autoComplete="off" />
        </div>

        <div className="field">
          <label className="label" htmlFor="import-person">
            Who is it with?
          </label>
          <select
            id="import-person"
            value={personId}
            onChange={(event) => {
              setPersonId(event.target.value);
              setHears(event.target.value ? 'person' : 'nobody');
            }}
          >
            <option value="">Someone not in my list, or a group</option>
            {people.map((candidate) => (
              <option key={candidate.id} value={candidate.id}>
                {candidate.name}
              </option>
            ))}
          </select>
        </div>

        <fieldset className="field choice">
          <legend className="label">Who may hear what you said in it, from your echo?</legend>
          {person && (
            <label className="choice-option">
              <input type="radio" name="import-hears" data-hears="person" checked={hears === 'person'} onChange={() => setHears('person')} />
              <span>
                <strong>Only {person.name}.</strong> It was between the two of you, and stays that way.
              </span>
            </label>
          )}
          <label className="choice-option">
            <input type="radio" name="import-hears" data-hears="everyone" checked={hears === 'everyone'} onChange={() => setHears('everyone')} />
            <span>
              <strong>Everyone.</strong> Ordinary chat you would be happy for any of your family to hear. This is also what teaches your echo how you
              talk in general.
            </span>
          </label>
          <label className="choice-option">
            <input type="radio" name="import-hears" data-hears="nobody" checked={hears === 'nobody'} onChange={() => setHears('nobody')} />
            <span>
              <strong>Nobody.</strong> Keep it in my archive, but my echo does not use it.
            </span>
          </label>
        </fieldset>

        <h3 className="group-head">The first messages, as Echo read them</h3>
        <ol className="imported" data-import-sample>
          {preview.sample.map((message, index) => (
            <li key={index} className={me && message.sender === me ? 'imported-mine' : 'imported-theirs'}>
              <span className="status">
                {message.sender} · {moment(message.at)}
              </span>
              <p>{message.text}</p>
            </li>
          ))}
        </ol>

        <Problems problems={problems} />
        <div className="actions">
          <button type="submit" className="button" data-action="import-save" disabled={busy || !me}>
            {busy ? 'Importing…' : 'Import this conversation'}
          </button>
          <button type="button" className="button-quiet" data-action="import-cancel" onClick={onCancel} disabled={busy}>
            Cancel
          </button>
        </div>
      </form>
    </section>
  );
}

function megabytes(bytes: number): string {
  return bytes >= 1024 * 1024 ? `${(bytes / (1024 * 1024)).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

/** The conversations found in a download that holds many. The person opens one at a time. */
function Threads({ threads, fileName, onOpen, onCancel }: { threads: ThreadChoice[]; fileName: string; onOpen: (key: string) => void; onCancel: () => void }) {
  const [search, setSearch] = useState('');
  const [shown, setShown] = useState(100);
  const wanted = search.trim().toLowerCase().replace(/\s+/g, '');
  const matching = threads.filter((thread) => thread.name.toLowerCase().replace(/\s+/g, '').includes(wanted));
  return (
    <section className="panel panel-wide" data-section="import-threads" data-thread-count={threads.length}>
      <h2>{threads.length === 1 ? '1 conversation' : `${threads.length.toLocaleString()} conversations`} found</h2>
      <p>
        Echo found these in <strong>{fileName}</strong>. Nothing has been imported. Open one to check it and choose who may hear it, then come back
        for the next. The biggest are first.
      </p>
      <div className="field">
        <label className="label" htmlFor="thread-search">
          Find a conversation
        </label>
        <input id="thread-search" type="text" value={search} onChange={(event) => { setSearch(event.target.value); setShown(100); }} autoComplete="off" />
      </div>
      <ul className="people">
        {matching.slice(0, shown).map((thread) => (
          <li key={thread.key} data-thread={thread.name}>
            <div className="person-head">
              <strong>{thread.name}</strong>
              <span className="status">{thread.messages !== undefined ? `${thread.messages.toLocaleString()} messages` : megabytes(thread.bytes)}</span>
            </div>
            <div className="actions">
              <button type="button" className="button-quiet" data-action="thread-open" onClick={() => onOpen(thread.key)}>
                Look at this one
              </button>
            </div>
          </li>
        ))}
      </ul>
      <div className="actions">
        {matching.length > shown && (
          <button type="button" className="button-quiet" onClick={() => setShown(shown + 100)}>
            Show more
          </button>
        )}
        <button type="button" className="button-quiet" data-action="threads-close" onClick={onCancel}>
          Back to my conversations
        </button>
      </div>
    </section>
  );
}

/** The addresses a mailbox's email was sent from. The owner ticks the ones that are theirs. */
function Addresses({ mailbox, onChosen, onCancel }: { mailbox: MailboxFound; onChosen: (mine: string[]) => void; onCancel: () => void }) {
  const [mine, setMine] = useState<string[]>(mailbox.suggested);
  return (
    <section className="panel panel-wide" data-section="import-addresses" data-address-count={mailbox.addresses.length}>
      <h2>Which of these addresses are yours?</h2>
      <p>
        Echo found {mailbox.emails.toLocaleString()} emails in <strong>{mailbox.fileName}</strong>. It has only looked at who each one is from and
        to. Tick every address that is you. Only emails sent from those are read; everyone else's emails are left alone and not kept.
      </p>
      {mailbox.suggested.length > 0 && <p className="hint">Echo has ticked the ones it thinks are yours. Check they are right.</p>}
      <form
        onSubmit={(event) => {
          event.preventDefault();
          onChosen(mine);
        }}
      >
        <fieldset className="field choice">
          <legend className="label">Addresses email was sent from, most first</legend>
          {mailbox.addresses.map((sender) => (
            <label key={sender.address} className="choice-option">
              <input
                type="checkbox"
                data-address={sender.address}
                checked={mine.includes(sender.address)}
                onChange={(event) => setMine(event.target.checked ? [...mine, sender.address] : mine.filter((address) => address !== sender.address))}
              />
              <span>
                <strong>{sender.address}</strong>
                {sender.name ? ` · ${sender.name}` : ''} · {sender.count.toLocaleString()} emails
              </span>
            </label>
          ))}
        </fieldset>
        <div className="actions">
          <button type="submit" className="button" data-action="addresses-save" disabled={mine.length === 0}>
            These are mine
          </button>
          <button type="button" className="button-quiet" data-action="addresses-cancel" onClick={onCancel}>
            Back to my conversations
          </button>
        </div>
      </form>
    </section>
  );
}

/** The iPhone backups on this computer, and how to make one. */
function Backups({
  backups,
  locked,
  busy,
  onOpen,
  onUnlock,
  onCancel,
}: {
  backups: IphoneBackup[];
  /** The backup that turned out to be encrypted and is waiting for its password. */
  locked: string | null;
  busy: boolean;
  onOpen: (folder: string | null) => void;
  onUnlock: (folder: string, password: string) => void;
  onCancel: () => void;
}) {
  const [password, setPassword] = useState('');
  return (
    <section className="panel panel-wide" data-section="import-backups" data-backup-count={backups.length}>
      <h2>iPhone texts and iMessages</h2>
      <p>
        Apple gives no way to export your messages. The only route is a backup of your iPhone made on this computer, which Echo then reads. Echo
        opens the backup read-only where it is: nothing in it is changed and nothing is copied out of it.
      </p>
      <h3 className="group-head">Making a backup</h3>
      <ol>
        <li>Install Apple Devices from the Microsoft Store, or iTunes.</li>
        <li>Plug the iPhone into this computer with its cable, and tap Trust on the phone.</li>
        <li>Press Back Up Now. "Encrypt local backup" can be ticked or not: Echo reads both.</li>
      </ol>
      <p className="hint">
        If the backup turns out to have few or no messages in it, they may be kept in iCloud and left out of the backup. A backup that is not
        encrypted holds your messages in a form anyone using this computer could read, so an encrypted one is the safer kind to keep.
      </p>

      <h3 className="group-head">{backups.length === 0 ? 'Echo found no backups on this computer' : 'Backups on this computer'}</h3>
      <ul className="people">
        {backups.map((backup) => (
          <li key={backup.folder} data-backup={backup.device}>
            <div className="person-head">
              <strong>{backup.device || 'An iPhone'}</strong>
              {backup.madeAt && <span className="status">backed up {moment(backup.madeAt)}</span>}
            </div>
            <p className="person-line">
              <code>{backup.folder}</code>
            </p>
            {locked === backup.folder ? (
              <form
                className="field"
                data-backup-locked
                onSubmit={(event) => {
                  event.preventDefault();
                  onUnlock(backup.folder, password);
                }}
              >
                <label className="label" htmlFor="backup-password">
                  The password for this backup
                </label>
                <p className="hint">
                  The one you chose when you ticked "Encrypt local backup". It is not your iPhone passcode or your Apple password. Echo uses it to
                  unlock the backup and does not keep it.
                </p>
                <input id="backup-password" type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="off" disabled={busy} />
                <div className="actions">
                  <button type="submit" className="button" data-action="backup-unlock" disabled={busy || password.length === 0}>
                    {busy ? 'Unlocking…' : 'Unlock this backup'}
                  </button>
                </div>
                {busy && <p className="hint">Apple makes this slow on purpose. It can take up to a minute.</p>}
              </form>
            ) : (
              <div className="actions">
                <button type="button" className="button" data-action="backup-open" onClick={() => onOpen(backup.folder)} disabled={busy}>
                  Read the conversations in this backup
                </button>
              </div>
            )}
          </li>
        ))}
      </ul>
      <div className="actions">
        <button type="button" className="button-quiet" data-action="backup-browse" onClick={() => onOpen(null)}>
          Choose a backup folder myself
        </button>
        <button type="button" className="button-quiet" data-action="backups-close" onClick={onCancel}>
          Back to my conversations
        </button>
      </div>
    </section>
  );
}

/** One imported conversation, with the owner's words and other people's kept visibly apart. */
function Conversation({ summary, people, onClose, onRemoved }: { summary: ImportSummary; people: readonly Person[]; onClose: () => void; onRemoved: () => Promise<void> }) {
  const [offset, setOffset] = useState(Math.max(0, summary.mine + summary.others - PAGE));
  const [page, setPage] = useState<{ messages: ImportedMessage[]; total: number } | null>(null);
  const [removing, setRemoving] = useState(false);

  useEffect(() => {
    void window.echo.imports.messages(summary.id, offset, PAGE).then(setPage);
  }, [summary.id, offset]);

  if (!page) return null;

  return (
    <section className="panel panel-wide" data-section="import-conversation" data-import-total={page.total}>
      <h2>
        {SERVICE_NAMES[summary.service]} with {summary.label}
      </h2>
      <p className="hint">
        {summary.mine.toLocaleString()} messages from you, which your echo may draw on for: {heardBy(summary.audience, people)}.{' '}
        {summary.others.toLocaleString()} from other people.
      </p>
      <p className="warning">
        <strong>Other people's words are locked to this computer.</strong> They are shown here so you can read the conversation. Your echo is never
        given them, they are never sent anywhere, and a reply that repeated them would be thrown away.
      </p>

      <div className="actions">
        <button type="button" className="button-quiet" data-action="import-older" onClick={() => setOffset(Math.max(0, offset - PAGE))} disabled={offset === 0}>
          Earlier
        </button>
        <span className="status">
          {page.messages.length === 0 ? 'No messages' : `${(offset + 1).toLocaleString()} to ${(offset + page.messages.length).toLocaleString()} of ${page.total.toLocaleString()}`}
        </span>
        <button type="button" className="button-quiet" data-action="import-newer" onClick={() => setOffset(offset + PAGE)} disabled={offset + PAGE >= page.total}>
          Later
        </button>
      </div>

      <ol className="imported" data-import-messages-list>
        {page.messages.map((message, index) => (
          <li key={offset + index} className={message.thirdParty ? 'imported-theirs' : 'imported-mine'} data-imported={message.thirdParty ? 'theirs' : 'mine'}>
            <span className="status">
              {message.thirdParty ? `${message.sender} · someone else's words` : 'You'} · {moment(message.at)}
            </span>
            <p>{message.text}</p>
          </li>
        ))}
      </ol>

      <div className="actions">
        <button type="button" className="button-quiet" data-action="import-close" onClick={onClose}>
          Back to my conversations
        </button>
      </div>
      <div className="remove-row">
        {removing ? (
          <div className="actions">
            <span className="remove-warning">This deletes the whole conversation from your archive, and what your echo learned from it.</span>
            <button
              type="button"
              className="button button-stop"
              data-action="import-remove-confirm"
              onClick={() => void window.echo.imports.remove(summary.id).then(onRemoved)}
            >
              Delete this conversation
            </button>
            <button type="button" className="button-quiet" onClick={() => setRemoving(false)}>
              Keep it
            </button>
          </div>
        ) : (
          <button type="button" className="button-quiet" data-action="import-remove" onClick={() => setRemoving(true)}>
            Delete this conversation
          </button>
        )}
      </div>
    </section>
  );
}

export function MessagesScreen({
  onBack,
  onOpenStyle,
  onOpenLetters,
  fromTray,
  onTrayOpened,
}: {
  onBack: () => void;
  onOpenStyle: () => void;
  onOpenLetters: () => void;
  /** A file the assistant pointed out, to open through the normal import as soon as this screen appears. */
  fromTray?: { id: string; service: TrayService } | null;
  onTrayOpened?: () => void;
}) {
  const [imports, setImports] = useState<ImportSummary[] | null>(null);
  const [people, setPeople] = useState<Person[]>([]);
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [download, setDownload] = useState<{ threads: ThreadChoice[]; fileName: string } | null>(null);
  const [mailbox, setMailbox] = useState<MailboxFound | null>(null);
  const [reading, setReading] = useState(false);
  const [backups, setBackups] = useState<IphoneBackup[] | null>(null);
  const [lockedBackup, setLockedBackup] = useState<string | null>(null);
  const [unlocking, setUnlocking] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const [problems, setProblems] = useState<string[]>([]);
  const [justImported, setJustImported] = useState(false);

  async function refresh() {
    const [latest, latestPeople] = await Promise.all([window.echo.imports.list(), window.echo.people.list()]);
    setImports(latest);
    setPeople(latestPeople);
  }

  useEffect(() => {
    void refresh();
  }, []);

  // Arriving from the assistant's tray: the file it pointed out is opened through the same import and preview as any other.
  useEffect(() => {
    if (!fromTray) return;
    onTrayOpened?.();
    setProblems([]);
    setReading(fromTray.service === 'email');
    void window.echo.door.openFile(fromTray.id, fromTray.service).then((result) => {
      setReading(false);
      show(result);
    });
  }, [fromTray]);

  if (!imports) return null;

  /** Shows whatever choosing a file gave back: one conversation to check, a list to pick from, or what went wrong. */
  function show(result: ImportChosen) {
    if (!result.ok) setProblems(result.problems);
    else if ('preview' in result) setPreview(result.preview);
    else if ('mailbox' in result) setMailbox(result.mailbox);
    else {
      setMailbox(null);
      setDownload({ threads: result.threads, fileName: result.fileName });
    }
  }

  async function choose(service: ImportService) {
    setProblems([]);
    setJustImported(false);
    setDownload(null);
    setMailbox(null);
    setReading(service === 'email');
    const result = await window.echo.imports.choose(service);
    setReading(false);
    show(result);
  }

  async function showBackups() {
    setProblems([]);
    setJustImported(false);
    setDownload(null);
    setBackups(await window.echo.imports.iphoneBackups());
  }

  async function openBackup(folder: string | null, password?: string) {
    setProblems([]);
    setUnlocking(password !== undefined);
    const result = await window.echo.imports.chooseBackup(folder, password);
    setUnlocking(false);
    if (result.ok) {
      setBackups(null);
      setLockedBackup(null);
    } else if (result.needsPassword && result.folder) {
      // Encrypted: ask for the password under that backup. One picked by hand is added to the list so there is somewhere to ask.
      const locked = result.folder;
      setLockedBackup(locked);
      setBackups((current) => (current && !current.some((backup) => backup.folder === locked) ? [{ folder: locked, device: '', madeAt: null }, ...current] : current));
    } else {
      // Not something a password would fix, so stop asking for one.
      setLockedBackup(null);
    }
    show(result);
  }

  async function openThread(key: string) {
    setProblems([]);
    setJustImported(false);
    show(await window.echo.imports.openThread(key));
  }

  const opened = imports.find((summary) => summary.id === open);
  const mode = preview ? 'preview' : mailbox ? 'addresses' : download ? 'threads' : backups ? 'backups' : opened ? 'conversation' : 'list';

  return (
    <div data-screen="messages" data-mode={mode} data-import-count={imports.length}>
      <div className="actions back-row">
        <button type="button" className="button-quiet" data-action="back-home" onClick={onBack}>
          Back to home
        </button>
      </div>

      {preview && (
        <Preview
          preview={preview}
          people={people}
          onDone={async () => {
            setPreview(null);
            setJustImported(true);
            await refresh();
          }}
          onCancel={() => setPreview(null)}
        />
      )}

      {!preview && mailbox && (
        <>
          <Problems problems={problems} />
          <Addresses
            mailbox={mailbox}
            onChosen={async (mine) => {
              setProblems([]);
              show(await window.echo.imports.emailAddresses(mine));
            }}
            onCancel={() => setMailbox(null)}
          />
        </>
      )}

      {!preview && !mailbox && download && (
        <>
          <Problems problems={problems} />
          {justImported && (
            <p className="saved" data-import-done>
              Imported. Pick the next conversation, or go back.
            </p>
          )}
          <Threads threads={download.threads} fileName={download.fileName} onOpen={(key) => void openThread(key)} onCancel={() => setDownload(null)} />
        </>
      )}

      {!preview && !mailbox && !download && backups && (
        <>
          <Problems problems={problems} />
          <Backups
            backups={backups}
            locked={lockedBackup}
            busy={unlocking}
            onOpen={(folder) => void openBackup(folder)}
            onUnlock={(folder, password) => void openBackup(folder, password)}
            onCancel={() => {
              setBackups(null);
              setLockedBackup(null);
            }}
          />
        </>
      )}

      {!preview && !mailbox && !download && !backups && opened && (
        <Conversation
          key={opened.id}
          summary={opened}
          people={people}
          onClose={() => setOpen(null)}
          onRemoved={async () => {
            setOpen(null);
            await refresh();
          }}
        />
      )}

      {mode === 'list' && (
        <>
          <section className="panel">
            <h2>Messages and letters</h2>
            <p>
              Your own messages are the best record there is of how you really talk. Echo reads a conversation you exported, keeps your words for
              your echo, and locks everyone else's words to this computer.
            </p>
            <h3 className="group-head">Getting a WhatsApp chat onto this computer</h3>
            <ol>
              <li>On your phone, open the chat in WhatsApp.</li>
              <li>iPhone: tap the name at the top, scroll down, tap Export Chat. Android: tap the three dots, More, Export chat.</li>
              <li>Choose "Without media". Echo only reads the words.</li>
              <li>Send the file to yourself and save it on this computer.</li>
            </ol>
            <p className="hint">
              The file WhatsApp makes is not encrypted. Once it is imported, delete it from this computer and from wherever you sent it.
            </p>
            <div className="actions">
              <button type="button" className="button" data-action="import-choose" onClick={() => void choose('whatsapp')}>
                Import a WhatsApp chat
              </button>
            </div>

            <h3 className="group-head">Getting your Messenger conversations onto this computer</h3>
            <p>Meta keeps them in two places, so there are two downloads. Do both to get old and new messages.</p>
            <ol>
              <li>
                <strong>Older and unencrypted chats.</strong> In Facebook, open Accounts Center, then Your information and permissions, then Export
                your information. Choose Download to device, tick Messages, and set the format to <strong>JSON</strong>, not HTML. Meta tells you when
                the ZIP is ready.
              </li>
              <li>
                <strong>End-to-end encrypted chats.</strong> On a computer, open Messenger.com, click your profile photo, then Privacy and safety,
                End-to-end encrypted chats, Message storage, Download secure storage data.
              </li>
            </ol>
            <p className="hint">
              Give Echo either ZIP as it is. Echo lists the conversations inside and you import the ones you want, one at a time. These files are not
              encrypted either: delete them once you have what you want.
            </p>
            <Problems problems={problems} />
            <div className="actions">
              <button type="button" className="button" data-action="import-choose-messenger" onClick={() => void choose('messenger')}>
                Import from Messenger
              </button>
            </div>

            <h3 className="group-head">iPhone texts and iMessages</h3>
            <p>These come from a backup of your iPhone made on this computer. Echo shows you how.</p>
            <div className="actions">
              <button type="button" className="button" data-action="import-choose-iphone" onClick={() => void showBackups()}>
                Import iPhone texts
              </button>
            </div>

            <h3 className="group-head">Getting your Discord messages onto this computer</h3>
            <ol>
              <li>In Discord, open User Settings (the cog), then Data &amp; Privacy, and find "Request your data".</li>
              <li>Press Request Data, make sure Messages is ticked, and send the request.</li>
              <li>Discord emails you a link to a ZIP. It says this can take up to 30 days, and the link works for 30 days.</li>
            </ol>
            <p className="hint">
              Discord's package holds only what you sent, not what anyone said to you, so your echo gets your side with no replies around it. Give
              Echo the ZIP as it is and import the conversations you want, one at a time. The ZIP is not encrypted: delete it once you have what you
              want.
            </p>
            <div className="actions">
              <button type="button" className="button" data-action="import-choose-discord" onClick={() => void choose('discord')}>
                Import from Discord
              </button>
            </div>

            <h3 className="group-head">Getting your email onto this computer</h3>
            <p>Echo reads a mailbox file, the kind whose name ends in .mbox. From Gmail:</p>
            <ol>
              <li>Open Google Takeout (takeout.google.com), press Deselect all, then tick Mail.</li>
              <li>
                Press "All Mail data included", untick "Include all messages in Mail", and tick only <strong>Sent</strong>. That keeps the file small
                and leaves other people's emails out of it.
              </li>
              <li>Carry on to the end and ask for the export. Google emails you a link to a ZIP.</li>
              <li>Unzip it (right-click, Extract All). The mailbox file is inside: its name ends in .mbox.</li>
            </ol>
            <p className="hint">
              Echo reads only the emails you sent. Anything you quoted from someone else's email is cut off before your words are kept, and nobody
              else's email is stored. The mailbox file is not encrypted: delete it, and the ZIP, once you have what you want. Outlook's own export
              (a .pst file) is not something Echo can read.
            </p>
            <div className="actions">
              <button type="button" className="button" data-action="import-choose-email" onClick={() => void choose('email')} disabled={reading}>
                {reading ? 'Reading the mailbox…' : 'Import email'}
              </button>
            </div>
            {reading && <p className="hint">A big mailbox can take a few minutes. Echo is only looking at who each email is from and to.</p>}

            <h3 className="group-head">Letters you wrote</h3>
            <p>Photograph or scan a letter you wrote, have Echo read the words, and correct them by hand against the page.</p>
            <div className="actions">
              <button type="button" className="button" data-action="open-letters" onClick={onOpenLetters}>
                Letters you wrote
              </button>
            </div>
          </section>

          {justImported && (
            <div className="saved" data-import-done>
              <p>
                Imported. Your words from it are now in what your echo remembers. Your style profile was drafted before this, so draft it again to
                let it learn from them.
              </p>
              <div className="actions">
                <button type="button" className="button-quiet" data-action="import-open-style" onClick={onOpenStyle}>
                  Open my style profile
                </button>
              </div>
            </div>
          )}

          <section className="panel">
            <h2>{imports.length === 0 ? 'Nothing imported yet' : imports.length === 1 ? '1 conversation' : `${imports.length} conversations`}</h2>
            <ul className="people">
              {imports.map((summary) => (
                <li key={summary.id} data-import={summary.label}>
                  <div className="person-head">
                    <strong>{summary.label}</strong>
                    <span className="status">{SERVICE_NAMES[summary.service]}</span>
                    <span className="status" data-import-heard-by={summary.audience === null ? 'nobody' : summary.audience.kind}>
                      {heardBy(summary.audience, people)}
                    </span>
                  </div>
                  <p className="person-line" data-import-counts>
                    {summary.mine.toLocaleString()} from you ·{' '}
                    {summary.service === 'discord'
                      ? 'only your side is in a Discord package'
                      : summary.service === 'email'
                        ? 'only the emails you sent are kept'
                        : `${summary.others.toLocaleString()} from other people`}{' '}
                    ·{' '}
                    {day(summary.from)} to {day(summary.to)}
                  </p>
                  <div className="actions">
                    <button type="button" className="button-quiet" data-action="import-open" onClick={() => setOpen(summary.id)}>
                      Open
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          </section>
        </>
      )}
    </div>
  );
}
