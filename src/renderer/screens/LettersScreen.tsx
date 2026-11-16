import { useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { MAX_LETTER_PAGES, PAGE_LONGEST_SIDE, UNREAD, unreadCount } from '../../shared/letters.ts';
import type { Letter } from '../../shared/letters.ts';
import { audienceLabel } from '../../shared/people.ts';
import type { Audience, Person } from '../../shared/people.ts';
import { AudiencePicker } from './AudiencePicker.tsx';
import { Problems } from './Problems.tsx';

interface Page {
  bytes: Uint8Array;
  mimeType: string;
  url: string;
}

/**
 * Makes a photo small enough to keep and to send: the longest side is brought
 * down to PAGE_LONGEST_SIDE and it is saved as a JPEG. Null if it cannot be opened.
 */
async function shrink(file: Blob): Promise<{ bytes: Uint8Array; mimeType: string } | null> {
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, PAGE_LONGEST_SIDE / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const context = canvas.getContext('2d');
    if (!context) return null;
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.85));
    return blob ? { bytes: new Uint8Array(await blob.arrayBuffer()), mimeType: 'image/jpeg' } : null;
  } catch {
    return null;
  }
}

function pictureUrl(bytes: Uint8Array, mimeType: string): string {
  return URL.createObjectURL(new Blob([new Uint8Array(bytes)], { type: mimeType }));
}

/** The pictures of a saved letter's pages, decrypted only for as long as they are on screen. */
function SavedPages({ letter }: { letter: Letter }) {
  const [urls, setUrls] = useState<string[]>([]);
  useEffect(() => {
    let made: string[] = [];
    let gone = false;
    void (async () => {
      const found: string[] = [];
      for (let page = 0; page < letter.pages; page += 1) {
        const picture = await window.echo.letters.page(letter.id, page);
        if (picture) found.push(pictureUrl(picture.bytes, picture.mimeType));
      }
      made = found;
      if (gone) found.forEach((url) => URL.revokeObjectURL(url));
      else setUrls(found);
    })();
    return () => {
      gone = true;
      made.forEach((url) => URL.revokeObjectURL(url));
    };
  }, [letter.id, letter.pages]);
  if (urls.length === 0) return null;
  return (
    <div className="letter-pages" data-saved-pages={urls.length}>
      {urls.map((url, index) => (
        <img key={url} className="letter-page" src={url} alt={`Page ${index + 1} of the letter`} />
      ))}
    </div>
  );
}

