import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import type { Person, PersonDetails } from '../../shared/people.ts';
import { Problems } from './Problems.tsx';

const BLANK: PersonDetails = { name: '', relationship: '', callsMe: '', mayTalkToEcho: true };

function PersonForm({
  start,
  idPrefix,
  submitLabel,
  action,
  onSubmit,
  onCancel,
}: {
  start: PersonDetails;
  idPrefix: string;
  submitLabel: string;
  action: string;
  onSubmit: (details: PersonDetails) => Promise<string[]>;
  onCancel?: () => void;
}) {
  const [details, setDetails] = useState<PersonDetails>(start);
  const [problems, setProblems] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    const found = await onSubmit(details);
    setBusy(false);
    setProblems(found);
    if (found.length === 0 && !onCancel) setDetails(BLANK);
  }

  const set = (change: Partial<PersonDetails>) => setDetails((current) => ({ ...current, ...change }));

  return (
    <form onSubmit={submit}>
      <div className="field">
        <label className="label" htmlFor={`${idPrefix}-name`}>
          Their name
        </label>
        <p className="hint">The way you say it. Your echo will use this name.</p>
        <input
          id={`${idPrefix}-name`}
          type="text"
          value={details.name}
          onChange={(e) => set({ name: e.target.value })}
          autoComplete="off"
          spellCheck={false}
        />
      </div>
      <div className="field">
        <label className="label" htmlFor={`${idPrefix}-relationship`}>
          Who they are to you
        </label>
        <p className="hint">In your own words: my wife, eldest son, best friend.</p>
        <input
          id={`${idPrefix}-relationship`}
          type="text"
          value={details.relationship}
          onChange={(e) => set({ relationship: e.target.value })}
          autoComplete="off"
        />
      </div>
      <div className="field">
        <label className="label" htmlFor={`${idPrefix}-calls-me`}>
          What they call you
        </label>
        <p className="hint">Dad, Grandad, your first name, a nickname. Your echo will answer to it.</p>
        <input
          id={`${idPrefix}-calls-me`}
          type="text"
          value={details.callsMe}
          onChange={(e) => set({ callsMe: e.target.value })}
          autoComplete="off"
        />
      </div>
      <div className="field">
        <label className="check">
          <input
            id={`${idPrefix}-may-talk`}
            type="checkbox"
            checked={details.mayTalkToEcho}
            onChange={(e) => set({ mayTalkToEcho: e.target.checked })}
          />
          They may talk to my echo
        </label>
        <p className="hint">
          Untick this for someone who matters in your stories but should not have access, or who
          has died.
        </p>
      </div>
      <Problems problems={problems} />
      <div className="actions">
        <button type="submit" className="button" data-action={action} disabled={busy}>
          {submitLabel}
        </button>
        {onCancel && (
          <button type="button" className="button-quiet" onClick={onCancel}>
            Cancel
          </button>
        )}
      </div>
    </form>
  );
}

export function PeopleScreen({ onBack }: { onBack: () => void }) {
  const [people, setPeople] = useState<Person[] | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [removing, setRemoving] = useState<string | null>(null);

  async function refresh() {
    setPeople(await window.echo.people.list());
  }

  useEffect(() => {
    void refresh();
  }, []);

  async function add(details: PersonDetails): Promise<string[]> {
    const result = await window.echo.people.add(details);
    if (result.ok) await refresh();
    return result.problems;
  }

  async function change(id: string, details: PersonDetails): Promise<string[]> {
    const result = await window.echo.people.change(id, details);
    if (result.ok) {
      // Fetch the saved details before closing the form, so the old ones never flash up.
      await refresh();
      setEditing(null);
    }
    return result.problems;
  }

  async function remove(id: string) {
    await window.echo.people.remove(id);
    setRemoving(null);
    await refresh();
  }

  if (!people) return null;

  return (
    <div data-screen="people" data-people-count={people.length}>
      <div className="actions back-row">
        <button type="button" className="button-quiet" data-action="back-home" onClick={onBack}>
          Back to home
        </button>
      </div>

      <section className="panel">
        <h2>Your people</h2>
        <p>
          Add the people who matter to you. Your echo will know who it is talking to, use their
          name, and answer to what they call you. Later, anything you capture can be marked for one
          of them alone.
        </p>

        {people.length === 0 ? (
          <p className="hint" data-people-empty>
            Nobody added yet.
          </p>
        ) : (
          <ul className="people">
            {people.map((person) => (
              <li key={person.id} data-person={person.name}>
                {editing === person.id ? (
                  <PersonForm
                    start={person}
                    idPrefix="edit-person"
                    submitLabel="Save changes"
                    action="save-person"
                    onSubmit={(details) => change(person.id, details)}
                    onCancel={() => setEditing(null)}
                  />
                ) : (
                  <>
                    <div className="person-head">
                      <strong>{person.name}</strong>
                      <span className="status">{person.mayTalkToEcho ? 'May talk to your echo' : 'No access'}</span>
                    </div>
                    <p className="person-line">
                      {person.relationship || 'Relationship not given'}
                      {person.callsMe ? ` · calls you ${person.callsMe}` : ''}
                    </p>
                    {removing === person.id ? (
                      <div className="actions">
                        <span className="remove-warning">
                          Anything you have marked for {person.name} alone will then be heard by nobody.
                        </span>
                        <button type="button" className="button button-stop" data-action="confirm-remove-person" onClick={() => void remove(person.id)}>
                          Remove {person.name}
                        </button>
                        <button type="button" className="button-quiet" onClick={() => setRemoving(null)}>
                          Keep
                        </button>
                      </div>
                    ) : (
                      <div className="actions">
                        <button type="button" className="button-quiet" data-action="edit-person" onClick={() => setEditing(person.id)}>
                          Change
                        </button>
                        <button type="button" className="button-quiet" data-action="remove-person" onClick={() => setRemoving(person.id)}>
                          Remove
                        </button>
                      </div>
                    )}
                  </>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="panel" data-section="add-person">
        <h2>Add someone</h2>
        <PersonForm start={BLANK} idPrefix="new-person" submitLabel="Add this person" action="add-person" onSubmit={add} />
      </section>
    </div>
  );
}
