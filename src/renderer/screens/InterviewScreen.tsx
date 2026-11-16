import { useEffect, useState } from 'react';
import type { InterviewState, TopicProgress } from '../../shared/interview.ts';
import { MAX_EXCHANGES_PER_TOPIC } from '../../shared/interview.ts';
import type { Audience, Person } from '../../shared/people.ts';
import { AudienceSelect } from './AudiencePicker.tsx';
import { Problems } from './Problems.tsx';
import { SpeakOrType } from './SpeakOrType.tsx';
import type { Take } from './recorders.tsx';

function topicStatus(topic: TopicProgress): string {
  const answers = topic.exchanges.length === 1 ? '1 answer' : `${topic.exchanges.length} answers`;
  if (topic.done) return `Finished · ${answers}`;
  if (topic.exchanges.length === 0) return 'Not started';
  return `In progress · ${answers}`;
}

function Topic({
  topic,
  people,
  onChanged,
  onClose,
}: {
  topic: TopicProgress;
  people: readonly Person[];
  onChanged: () => Promise<InterviewState>;
  onClose: () => void;
}) {
  const [answer, setAnswer] = useState('');
  const [spoken, setSpoken] = useState<Take | null>(null);
  const [speaking, setSpeaking] = useState(false);
  const [thinking, setThinking] = useState(false);
  const [problems, setProblems] = useState<string[]>([]);

  /**
   * Runs something that asks the interviewer, showing that it is thinking and
   * any problem it comes back with. `sending` is true when an answer is being
   * sent: the answer box is cleared once that answer is safely saved, whether
   * or not the next question arrived.
   */
  async function ask(action: () => Promise<{ ok: boolean; problems: string[] }>, sending = false) {
    setThinking(true);
    setProblems([]);
    const result = await action();
    const latest = (await onChanged()).topics.find((candidate) => candidate.id === topic.id);
    if (sending && latest && latest.exchanges.length > topic.exchanges.length) {
      setAnswer('');
      setSpoken(null);
    }
    setThinking(false);
    if (!result.ok) setProblems(result.problems);
  }

  async function setAudience(index: number, audience: Audience) {
    setProblems([]);
    const result = await window.echo.interview.setAudience(topic.id, index, audience);
    await onChanged();
    if (!result.ok) setProblems(result.problems);
  }

  async function send() {
    const audio = spoken ? new Uint8Array(await spoken.blob.arrayBuffer()) : null;
    await ask(() => window.echo.interview.answer(topic.id, answer, audio, spoken?.blob.type || ''), true);
  }

  const waiting = topic.pending !== null && !topic.done;
  const stalled = topic.pending === null && !topic.done;
  const busy = thinking || speaking;

  return (
    <section
      className="panel panel-wide"
      data-section="interview-topic"
      data-topic={topic.id}
      data-answers={topic.exchanges.length}
      data-topic-state={thinking ? 'thinking' : topic.done ? 'done' : waiting ? 'waiting' : 'stalled'}
    >
      <h2>{topic.title}</h2>

      {topic.exchanges.length > 0 && (
        <ol className="exchanges" data-exchanges>
          {topic.exchanges.map((exchange, index) => (
            <li key={`${index}-${exchange.answeredAt}`} data-exchange data-for-one-person={exchange.audience.kind === 'person' ? 'yes' : 'no'}>
              <p className="exchange-question">{exchange.question}</p>
              <p className="exchange-answer">
                {exchange.answer}
                {exchange.spoken && <span className="status"> · spoken</span>}
              </p>
              <AudienceSelect audience={exchange.audience} people={people} disabled={thinking} onChange={(audience) => void setAudience(index, audience)} />
            </li>
          ))}
        </ol>
      )}

      {thinking && (
        <p className="hint" data-thinking>
          Thinking of the next question…
        </p>
      )}

      {!thinking && waiting && (
        <>
          <blockquote className="interview-question" data-question>
            {topic.pending}
          </blockquote>

          <SpeakOrType
            id="interview-answer"
            label="Your answer"
            hint="Answer the way you would talk. Long answers are better than short ones. If you answer by talking, read it through and correct anything Echo misheard."
            value={answer}
            onChange={setAnswer}
            take={spoken}
            onTake={setSpoken}
            talkLabel="Answer by talking"
            onBusy={setSpeaking}
          />
        </>
      )}

      {!thinking && stalled && (
        <p className="warning" data-stalled>
          Your last answer is saved. The interviewer has not asked the next question yet.
        </p>
      )}

      {!thinking && topic.done && (
        <p className="hint" data-topic-done>
          {topic.exchanges.length >= MAX_EXCHANGES_PER_TOPIC
            ? 'This part of the interview is finished. It is as long as one part can be, and every answer is kept.'
            : 'This part of the interview is finished. You can carry it on whenever you like.'}
        </p>
      )}

      <Problems problems={problems} />

      <div className="actions">
        {waiting && (
          <>
            <button type="button" className="button" data-action="interview-send" onClick={() => void send()} disabled={busy || answer.trim().length === 0}>
              Send my answer
            </button>
            <button type="button" className="button-quiet" data-action="interview-another" onClick={() => void ask(() => window.echo.interview.another(topic.id))} disabled={busy}>
              Ask me something else
            </button>
          </>
        )}
        {stalled && (
          <button type="button" className="button" data-action="interview-retry" onClick={() => void ask(() => window.echo.interview.retry(topic.id))} disabled={busy}>
            Try again
          </button>
        )}
        {!topic.done && topic.exchanges.length > 0 && (
          <button type="button" className="button-quiet" data-action="interview-enough" onClick={() => void ask(() => window.echo.interview.setDone(topic.id, true))} disabled={busy}>
            I have said enough about this
          </button>
        )}
        {topic.done && topic.exchanges.length < MAX_EXCHANGES_PER_TOPIC && (
          <button type="button" className="button-quiet" data-action="interview-reopen" onClick={() => void ask(() => window.echo.interview.setDone(topic.id, false))} disabled={busy}>
            Carry this part on
          </button>
        )}
        <button type="button" className="button-quiet" data-action="interview-topics" onClick={onClose} disabled={thinking}>
          Back to the list
        </button>
      </div>
    </section>
  );
}

