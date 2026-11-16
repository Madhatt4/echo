import { useState } from 'react';
import type { FormEvent } from 'react';
import { SESSION_MINUTES, WEEKDAYS } from '../../shared/memory-times.ts';
import type { MemoryTimesView, SessionMinutes, Weekday } from '../../shared/memory-times.ts';
import { Problems } from './Problems.tsx';

function when(iso: string): string {
  return new Date(iso).toLocaleString(undefined, { weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' });
}

function dayName(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { weekday: 'long' });
}

interface MemoryTimesProps {
  view: MemoryTimesView;
  onChanged: () => Promise<void>;
  onTellStory: () => void;
}

/** The days and time the person chose to be asked about their life. */
export function MemoryTimes({ view, onChanged, onTellStory }: MemoryTimesProps) {
  const [days, setDays] = useState<Weekday[]>(view.schedule.days);
  const [time, setTime] = useState(view.schedule.time);
  const [minutes, setMinutes] = useState<SessionMinutes>(view.schedule.minutes);
  const [problems, setProblems] = useState<string[]>([]);
  const [saved, setSaved] = useState(false);

  function toggle(day: Weekday) {
    setSaved(false);
    setDays(days.includes(day) ? days.filter((chosen) => chosen !== day) : [...days, day]);
  }

  async function save(event: FormEvent) {
    event.preventDefault();
    const result = await window.echo.memoryTimes.set({ days, time, minutes });
    setProblems(result.ok ? [] : result.problems);
    setSaved(result.ok);
    if (result.ok) await onChanged();
  }

  return (
    <section className="panel" data-section="memory-times">
      <h2>Memory times</h2>
      {view.missed && (
        <div className="gentle" data-memory-missed>
          <p>
            {dayName(view.missed)}&apos;s memory time came and went. That is fine. If you have a few
            minutes now, there is a question waiting.
          </p>
          <div className="actions">
            <button type="button" className="button" data-action="memory-missed-story" onClick={onTellStory}>
              Tell a story
            </button>
          </div>
        </div>
      )}
      <p>
        Pick the days and the time you would like to be asked about your life, one small question
        at a time. A son or daughter can set this up with you. Once the Echo phone app is paired,
        your phone will remind you.
      </p>
      <p className="hint" data-memory-next>
        {view.next ? `Next memory time: ${when(view.next)}, for ${view.schedule.minutes} minutes.` : 'No memory times set.'}
      </p>

      <form onSubmit={save}>
        <fieldset className="field memory-days">
          <legend className="label">Which days</legend>
          {WEEKDAYS.map(({ day, name }) => (
            <label key={day} className="check">
              <input type="checkbox" checked={days.includes(day)} onChange={() => toggle(day)} data-memory-day={day} />
              {name}
            </label>
          ))}
        </fieldset>
        <div className="field">
          <label className="label" htmlFor="memory-time">
            What time
          </label>
          <input id="memory-time" type="time" value={time} onChange={(e) => { setSaved(false); setTime(e.target.value); }} />
        </div>
        <div className="field">
          <label className="label" htmlFor="memory-minutes">
            For how long
          </label>
          <select id="memory-minutes" value={minutes} onChange={(e) => { setSaved(false); setMinutes(Number(e.target.value) as SessionMinutes); }}>
            {SESSION_MINUTES.map((length) => (
              <option key={length} value={length}>
                {length} minutes
              </option>
            ))}
          </select>
        </div>
        <Problems problems={problems} />
        <div className="actions">
          <button type="submit" className="button" data-action="memory-times-save">
            Save memory times
          </button>
          {saved && <span className="hint" data-memory-saved>Saved.</span>}
        </div>
      </form>
    </section>
  );
}
