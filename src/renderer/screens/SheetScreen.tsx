import { useEffect, useState } from 'react';
import type { Audience, Person } from '../../shared/people.ts';
import { PEOPLE_SECTION, SHEET_SECTIONS, sheetTitle } from '../../shared/sheets.ts';
import type { SheetKind, SheetLineView, SheetSection, SheetView } from '../../shared/sheets.ts';
import { Problems } from './Problems.tsx';

type Act = (action: () => Promise<{ ok: boolean; problems: string[] }>) => Promise<string[]>;

function status(line: SheetLineView): string {
  if (line.origin === 'yours') return line.evidence.length > 0 ? 'Corrected by you' : 'Written by you';
  return line.checked ? 'Drafted by Claude · checked by you' : 'Drafted by Claude · not checked by you';
}

function Line({ kind, line, people, act }: { kind: SheetKind; line: SheetLineView; people: readonly Person[]; act: Act }) {
  const [editing, setEditing] = useState(false);
  const [words, setWords] = useState('');
  const [problems, setProblems] = useState<string[]>([]);
  const about = line.audience.kind === 'person' ? line.audience.personId : null;
  const person = about ? people.find((candidate) => candidate.id === about) : undefined;

  return (
    <li
      data-line={line.section}
      data-line-origin={line.origin}
      data-line-checked={line.checked ? 'yes' : 'no'}
      data-line-in-use={line.inUse ? 'yes' : 'no'}
      data-line-audience={line.audience.kind}
    >
      {editing ? (
        <div className="field">
          <textarea rows={3} value={words} onChange={(event) => setWords(event.target.value)} data-line-words-box />
          <div className="actions">
            <button
              type="button"
              className="button"
              data-action="line-save"
              onClick={() =>
                void act(() => window.echo.sheets.change(kind, line.id, { text: words })).then((found) => {
                  setProblems(found);
                  if (found.length === 0) setEditing(false);
                })
              }
            >
              Save the words
            </button>
            <button type="button" className="button-quiet" onClick={() => setEditing(false)}>
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <p className="memory-words" data-line-words>
          {line.text}
        </p>
      )}

      <p className="person-line">
        {about && `About ${person ? person.name : 'someone no longer in your list'} · only used when your echo talks to them · `}
        {status(line)}
      </p>
      {!line.inUse && (
        <p className="warning" data-line-unsupported>
          <strong>Your echo is not relying on this line.</strong> The passages it rested on are no
          longer in use. If it is true of you, say so. If not, strike it out.
        </p>
      )}
      {line.support.length > 0 && (
        <details className="support">
          <summary>{line.support.length === 1 ? 'Rests on 1 passage' : `Rests on ${line.support.length} passages`}</summary>
          <ul>
            {line.support.map((support) => (
              <li key={support.memoryId}>
                <strong>{support.title}:</strong> {support.excerpt}
              </li>
            ))}
          </ul>
        </details>
      )}
      <Problems problems={problems} />

      {!editing && (
        <div className="actions">
          {!line.checked && (
            <button type="button" className="button" data-action="line-confirm" onClick={() => void act(() => window.echo.sheets.change(kind, line.id, { checked: true })).then(setProblems)}>
              That is me
            </button>
          )}
          <button
            type="button"
            className="button-quiet"
            data-action="line-correct"
            onClick={() => {
              setWords(line.text);
              setProblems([]);
              setEditing(true);
            }}
          >
            Correct it
          </button>
          <button type="button" className="button-quiet" data-action="line-strike" onClick={() => void act(() => window.echo.sheets.remove(kind, line.id)).then(setProblems)}>
            {line.origin === 'drafted' ? 'Not me' : 'Strike it out'}
          </button>
        </div>
      )}
    </li>
  );
}

function AddLine({ kind, section, people, act }: { kind: SheetKind; section: SheetSection; people: readonly Person[]; act: Act }) {
  const [words, setWords] = useState('');
  const [personId, setPersonId] = useState('');
  const [problems, setProblems] = useState<string[]>([]);
  const aboutSomeone = section.id === PEOPLE_SECTION;

  async function add() {
    const audience: Audience = aboutSomeone ? { kind: 'person', personId } : { kind: 'everyone' };
    const found = await act(() => window.echo.sheets.add(kind, section.id, words, audience));
    setProblems(found);
    if (found.length === 0) setWords('');
  }

  return (
    <div className="add-line" data-add-section={section.id}>
      {aboutSomeone && (
        <select value={personId} onChange={(event) => setPersonId(event.target.value)} aria-label="Who this line is about">
          <option value="">Who is it about?</option>
          {people.map((person) => (
            <option key={person.id} value={person.id}>
              {person.name}
            </option>
          ))}
        </select>
      )}
      <input type="text" value={words} onChange={(event) => setWords(event.target.value)} placeholder="Add a line in your own words" aria-label={`Add a line to ${section.title}`} autoComplete="off" />
      <button type="button" className="button-quiet" data-action="line-add" onClick={() => void add()} disabled={words.trim().length === 0}>
        Add it
      </button>
      <Problems problems={problems} />
    </div>
  );
}