export function InterviewScreen({ onBack, onOpenSetup }: { onBack: () => void; onOpenSetup: () => void }) {
  const [state, setState] = useState<InterviewState | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [people, setPeople] = useState<Person[]>([]);

  async function refresh(): Promise<InterviewState> {
    const latest = await window.echo.interview.state();
    setState(latest);
    return latest;
  }

  useEffect(() => {
    void refresh();
    void window.echo.people.list().then(setPeople);
  }, []);

  if (!state) return null;

  const topic = state.topics.find((candidate) => candidate.id === open);
  const finished = state.topics.filter((candidate) => candidate.done).length;
  const answers = state.topics.reduce((sum, candidate) => sum + candidate.exchanges.length, 0);

  return (
    <div data-screen="interview" data-mode={topic ? 'topic' : 'list'} data-interview-answers={answers} data-interview-finished={finished}>
      <div className="actions back-row">
        <button type="button" className="button-quiet" data-action="back-home" onClick={onBack}>
          Back to home
        </button>
      </div>

      {topic && <Topic key={topic.id} topic={topic} people={people} onChanged={refresh} onClose={() => setOpen(null)} />}

      {!topic && (
        <>
          <section className="panel" data-section="interview-intro">
            <h2>Character interview</h2>
            <p>
              An AI interviewer asks about your life and what you believe, then follows up on what
              you actually say. This is what teaches your echo how you think, not only what
              happened to you. Do one part at a time. You can stop in the middle of any part and
              carry on another day.
            </p>
            <p className="hint">
              The interviewer is Claude, using your own AI key. To ask its next question it is sent
              your name, the names of your people, how they are related to you and what they call
              you, and your answers in the part you are doing. Your recordings never leave this computer.
            </p>
            <p className="hint">
              Every answer is for everyone unless you say otherwise. Under each saved answer you can
              mark it for one person alone, and your echo will only ever share it with them.
            </p>
            {!state.keyReady && (
              <div className="warning" data-interview-no-key>
                <p>
                  <strong>The interviewer needs your AI key.</strong> You can read the first
                  question of each part, but it cannot follow up until a key is saved.
                </p>
                <div className="actions">
                  <button type="button" className="button" data-action="interview-setup" onClick={onOpenSetup}>
                    Open Setup
                  </button>
                </div>
              </div>
            )}
          </section>

          <section className="panel" data-section="interview-topics">
            <h2>
              {finished} of {state.topics.length} parts finished
            </h2>
            <ul className="people">
              {state.topics.map((candidate) => (
                <li key={candidate.id} data-topic-id={candidate.id} data-topic-done={candidate.done ? 'yes' : 'no'}>
                  <div className="person-head">
                    <strong>{candidate.title}</strong>
                    <span className="status" data-topic-status>
                      {topicStatus(candidate)}
                    </span>
                  </div>
                  <div className="actions">
                    <button type="button" className="button-quiet" data-action="interview-open" onClick={() => setOpen(candidate.id)}>
                      {candidate.done ? 'Read it' : candidate.exchanges.length === 0 ? 'Start' : 'Carry on'}
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