function LetterForm({
  people,
  existing,
  onDone,
  onCancel,
}: {
  people: readonly Person[];
  /** The letter being changed. Absent when adding a new one. */
  existing?: Letter;
  onDone: () => Promise<void>;
  onCancel: () => void;
}) {
  const [mine, setMine] = useState(existing !== undefined);
  const [pages, setPages] = useState<Page[]>([]);
  const [title, setTitle] = useState(existing?.title ?? '');
  const [personId, setPersonId] = useState(existing?.personId ?? '');
  const [writtenOn, setWrittenOn] = useState(existing?.writtenOn ?? '');
  const [words, setWords] = useState(existing?.text ?? '');
  const [audience, setAudience] = useState<Audience>(existing?.audience ?? { kind: 'everyone' });
  const [checked, setChecked] = useState(false);
  const [problems, setProblems] = useState<string[]>([]);
  const [reading, setReading] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [removing, setRemoving] = useState(false);

  // The pictures on screen are let go of when the form closes.
  const shown = useRef<Page[]>([]);
  shown.current = pages;
  useEffect(() => () => shown.current.forEach((page) => URL.revokeObjectURL(page.url)), []);

  async function addPage(file: File | undefined) {
    if (!file) return;
    setProblems([]);
    if (pages.length >= MAX_LETTER_PAGES) {
      setProblems([`Keep a letter to ${MAX_LETTER_PAGES} pages. Split a longer one into parts.`]);
      return;
    }
    const picture = await shrink(file);
    if (!picture) {
      setProblems(['Echo could not open that picture. It reads JPEG, PNG and WebP pictures. An iPhone photo saved as HEIC needs saving as a JPEG first.']);
      return;
    }
    setPages((current) => [...current, { ...picture, url: pictureUrl(picture.bytes, picture.mimeType) }]);
  }

  async function read(index: number) {
    const page = pages[index];
    if (!page) return;
    setProblems([]);
    setReading(index);
    const result = await window.echo.letters.readPage(page.bytes, page.mimeType);
    setReading(null);
    if (!result.ok) {
      setProblems(result.problems);
      return;
    }
    // What was read is a first go. It has to be checked again before the letter can be saved.
    setWords((current) => (current.trim().length > 0 ? `${current.trimEnd()}\n\n${result.text}` : result.text));
    setChecked(false);
  }

  async function save(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setProblems([]);
    const details = { title, personId: personId === '' ? null : personId, writtenOn, text: words, audience, mine, checked };
    const result = existing
      ? await window.echo.letters.change(existing.id, details)
      : await window.echo.letters.add(details, pages.map((page) => ({ bytes: page.bytes, mimeType: page.mimeType })));
    setBusy(false);
    if (result.ok) await onDone();
    else setProblems(result.problems);
  }

  async function remove() {
    if (!existing) return;
    await window.echo.letters.remove(existing.id);
    await onDone();
  }

  const unread = unreadCount(words);

  return (
    <section className="panel panel-wide" data-section="letter-form" data-letter-editing={existing ? 'yes' : 'no'} data-page-count={pages.length}>
      <h2>{existing ? 'Change this letter' : 'Add a letter you wrote'}</h2>
      <form onSubmit={(event) => void save(event)}>
        {!existing && (
          <label className="choice-option">
            <input id="letter-mine" type="checkbox" checked={mine} onChange={(event) => setMine(event.target.checked)} />
            <span>
              <strong>I wrote this letter myself.</strong> Echo only keeps letters you wrote. A letter someone wrote to you is their words, and is
              not for your echo.
            </span>
          </label>
        )}

        {existing ? (
          <SavedPages letter={existing} />
        ) : (
          <div className="field">
            <label className="label" htmlFor="letter-page-file">
              Photos or scans of the pages
            </label>
            <p className="hint">
              Add one picture for each page, in order. Flat, in good light, the whole page in the frame. The pictures are kept encrypted with the
              letter. You can also skip this and type the letter.
            </p>
            <input
              id="letter-page-file"
              type="file"
              accept="image/jpeg,image/png,image/webp"
              onChange={(event) => {
                const input = event.currentTarget;
                void addPage(input.files?.[0]).then(() => {
                  input.value = '';
                });
              }}
            />
            {pages.length > 0 && (
              <ul className="letter-pages">
                {pages.map((page, index) => (
                  <li key={page.url} data-page={index + 1}>
                    <img className="letter-page" src={page.url} alt={`Page ${index + 1} of the letter`} />
                    <div className="actions">
                      <button type="button" className="button" data-action="page-read" onClick={() => void read(index)} disabled={!mine || reading !== null}>
                        {reading === index ? 'Reading…' : `Read page ${index + 1} for me`}
                      </button>
                      <button
                        type="button"
                        className="button-quiet"
                        data-action="page-remove"
                        disabled={reading !== null}
                        onClick={() => {
                          URL.revokeObjectURL(page.url);
                          setPages((current) => current.filter((_page, at) => at !== index));
                        }}
                      >
                        Take this picture out
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
            {pages.length > 0 && (
              <p className="hint" data-read-warning>
                Reading sends that picture to Anthropic under your AI key, and puts the words it finds in the box below for you to correct. Only do
                it for a letter you wrote. {!mine && <strong>Tick the box at the top first.</strong>}
              </p>
            )}
          </div>
        )}

        <div className="field">
          <label className="label" htmlFor="letter-text">
            The words of the letter
          </label>
          <p className="hint">
            Exactly as you wrote them. Where Echo could not read a word it puts {UNREAD}: type what the letter says there. Your echo will treat
            every word here as yours, so read it through against the page.
          </p>
          <textarea id="letter-text" rows={14} value={words} data-unread={unread} onChange={(event) => setWords(event.target.value)} />
          {unread > 0 && (
            <p className="warning" data-unread-warning>
              {unread === 1 ? 'One place is' : `${unread} places are`} still marked {UNREAD}.
            </p>
          )}
        </div>

        <div className="field">
          <label className="label" htmlFor="letter-title">
            What do you call this letter?
          </label>
          <p className="hint">A few words to find it by: To Julie before the wedding, Letter from the oil rig.</p>
          <input id="letter-title" type="text" value={title} onChange={(event) => setTitle(event.target.value)} autoComplete="off" />
        </div>

        <div className="field">
          <label className="label" htmlFor="letter-to">
            Who was it to?
          </label>
          <select id="letter-to" value={personId} onChange={(event) => setPersonId(event.target.value)}>
            <option value="">Someone not in my list, or nobody in particular</option>
            {people.map((person) => (
              <option key={person.id} value={person.id}>
                {person.name}
              </option>
            ))}
          </select>
        </div>

        <div className="field">
          <label className="label" htmlFor="letter-written">
            When did you write it, if you know?
          </label>
          <p className="hint">A year (1998), a year and month (1998-06) or a full date (1998-06-14). Leave it empty if you do not know.</p>
          <input id="letter-written" type="text" value={writtenOn} onChange={(event) => setWrittenOn(event.target.value.trim())} autoComplete="off" />
        </div>

        <AudiencePicker id="letter-audience" audience={audience} people={people} onChange={setAudience} />

        <label className="choice-option">
          <input id="letter-checked" type="checkbox" checked={checked} onChange={(event) => setChecked(event.target.checked)} />
          <span>
            <strong>I have read these words against the letter and they are right.</strong>
          </span>
        </label>

        <Problems problems={problems} />
        <div className="actions">
          <button type="submit" className="button" data-action="letter-save" disabled={busy || reading !== null}>
            {busy ? 'Saving…' : existing ? 'Save the changes' : 'Save this letter'}
          </button>
          <button type="button" className="button-quiet" data-action="letter-cancel" onClick={onCancel}>
            Cancel
          </button>
        </div>
        {existing && (
          <div className="remove-row">
            {removing ? (
              <>
                <span className="remove-warning">This deletes the letter and the pictures of its pages from your archive for good.</span>
                <button type="button" className="button button-stop" data-action="letter-remove-confirm" onClick={() => void remove()}>
                  Yes, remove it
                </button>
                <button type="button" className="button-quiet" onClick={() => setRemoving(false)}>
                  Keep it
                </button>
              </>
            ) : (
              <button type="button" className="button-quiet" data-action="letter-remove" onClick={() => setRemoving(true)}>
                Remove this letter
              </button>
            )}
          </div>
        )}
      </form>
    </section>
  );
}

export function LettersScreen({ onBack }: { onBack: () => void }) {
  const [letters, setLetters] = useState<Letter[] | null>(null);
  const [people, setPeople] = useState<Person[]>([]);
  const [mode, setMode] = useState<{ kind: 'list' } | { kind: 'new' } | { kind: 'edit'; id: string }>({ kind: 'list' });

  async function refresh() {
    const [latestLetters, latestPeople] = await Promise.all([window.echo.letters.list(), window.echo.people.list()]);
    setLetters(latestLetters);
    setPeople(latestPeople);
  }

  useEffect(() => {
    void refresh();
  }, []);

  if (!letters) return null;

  const open = mode.kind === 'edit' ? letters.find((candidate) => candidate.id === mode.id) : undefined;
  const done = async () => {
    await refresh();
    setMode({ kind: 'list' });
  };

  return (
    <div data-screen="letters" data-mode={mode.kind} data-letter-count={letters.length}>
      <div className="actions back-row">
        <button type="button" className="button-quiet" data-action="back-messages" onClick={onBack}>
          Back to messages and letters
        </button>
      </div>

      {mode.kind === 'new' && <LetterForm people={people} onDone={done} onCancel={() => setMode({ kind: 'list' })} />}
      {mode.kind === 'edit' && open && <LetterForm key={open.id} people={people} existing={open} onDone={done} onCancel={() => setMode({ kind: 'list' })} />}

      {mode.kind === 'list' && (
        <section className="panel">
          <h2>Letters you wrote</h2>
          <p>
            A letter is you at your most careful. Photograph or scan each page, have Echo read the words, then correct them by hand against the
            page. Only letters you wrote yourself belong here.
          </p>
          <div className="actions">
            <button type="button" className="button" data-action="letter-new" onClick={() => setMode({ kind: 'new' })}>
              Add a letter
            </button>
          </div>
          {letters.length === 0 ? (
            <p className="hint">No letters yet.</p>
          ) : (
            <ul className="people">
              {letters.map((letter) => (
                <li key={letter.id} data-letter={letter.title}>
                  <div className="person-head">
                    <strong>{letter.title}</strong>
                    <span className="status" data-letter-facts>
                      {letter.writtenOn ? `written ${letter.writtenOn} · ` : ''}
                      {letter.pages === 0 ? 'typed' : letter.pages === 1 ? '1 page pictured' : `${letter.pages} pages pictured`} ·{' '}
                      {audienceLabel(letter.audience, people)}
                    </span>
                  </div>
                  <p className="person-line advice-preview">{letter.text.length > 160 ? `${letter.text.slice(0, 160)}…` : letter.text}</p>
                  <div className="actions">
                    <button type="button" className="button-quiet" data-action="letter-edit" onClick={() => setMode({ kind: 'edit', id: letter.id })}>
                      Read or change
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
    </div>
  );
}
