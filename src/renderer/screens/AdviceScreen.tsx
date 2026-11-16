import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { OCCASIONS, adviceKindLabel } from '../../shared/advice.ts';
import type { Advice, AdviceKind } from '../../shared/advice.ts';
import type { Person } from '../../shared/people.ts';
import { Problems } from './Problems.tsx';
import { SpeakOrType } from './SpeakOrType.tsx';
import type { Take } from './recorders.tsx';

function day(date: string): string {
  return new Date(`${date}T00:00:00`).toLocaleDateString(undefined, { dateStyle: 'long' });
}

function whenShared(advice: Advice): string {
  if (advice.kind === 'on-the-day' && advice.date) return `${adviceKindLabel(advice.kind)} · ${day(advice.date)}`;
  return adviceKindLabel(advice.kind);
}

/** Plays spoken advice, decrypted only for as long as it is on screen. */
function AdviceAudio({ adviceId }: { adviceId: string }) {
  const [url, setUrl] = useState('');

  useEffect(() => {
    let made = '';
    void window.echo.advice.audio(adviceId).then((audio) => {
      if (!audio) return;
      made = URL.createObjectURL(new Blob([new Uint8Array(audio.bytes)], { type: audio.mimeType.split(';')[0] }));
      setUrl(made);
    });
    return () => {
      if (made) URL.revokeObjectURL(made);
    };
  }, [adviceId]);

  if (!url) return null;
  return <audio className="story-audio" src={url} controls data-advice-audio />;
}

function AdviceForm({
  people,
  existing,
  onDone,
  onCancel,
}: {
  people: readonly Person[];
  /** The advice being changed. Absent when adding new advice. */
  existing?: Advice;
  onDone: () => Promise<void>;
  onCancel: () => void;
}) {
  const [personId, setPersonId] = useState(existing?.personId ?? '');
  const [occasion, setOccasion] = useState(existing?.occasion ?? '');
  const [kind, setKind] = useState<AdviceKind>(existing?.kind ?? 'when-asked');
  const [date, setDate] = useState(existing?.date ?? '');
  const [words, setWords] = useState(existing?.text ?? '');
  const [take, setTake] = useState<Take | null>(null);
  const [speaking, setSpeaking] = useState(false);
  const [problems, setProblems] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [removing, setRemoving] = useState(false);

  const gone = existing !== undefined && !people.some((person) => person.id === existing.personId);

  async function save(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setProblems([]);
    const details = { personId, occasion, kind, date, text: words };
    const result = existing
      ? await window.echo.advice.change(existing.id, details)
      : await window.echo.advice.add(details, take ? new Uint8Array(await take.blob.arrayBuffer()) : null, take?.blob.type || '');
    setBusy(false);
    if (result.ok) await onDone();
    else setProblems(result.problems);
  }

  async function remove() {
    if (!existing) return;
    await window.echo.advice.remove(existing.id);
    await onDone();
  }

  return (
    <section className="panel" data-section="advice-form" data-advice-editing={existing ? 'yes' : 'no'}>
      <h2>{existing ? 'Change this advice' : 'Advice for someone'}</h2>
      {!existing && (
        <p>
          Something you want one person to hear from you about one moment in their life. Say it the
          way you would say it to them.
        </p>
      )}

      <form onSubmit={save}>
        <div className="field">
          <label className="label" htmlFor="advice-person">
            Who is it for?
          </label>
          <p className="hint">Your echo will only ever share this with them.</p>
          <select id="advice-person" value={personId} onChange={(event) => setPersonId(event.target.value)}>
            <option value="">Choose someone</option>
            {people.map((person) => (
              <option key={person.id} value={person.id}>
                {person.name}
              </option>
            ))}
            {gone && existing && <option value={existing.personId}>Someone no longer in your list</option>}
          </select>
        </div>

        <div className="field">
          <label className="label" htmlFor="advice-occasion">
            What occasion is it for?
          </label>
          <p className="hint">Choose one or type your own: Your wedding day, When you are struggling, Passing your driving test.</p>
          <input id="advice-occasion" type="text" list="advice-occasions" value={occasion} onChange={(event) => setOccasion(event.target.value)} autoComplete="off" />
          <datalist id="advice-occasions">
            {OCCASIONS.map((suggestion) => (
              <option key={suggestion} value={suggestion} />
            ))}
          </datalist>
        </div>

        <fieldset className="field choice">
          <legend className="label">When should your echo share it?</legend>
          <label className="choice-option">
            <input type="radio" name="advice-kind" data-kind="when-asked" checked={kind === 'when-asked'} onChange={() => setKind('when-asked')} />
            <span>
              <strong>When they ask.</strong> Your echo brings it up when a conversation with them
              reaches this occasion.
            </span>
          </label>
          <label className="choice-option">
            <input type="radio" name="advice-kind" data-kind="on-the-day" checked={kind === 'on-the-day'} onChange={() => setKind('on-the-day')} />
            <span>
              <strong>Keep it for the day.</strong> Your echo holds it back and does not mention it
              before then. How it reaches them on the day is built later, with family access.
            </span>
          </label>
        </fieldset>

        {kind === 'on-the-day' && (
          <div className="field">
            <label className="label" htmlFor="advice-date">
              The date, if you know it
            </label>
            <p className="hint">Leave this empty for a day nobody knows yet, like a wedding.</p>
            <input id="advice-date" type="date" value={date} onChange={(event) => setDate(event.target.value)} />
          </div>
        )}

        {existing?.spoken && (
          <div className="field">
            <span className="label">You saying it</span>
            <AdviceAudio adviceId={existing.id} />
          </div>
        )}

        <SpeakOrType
          id="advice-words"
          label="The advice"
          hint={
            existing?.spoken
              ? 'These are the words Echo wrote down from your recording. Correct anything it misheard.'
              : 'Type it, or say it and Echo writes it down for you to correct.'
          }
          rows={8}
          value={words}
          onChange={setWords}
          take={take}
          onTake={setTake}
          talkLabel="Say it instead"
          canTalk={!existing}
          disabled={busy}
          onBusy={setSpeaking}
        />

        <Problems problems={problems} />
        <div className="actions">
          <button type="submit" className="button" data-action="advice-save" disabled={busy || speaking}>
            {busy ? 'Saving…' : existing ? 'Save changes' : 'Save this advice'}
          </button>
          <button type="button" className="button-quiet" data-action="advice-cancel" onClick={onCancel} disabled={busy}>
            {existing ? 'Back to my advice' : 'Cancel'}
          </button>
        </div>
      </form>

      {existing && (
        <div className="remove-row">
          {removing ? (
            <div className="actions">
              <span className="remove-warning">This deletes the advice{existing.spoken ? ' and its recording' : ''} from your archive for good.</span>
              <button type="button" className="button button-stop" data-action="advice-remove-confirm" onClick={() => void remove()}>
                Delete this advice
              </button>
              <button type="button" className="button-quiet" onClick={() => setRemoving(false)}>
                Keep it
              </button>
            </div>
          ) : (
            <button type="button" className="button-quiet" data-action="advice-remove" onClick={() => setRemoving(true)}>
              Delete this advice
            </button>
          )}
        </div>
      )}
    </section>
  );
}

