import type { Audience, Person } from '../../shared/people.ts';

/** "Who is this for?" Everyone, or one named person alone. */
export function AudiencePicker({
  id,
  audience,
  people,
  onChange,
}: {
  id: string;
  audience: Audience;
  people: readonly Person[];
  onChange: (audience: Audience) => void;
}) {
  const value = audience.kind === 'everyone' ? 'everyone' : audience.personId;
  const gone = audience.kind === 'person' && !people.some((person) => person.id === audience.personId);

  return (
    <div className="field">
      <label className="label" htmlFor={id}>
        Who is this for?
      </label>
      <p className="hint">
        Everyone means any family member you have allowed to talk to your echo. Choose one person
        and your echo will only ever share it with them.
      </p>
      <select
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value === 'everyone' ? { kind: 'everyone' } : { kind: 'person', personId: e.target.value })}
      >
        <option value="everyone">Everyone</option>
        {people.map((person) => (
          <option key={person.id} value={person.id}>
            Only {person.name}
          </option>
        ))}
        {gone && <option value={value}>Nobody (the person it was for has been removed)</option>}
      </select>
      {people.length === 0 && <p className="hint">Add people on the People screen to mark a story for one of them.</p>}
    </div>
  );
}

/** The same choice as a small drop-down, for a row in a list. */
export function AudienceSelect({
  audience,
  people,
  disabled = false,
  onChange,
}: {
  audience: Audience;
  people: readonly Person[];
  disabled?: boolean;
  onChange: (audience: Audience) => void;
}) {
  const value = audience.kind === 'everyone' ? 'everyone' : audience.personId;
  const gone = audience.kind === 'person' && !people.some((person) => person.id === audience.personId);
  return (
    <label className="exchange-audience">
      <span className="hint">Who may hear this from your echo?</span>
      <select
        data-audience-select
        value={value}
        onChange={(event) => onChange(event.target.value === 'everyone' ? { kind: 'everyone' } : { kind: 'person', personId: event.target.value })}
        disabled={disabled}
      >
        <option value="everyone">Everyone</option>
        {people.map((person) => (
          <option key={person.id} value={person.id}>
            Only {person.name}
          </option>
        ))}
        {gone && <option value={value}>Nobody (the person it was for has been removed)</option>}
      </select>
    </label>
  );
}