export function SheetScreen({ kind, onBack, onOpenSetup }: { kind: SheetKind; onBack: () => void; onOpenSetup: () => void }) {
  const [view, setView] = useState<SheetView | null>(null);
  const [people, setPeople] = useState<Person[]>([]);
  const [drafting, setDrafting] = useState(false);
  const [problems, setProblems] = useState<string[]>([]);
  const [note, setNote] = useState('');

  async function refresh() {
    const [latest, latestPeople] = await Promise.all([window.echo.sheets.get(kind), window.echo.people.list()]);
    setView(latest);
    setPeople(latestPeople);
  }

  useEffect(() => {
    void refresh();
  }, [kind]);

  if (!view) return null;

  const act: Act = async (action) => {
    const result = await action();
    await refresh();
    return result.ok ? [] : result.problems;
  };

  async function draft() {
    setDrafting(true);
    setProblems([]);
    setNote('');
    const result = await window.echo.sheets.draft(kind);
    await refresh();
    setDrafting(false);
    if (!result.ok) setProblems(result.problems);
    else setNote(result.note ?? '');
  }

  const title = sheetTitle(kind);
  const unchecked = view.lines.filter((line) => !line.checked).length;

  return (
    <div data-screen="sheet" data-sheet-kind={kind} data-sheet-lines={view.lines.length} data-sheet-unchecked={unchecked} data-sheet-drafting={drafting ? 'yes' : 'no'}>
      <div className="actions back-row">
        <button type="button" className="button-quiet" data-action="back-home" onClick={onBack}>
          Back to home
        </button>
      </div>

      <section className="panel panel-wide">
        <h2>{title}</h2>
        {kind === 'character' ? (
          <p>
            Who you are, in short lines: what matters to you, what you believe, what you find
            funny, how you are with people, and what you would never say. When your family ask your
            echo what you would have thought about something you never recorded, this is what it
            reasons from.
          </p>
        ) : (
          <p>
            How you talk, in short lines: your rhythm, the words and phrases you use, how you start
            and finish, and what is different about how you speak to each person. This is what
            makes your echo sound like you.
          </p>
        )}
        <p className="hint">
          Claude drafts the lines from your passages, using your own AI key, and each line shows the
          passages it rests on. Nothing is true of you until you say so: confirm a line, correct it,
          or strike it out. To draft, your name and your passages are sent to Anthropic. Passages
          you marked for one person are {kind === 'character' ? 'never used here' : 'only used for lines about how you talk to that person'}.
        </p>
        {view.measure && view.measure.sentences > 0 && (
          <p className="hint" data-sheet-measure>
            Measured on this computer: {view.measure.words.toLocaleString()} of your words in {view.measure.sentences.toLocaleString()} sentences, {view.measure.averageSentenceWords} words to a sentence on average.
          </p>
        )}

        {!view.keyReady && (
          <div className="warning" data-sheet-no-key>
            <p>
              <strong>Drafting needs your AI key.</strong> You can still write lines yourself.
            </p>
            <div className="actions">
              <button type="button" className="button" data-action="sheet-setup" onClick={onOpenSetup}>
                Open Setup
              </button>
            </div>
          </div>
        )}
        {view.passagesAvailable === 0 && (
          <p className="warning" data-sheet-nothing>
            There is nothing to draft from yet. Answer some interview questions or write down a story first.
          </p>
        )}

        <div className="actions">
          <button type="button" className="button" data-action="sheet-draft" onClick={() => void draft()} disabled={drafting || !view.keyReady || view.passagesAvailable === 0}>
            {drafting ? 'Drafting…' : view.draftedAt ? 'Draft it again from my passages' : 'Draft it from my passages'}
          </button>
        </div>
        {drafting && (
          <p className="hint" role="status">
            Claude is reading your passages. This can take a minute or two.
          </p>
        )}
        {view.draftedAt && !drafting && (
          <p className="hint">
            Last drafted {new Date(view.draftedAt).toLocaleString(undefined, { dateStyle: 'long', timeStyle: 'short' })} from {view.draftedFrom === 1 ? '1 passage' : `${view.draftedFrom} passages`}.
            Drafting again keeps every line you wrote, corrected or confirmed, and replaces the rest.
          </p>
        )}
        {note && (
          <p className="saved" data-sheet-note>
            {note}
          </p>
        )}
        <Problems problems={problems} />

        {SHEET_SECTIONS[kind].map((section) => {
          const lines = view.lines.filter((line) => line.section === section.id);
          return (
            <div key={section.id} data-sheet-section={section.id}>
              <h3 className="group-head">{section.title}</h3>
              <p className="hint">{section.holds}</p>
              {lines.length === 0 ? (
                <p className="hint">Nothing here yet.</p>
              ) : (
                <ul className="people sheet-lines">
                  {lines.map((line) => (
                    <Line key={line.id} kind={kind} line={line} people={people} act={act} />
                  ))}
                </ul>
              )}
              <AddLine kind={kind} section={section} people={people} act={act} />
            </div>
          );
        })}
      </section>
    </div>
  );
}