export function AdviceScreen({ onBack, onOpenPeople }: { onBack: () => void; onOpenPeople: () => void }) {
  const [advice, setAdvice] = useState<Advice[] | null>(null);
  const [people, setPeople] = useState<Person[]>([]);
  const [mode, setMode] = useState<{ kind: 'list' } | { kind: 'new' } | { kind: 'edit'; id: string }>({ kind: 'list' });

  async function refresh() {
    const [latestAdvice, latestPeople] = await Promise.all([window.echo.advice.list(), window.echo.people.list()]);
    setAdvice(latestAdvice);
    setPeople(latestPeople);
  }

  useEffect(() => {
    void refresh();
  }, []);

  if (!advice) return null;

  const open = mode.kind === 'edit' ? advice.find((candidate) => candidate.id === mode.id) : undefined;
  const done = async () => {
    await refresh();
    setMode({ kind: 'list' });
  };

  // One group for each person who has advice, then one for advice whose person has been removed.
  const groups = people
    .map((person) => ({ key: person.id, name: person.name, items: advice.filter((candidate) => candidate.personId === person.id) }))
    .filter((group) => group.items.length > 0);
  const orphans = advice.filter((candidate) => !people.some((person) => person.id === candidate.personId));
  if (orphans.length > 0) groups.push({ key: 'nobody', name: 'Someone no longer in your list', items: orphans });

  return (
    <div data-screen="advice" data-mode={mode.kind} data-advice-count={advice.length}>
      <div className="actions back-row">
        <button type="button" className="button-quiet" data-action="back-home" onClick={onBack}>
          Back to home
        </button>
      </div>

      {mode.kind === 'new' && <AdviceForm people={people} onDone={done} onCancel={() => setMode({ kind: 'list' })} />}
      {mode.kind === 'edit' && open && <AdviceForm key={open.id} people={people} existing={open} onDone={done} onCancel={() => setMode({ kind: 'list' })} />}

      {mode.kind === 'list' && (
        <section className="panel">
          <h2>Advice</h2>
          <p>
            Advice is for one person and one occasion: your daughter on her wedding day, your son
            when he loses a job. Your echo shares it only with the person it is for.
          </p>
          {people.length === 0 ? (
            <div className="warning" data-advice-no-people>
              <p>
                <strong>Add the person first.</strong> Advice is always for someone by name, and
                nobody is in your list yet.
              </p>
              <div className="actions">
                <button type="button" className="button" data-action="advice-people" onClick={onOpenPeople}>
                  Open People
                </button>
              </div>
            </div>
          ) : (
            <div className="actions">
              <button type="button" className="button" data-action="advice-new" onClick={() => setMode({ kind: 'new' })}>
                Add advice
              </button>
            </div>
          )}

          {advice.length === 0 && people.length > 0 && (
            <p className="hint" data-advice-empty>
              No advice yet.
            </p>
          )}

          {groups.map((group) => (
            <div key={group.key} data-advice-for={group.name}>
              <h3 className="group-head">For {group.name}</h3>
              <ul className="people">
                {group.items.map((item) => (
                  <li key={item.id} data-advice={item.occasion}>
                    <div className="person-head">
                      <strong>{item.occasion}</strong>
                      <span className="status" data-advice-kind={item.kind}>
                        {whenShared(item)}
                      </span>
                      <span className="status">{item.spoken ? 'Spoken' : 'Typed'}</span>
                    </div>
                    <p className="person-line advice-preview">{item.text.length > 160 ? `${item.text.slice(0, 160)}…` : item.text}</p>
                    <div className="actions">
                      <button type="button" className="button-quiet" data-action="advice-open" onClick={() => setMode({ kind: 'edit', id: item.id })}>
                        Open
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </section>
      )}
    </div>
  );
}
