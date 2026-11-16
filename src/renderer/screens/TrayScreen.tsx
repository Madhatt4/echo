import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { TRAY_SERVICES } from '../../shared/door.ts';
import type { TrayItem, TrayService } from '../../shared/door.ts';
import { SERVICE_NAMES } from '../../shared/imports.ts';
import type { ChatSession } from '../../shared/chat.ts';
import type { Note } from '../../shared/notes.ts';
import { audienceLabel } from '../../shared/people.ts';
import type { Audience, Person } from '../../shared/people.ts';
import { AudiencePicker } from './AudiencePicker.tsx';
import { Problems } from './Problems.tsx';

function when(iso: string): string {
  return new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

/** A file the assistant pointed out. Opening it goes through the normal import, with its preview. */
function FileItem({ item, onOpen, onDiscard }: { item: Extract<TrayItem, { kind: 'file' }>; onOpen: (service: TrayService) => void; onDiscard: () => void }) {
  return (
    <li data-tray-item="file">
      <div className="person-head">
        <strong>A file your assistant thinks is worth importing</strong>
        <span className="status">left {when(item.at)}</span>
      </div>
      <p className="person-line">
        <code data-tray-path>{item.path}</code>
      </p>
      {item.note && (
        <p className="person-line" data-tray-note>
          Your assistant says: {item.note}
        </p>
      )}
      <p className="hint">
        Echo has not read this file. Opening it shows you what is in it first, exactly as if you had chosen the file yourself, and nothing is kept
        unless you then save it.
        {item.service ? ` Your assistant thinks it is a ${SERVICE_NAMES[item.service]} export.` : ''}
      </p>
      <div className="actions">
        {TRAY_SERVICES.map((service) => (
          <button
            key={service}
            type="button"
            className={service === item.service ? 'button' : 'button-quiet'}
            data-action={`tray-open-${service}`}
            onClick={() => onOpen(service)}
          >
            Open it as {SERVICE_NAMES[service]}
          </button>
        ))}
        <button type="button" className="button-quiet" data-action="tray-discard" onClick={onDiscard}>
          Take it out of the tray
        </button>
      </div>
    </li>
  );
}

/** A draft the assistant wrote up. It becomes the person's only if they read it, put it right, and say so. */
function WordsItem({ item, people, onDone, onDiscard }: { item: Extract<TrayItem, { kind: 'words' }>; people: readonly Person[]; onDone: () => Promise<void>; onDiscard: () => void }) {
  const [title, setTitle] = useState(item.title);
  const [words, setWords] = useState(item.text);
  const [audience, setAudience] = useState<Audience>({ kind: 'everyone' });
  const [mine, setMine] = useState(false);
  const [problems, setProblems] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  async function save(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setProblems([]);
    const result = await window.echo.door.approveWords(item.id, { title, text: words, audience, mine });
    setBusy(false);
    if (result.ok) await onDone();
    else setProblems(result.problems);
  }

  return (
    <li data-tray-item="words">
      <div className="person-head">
        <strong>Something your assistant wrote up as yours</strong>
        <span className="status">left {when(item.at)}</span>
      </div>
      {item.note && (
        <p className="person-line" data-tray-note>
          Your assistant says: {item.note}
        </p>
      )}
      <p className="warning">
        <strong>Your assistant wrote this, not you.</strong> If you keep it, your echo will treat every word as yours. Read it, change anything that
        is not how you would say it or is not true, and only then keep it.
      </p>
      <form onSubmit={(event) => void save(event)}>
        <div className="field">
          <label className="label" htmlFor={`tray-title-${item.id}`}>
            Title
          </label>
          <input id={`tray-title-${item.id}`} data-tray-title type="text" value={title} onChange={(event) => setTitle(event.target.value)} autoComplete="off" />
        </div>
        <div className="field">
          <label className="label" htmlFor={`tray-text-${item.id}`}>
            The words
          </label>
          <textarea id={`tray-text-${item.id}`} data-tray-text rows={10} value={words} onChange={(event) => setWords(event.target.value)} />
        </div>
        <AudiencePicker id={`tray-audience-${item.id}`} audience={audience} people={people} onChange={setAudience} />
        <label className="choice-option">
          <input type="checkbox" data-tray-mine checked={mine} onChange={(event) => setMine(event.target.checked)} />
          <span>
            <strong>I have read this and these are my words.</strong>
          </span>
        </label>
        <Problems problems={problems} />
        <div className="actions">
          <button type="submit" className="button" data-action="tray-approve" disabled={busy}>
            {busy ? 'Saving…' : 'Keep it as mine'}
          </button>
          <button type="button" className="button-quiet" data-action="tray-discard" onClick={onDiscard} disabled={busy}>
            Throw it away
          </button>
        </div>
      </form>
    </li>
  );
}

export function TrayScreen({ onBack, onOpenFile }: { onBack: () => void; onOpenFile: (id: string, service: TrayService) => void }) {
  const [tray, setTray] = useState<TrayItem[] | null>(null);
  const [notes, setNotes] = useState<Note[]>([]);
  const [asked, setAsked] = useState<ChatSession[]>([]);
  const [people, setPeople] = useState<Person[]>([]);
  const [removing, setRemoving] = useState<string | null>(null);

  async function refresh() {
    const [latestTray, latestNotes, latestPeople, latestAsked] = await Promise.all([
      window.echo.door.tray(),
      window.echo.door.notes(),
      window.echo.people.list(),
      window.echo.door.conversations(),
    ]);
    setAsked(latestAsked);
    setTray(latestTray);
    setNotes(latestNotes);
    setPeople(latestPeople);
  }

  useEffect(() => {
    void refresh();
  }, []);

  if (!tray) return null;

  const discard = async (id: string) => {
    await window.echo.door.discard(id);
    await refresh();
  };

  return (
    <div data-screen="tray" data-tray-count={tray.length} data-note-count={notes.length} data-asked-count={asked.length}>
      <div className="actions back-row">
        <button type="button" className="button-quiet" data-action="back-home" onClick={onBack}>
          Back
        </button>
      </div>

      <section className="panel panel-wide">
        <h2>From your assistant</h2>
        <p>
          Your assistant cannot add anything to your archive. It can only leave things here. Each one is yours to keep or throw away, and nothing
          here is part of your echo until you have dealt with it.
        </p>
        {tray.length === 0 ? (
          <p className="hint">Nothing is waiting.</p>
        ) : (
          <ul className="people">
            {tray.map((item) =>
              item.kind === 'file' ? (
                <FileItem key={item.id} item={item} onOpen={(service) => onOpenFile(item.id, service)} onDiscard={() => void discard(item.id)} />
              ) : (
                <WordsItem key={item.id} item={item} people={people} onDone={refresh} onDiscard={() => void discard(item.id)} />
              ),
            )}
          </ul>
        )}
      </section>

      {asked.length > 0 && (
        <section className="panel panel-wide" data-section="assistant-asked">
          <h2>What your assistant asked your echo</h2>
          <p className="hint">
            Your assistant talks to your echo as itself, not as one of your family. These are its conversations, newest first. You can read them;
            you cannot change them. "Delete all conversations" in Setup deletes these too.
          </p>
          {asked.slice(0, 20).map((session) => (
            <div key={session.startedAt} className="conversation" data-asked-session>
              <p className="status">Started {when(session.startedAt)}</p>
              {session.messages.map((message) => (
                <p key={message.id} className="person-line" data-asked-role={message.role}>
                  <strong>{message.role === 'echo' ? 'Your echo' : 'Your assistant'}:</strong> {message.text}
                </p>
              ))}
            </div>
          ))}
          {asked.length > 20 && <p className="hint">Only the latest 20 conversations are shown here. All of them are in a copy of your archive.</p>}
        </section>
      )}

      {notes.length > 0 && (
        <section className="panel panel-wide" data-section="approved-notes">
          <h2>What you have kept from your assistant</h2>
          <p className="hint">These are now your words, and your echo may draw on them. Removing one takes it out of your echo straight away.</p>
          <ul className="people">
            {notes.map((note) => (
              <li key={note.id} data-note={note.title}>
                <div className="person-head">
                  <strong>{note.title}</strong>
                  <span className="status">
                    kept {when(note.approvedAt)} · {audienceLabel(note.audience, people)}
                  </span>
                </div>
                <p className="person-line advice-preview">{note.text.length > 240 ? `${note.text.slice(0, 240)}…` : note.text}</p>
                <div className="remove-row">
                  {removing === note.id ? (
                    <>
                      <span className="remove-warning">This deletes it from your archive for good.</span>
                      <button
                        type="button"
                        className="button button-stop"
                        data-action="note-remove-confirm"
                        onClick={() => void window.echo.door.removeNote(note.id).then(refresh)}
                      >
                        Yes, remove it
                      </button>
                      <button type="button" className="button-quiet" onClick={() => setRemoving(null)}>
                        Keep it
                      </button>
                    </>
                  ) : (
                    <button type="button" className="button-quiet" data-action="note-remove" onClick={() => setRemoving(note.id)}>
                      Remove
                    </button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
