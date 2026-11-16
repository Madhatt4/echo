import { useEffect, useState } from 'react';
import { memorySourceLabel, memoryUseLabel, memoryWords, usable } from '../../shared/memories.ts';
import type { Memory, MemoryChange, MemorySourceKind, MemoryStore } from '../../shared/memories.ts';
import type { Person } from '../../shared/people.ts';
import { AudienceSelect } from './AudiencePicker.tsx';
import { Problems } from './Problems.tsx';

const PAGE = 50;

type Filter = 'all' | MemorySourceKind | 'held' | 'left-out';

function day(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { dateStyle: 'long' });
}

/** Why the echo will or will not draw on a passage, as one word for the page and the checks. */
function state(memory: Memory): 'usable' | 'held' | 'left-out' | 'for-the-day' {
  if (memory.held) return 'held';
  if (memory.leftOut) return 'left-out';
  if (memory.use === 'advice-on-the-day') return 'for-the-day';
  return 'usable';
}

function Passage({
  memory,
  people,
  onChange,
}: {
  memory: Memory;
  people: readonly Person[];
  onChange: (change: MemoryChange) => Promise<string[]>;
}) {
  const [editing, setEditing] = useState(false);
  const [words, setWords] = useState('');
  const [problems, setProblems] = useState<string[]>([]);

  async function apply(change: MemoryChange): Promise<boolean> {
    const found = await onChange(change);
    setProblems(found);
    return found.length === 0;
  }

  const names = memory.people.map((id) => people.find((person) => person.id === id)?.name).filter((name) => name !== undefined);

  return (
    <li
      data-memory={memory.source.kind}
      data-memory-state={state(memory)}
      data-memory-audience={memory.audience.kind}
      data-memory-corrected={memory.words !== undefined ? 'yes' : 'no'}
    >
      <div className="person-head">
        <strong>
          {memorySourceLabel(memory.source.kind)}: {memory.source.title}
        </strong>
        <span className="status">{day(memory.date)}</span>
        {memory.use !== 'memory' && <span className="status">{memoryUseLabel(memory.use)}</span>}
        {memory.words !== undefined && <span className="status">Corrected by you</span>}
      </div>
      {memory.context && <p className="person-line">{memory.source.kind === 'interview' ? 'You were asked: ' : 'Prompt: '}{memory.context}</p>}

      {memory.held && (
        <p className="warning" data-memory-held>
          <strong>Your echo is not using this yet.</strong> What it came from was changed after you
          had marked part of it, so read it and decide.
        </p>
      )}
      {memory.leftOut && !memory.held && <p className="hint">Left out. Your echo will not use this.</p>}
      {memory.use === 'advice-on-the-day' && !memory.leftOut && !memory.held && (
        <p className="hint">Kept for the day. Your echo will not bring this up in conversation before then.</p>
      )}

      {editing ? (
        <div className="field">
          <textarea rows={6} value={words} onChange={(event) => setWords(event.target.value)} data-memory-words-box />
          <div className="actions">
            <button
              type="button"
              className="button"
              data-action="memory-save"
              onClick={() => void apply({ words }).then((ok) => ok && setEditing(false))}
            >
              Save the words
            </button>
            <button type="button" className="button-quiet" onClick={() => setEditing(false)}>
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <p className={memory.leftOut ? 'memory-words memory-words-out' : 'memory-words'} data-memory-words>
          {memoryWords(memory)}
        </p>
      )}

      {names.length > 0 && <p className="person-line">Involves: {names.join(', ')}</p>}
      <AudienceSelect audience={memory.audience} people={people} onChange={(audience) => void apply({ audience })} />
      <Problems problems={problems} />

      {!editing && (
        <div className="actions">
          {memory.held && (
            <button type="button" className="button" data-action="memory-release" onClick={() => void apply({ held: false })}>
              Let my echo use this
            </button>
          )}
          <button
            type="button"
            className="button-quiet"
            data-action="memory-correct"
            onClick={() => {
              setWords(memoryWords(memory));
              setProblems([]);
              setEditing(true);
            }}
          >
            Correct the words
          </button>
          {memory.words !== undefined && (
            <button type="button" className="button-quiet" data-action="memory-original" onClick={() => void apply({ words: memory.text })}>
              Put the original words back
            </button>
          )}
          {memory.leftOut ? (
            <button type="button" className="button-quiet" data-action="memory-put-back" onClick={() => void apply({ leftOut: false })}>
              Put it back
            </button>
          ) : (
            <button type="button" className="button-quiet" data-action="memory-leave-out" onClick={() => void apply({ leftOut: true })}>
              Leave this out
            </button>
          )}
        </div>
      )}
    </li>
  );
}

export function MemoryScreen({ onBack }: { onBack: () => void }) {
  const [store, setStore] = useState<MemoryStore | null>(null);
  const [people, setPeople] = useState<Person[]>([]);
  const [filter, setFilter] = useState<Filter>('all');
  const [search, setSearch] = useState('');
  const [shown, setShown] = useState(PAGE);

  async function refresh() {
    const [latest, latestPeople] = await Promise.all([window.echo.memories.list(), window.echo.people.list()]);
    setStore(latest);
    setPeople(latestPeople);
  }

  useEffect(() => {
    void refresh();
  }, []);

  if (!store) return null;

  async function change(id: string, memoryChange: MemoryChange): Promise<string[]> {
    const result = await window.echo.memories.change(id, memoryChange);
    await refresh();
    return result.ok ? [] : result.problems;
  }

  const all = store.memories;
  const count = (kind: Filter) =>
    all.filter((memory) => (kind === 'all' ? true : kind === 'held' ? memory.held : kind === 'left-out' ? memory.leftOut : memory.source.kind === kind)).length;
  const wanted = search.trim().toLowerCase();
  const matching = all.filter((memory) => {
    if (filter === 'held' && !memory.held) return false;
    if (filter === 'left-out' && !memory.leftOut) return false;
    if ((filter === 'story' || filter === 'interview' || filter === 'advice' || filter === 'message' || filter === 'letter' || filter === 'note') && memory.source.kind !== filter) return false;
    if (wanted.length === 0) return true;
    return `${memoryWords(memory)} ${memory.source.title} ${memory.context}`.toLowerCase().includes(wanted);
  });
  const filters: { id: Filter; label: string }[] = [
    { id: 'all', label: `All (${count('all')})` },
    { id: 'story', label: `Stories (${count('story')})` },
    { id: 'interview', label: `Interview (${count('interview')})` },
    { id: 'advice', label: `Advice (${count('advice')})` },
    ...(count('message') > 0 ? [{ id: 'message' as const, label: `Messages (${count('message')})` }] : []),
    ...(count('letter') > 0 ? [{ id: 'letter' as const, label: `Letters (${count('letter')})` }] : []),
    ...(count('note') > 0 ? [{ id: 'note' as const, label: `From your assistant (${count('note')})` }] : []),
    ...(count('held') > 0 ? [{ id: 'held' as const, label: `Waiting for you (${count('held')})` }] : []),
    ...(count('left-out') > 0 ? [{ id: 'left-out' as const, label: `Left out (${count('left-out')})` }] : []),
  ];

  return (
    <div
      data-screen="memories"
      data-memory-count={all.length}
      data-memory-usable={all.filter(usable).length}
      data-memory-held={count('held')}
      data-memory-left-out={count('left-out')}
    >
      <div className="actions back-row">
        <button type="button" className="button-quiet" data-action="back-home" onClick={onBack}>
          Back to home
        </button>
      </div>

      <section className="panel panel-wide">
        <h2>What your echo remembers</h2>
        <p>
          These are the passages your echo may draw on, cut from your stories, your interview
          answers, your advice and your own messages. They are your own words. Nothing here was written by an AI, and
          your echo may only claim a memory that is on this list.
        </p>
        <p className="hint">
          Correct anything that is wrong, change who may hear a passage, or leave one out. What you
          recorded is never changed by what you do here.
        </p>

        {count('held') > 0 && (
          <div className="warning" data-memories-held>
            <p>
              <strong>
                {count('held') === 1 ? '1 passage is' : `${count('held')} passages are`} waiting for you.
              </strong>{' '}
              Your echo will not use {count('held') === 1 ? 'it' : 'them'} until you have looked.
            </p>
            <div className="actions">
              <button type="button" className="button" data-action="memories-show-held" onClick={() => setFilter('held')}>
                Show me
              </button>
            </div>
          </div>
        )}
        {store.storiesNotWrittenDown > 0 && (
          <p className="warning" data-memories-unwritten>
            {store.storiesNotWrittenDown === 1 ? '1 story has' : `${store.storiesNotWrittenDown} stories have`} a recording but no words yet, so
            your echo cannot draw on {store.storiesNotWrittenDown === 1 ? 'it' : 'them'}. Open Life stories and write {store.storiesNotWrittenDown === 1 ? 'it' : 'them'} down.
          </p>
        )}

        {all.length === 0 ? (
          <p className="hint" data-memories-empty>
            Nothing yet. Tell a story, answer an interview question or add some advice, and it will appear here.
          </p>
        ) : (
          <>
            <div className="actions memory-filters">
              {filters.map((option) => (
                <button
                  key={option.id}
                  type="button"
                  className={filter === option.id ? 'button' : 'button-quiet'}
                  data-filter={option.id}
                  onClick={() => {
                    setFilter(option.id);
                    setShown(PAGE);
                  }}
                >
                  {option.label}
                </button>
              ))}
            </div>
            <div className="field">
              <label className="label" htmlFor="memory-search">
                Find a passage
              </label>
              <input
                id="memory-search"
                type="text"
                value={search}
                onChange={(event) => {
                  setSearch(event.target.value);
                  setShown(PAGE);
                }}
                autoComplete="off"
              />
            </div>

            <p className="hint" data-memories-showing={matching.length}>
              {matching.length === all.length ? `${all.length} in all.` : `${matching.length} of ${all.length}.`}
            </p>
            <ul className="people memories">
              {matching.slice(0, shown).map((memory) => (
                <Passage key={memory.id} memory={memory} people={people} onChange={(memoryChange) => change(memory.id, memoryChange)} />
              ))}
            </ul>
            {matching.length > shown && (
              <div className="actions">
                <button type="button" className="button-quiet" data-action="memories-more" onClick={() => setShown(shown + PAGE)}>
                  Show {Math.min(PAGE, matching.length - shown)} more
                </button>
              </div>
            )}
          </>
        )}
      </section>
    </div>
  );
}
