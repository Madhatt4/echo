import { useEffect, useState } from 'react';
import { MAX_REAL_PICKS, MIN_ECHO_AVERAGE } from '../../shared/blind-test.ts';
import type { BlindPair, BlindResult, BlindTestView } from '../../shared/blind-test.ts';
import { listenerKey } from '../../shared/persona.ts';
import type { Listener } from '../../shared/persona.ts';
import { Problems } from './Problems.tsx';

/** The person writes their own answers, one question at a time. */
function Writing({ view, onChanged }: { view: BlindTestView; onChanged: () => Promise<void> }) {
  const firstEmpty = view.writing.findIndex((item) => item.mine.trim().length === 0);
  const [index, setIndex] = useState(firstEmpty < 0 ? 0 : firstEmpty);
  const [answer, setAnswer] = useState(view.writing[firstEmpty < 0 ? 0 : firstEmpty]?.mine ?? '');
  const [problems, setProblems] = useState<string[]>([]);
  const item = view.writing[index];
  if (!item) return null;
  const answered = view.writing.filter((candidate) => candidate.mine.trim().length > 0).length;

  function go(to: number) {
    setIndex(to);
    setAnswer(view.writing[to]?.mine ?? '');
    setProblems([]);
  }

  async function save() {
    const result = await window.echo.blindTest.saveAnswer(index, answer);
    if (!result.ok) {
      setProblems(result.problems);
      return;
    }
    await onChanged();
    // Go on to the next question that still needs an answer, if there is one.
    const next = view.writing.findIndex((candidate, at) => at !== index && at > index && candidate.mine.trim().length === 0);
    const any = view.writing.findIndex((candidate, at) => at !== index && candidate.mine.trim().length === 0);
    if (next >= 0) go(next);
    else if (any >= 0) go(any);
  }

  return (
    <section className="panel" data-section="blind-writing" data-blind-question={index + 1}>
      <h2>Your own answers</h2>
      <p>
        Answer each question the way you would say it if one of your family asked you: a few
        sentences, in your own words. Your echo never sees these answers, and they are never added
        to what it remembers.
      </p>
      <p className="hint">
        Question {index + 1} of {view.writing.length} · {answered} answered
      </p>
      <blockquote className="interview-question">{item.question}</blockquote>
      <div className="field">
        <label className="label" htmlFor="blind-answer">
          Your answer
        </label>
        <textarea id="blind-answer" rows={6} value={answer} onChange={(event) => setAnswer(event.target.value)} />
      </div>
      <Problems problems={problems} />
      <div className="actions">
        <button type="button" className="button" data-action="blind-save" onClick={() => void save()} disabled={answer.trim().length === 0}>
          Save and go on
        </button>
        <button type="button" className="button-quiet" onClick={() => go(index - 1)} disabled={index === 0}>
          Back
        </button>
        <button type="button" className="button-quiet" onClick={() => go(index + 1)} disabled={index >= view.writing.length - 1}>
          Skip for now
        </button>
      </div>
    </section>
  );
}

/** The echo answers the same questions, one at a time, each through the source check. */
function EchoAnswering({ view, onChanged }: { view: BlindTestView; onChanged: () => Promise<void> }) {
  const [running, setRunning] = useState(false);
  const [problems, setProblems] = useState<string[]>([]);

  async function run() {
    setRunning(true);
    setProblems([]);
    for (;;) {
      const result = await window.echo.blindTest.echoNext();
      await onChanged();
      if (!result.ok) {
        setProblems(result.problems);
        break;
      }
      if (result.remaining === 0) break;
    }
    setRunning(false);
  }

  return (
    <section className="panel" data-section="blind-echo" data-blind-echo-answered={view.echoAnswered}>
      <h2>Your echo's answers</h2>
      <p>
        Your echo now answers the same {view.of} questions, as it would to any of your family. Each
        answer goes through the same check as any reply, so this makes at least {view.of * 2} requests
        on your AI key and takes a few minutes.
      </p>
      <p className="hint" role="status">
        {view.echoAnswered} of {view.of} answered{running ? '. Working…' : '.'}
      </p>
      {!view.keyReady && <p className="warning">Your echo needs your AI key to answer. Open Setup and add it first.</p>}
      <Problems problems={problems} />
      <div className="actions">
        <button type="button" className="button" data-action="blind-echo" onClick={() => void run()} disabled={running || !view.keyReady}>
          {running ? 'Answering…' : view.echoAnswered > 0 ? 'Carry on' : 'Let my echo answer'}
        </button>
      </div>
    </section>
  );
}

/** One judge works through the pairs. Nothing on this screen says which answer is which. */
function Judging({ judge, label, ownerName, onDone }: { judge: Listener; label: string; ownerName: string; onDone: () => void }) {
  const [pair, setPair] = useState<BlindPair | null | undefined>(undefined);
  const [leftScore, setLeftScore] = useState(0);
  const [rightScore, setRightScore] = useState(0);
  const [pick, setPick] = useState<'left' | 'right' | null>(null);
  const [problems, setProblems] = useState<string[]>([]);

  async function load() {
    setPair(await window.echo.blindTest.pair(judge));
    setLeftScore(0);
    setRightScore(0);
    setPick(null);
    setProblems([]);
  }

  useEffect(() => {
    void load();
  }, []);

  if (pair === undefined) return null;

  if (pair === null) {
    return (
      <section className="panel" data-section="blind-judging" data-blind-judge-finished>
        <h2>That is all of them. Thank you, {label}.</h2>
        <p>Your answers are saved. The results are shown once every judge has finished.</p>
        <div className="actions">
          <button type="button" className="button" data-action="blind-judge-done" onClick={onDone}>
            Done
          </button>
        </div>
      </section>
    );
  }

  async function next() {
    if (!pick) return;
    const result = await window.echo.blindTest.judge(judge, { pick, leftScore, rightScore });
    if (!result.ok) setProblems(result.problems);
    else await load();
  }

  const side = (which: 'left' | 'right', name: string, words: string, score: number, setScore: (n: number) => void) => (
    <div className="blind-answer" data-blind-side={which}>
      <h3>Answer {name}</h3>
      <p className="memory-words">{words}</p>
      <fieldset className="choice">
        <legend className="hint">How much does this sound like {ownerName}? 1 is not at all, 5 is exactly.</legend>
        <div className="scores">
          {[1, 2, 3, 4, 5].map((n) => (
            <label key={n}>
              <input type="radio" name={`${which}-score`} data-score={`${which}-${n}`} checked={score === n} onChange={() => setScore(n)} /> {n}
            </label>
          ))}
        </div>
      </fieldset>
    </div>
  );

  return (
    <section className="panel panel-wide" data-section="blind-judging" data-blind-pair={pair.number}>
      <h2>
        {label}, question {pair.number} of {pair.of}
      </h2>
      <p className="hint">One of these answers was written by {ownerName}. The other was written by the AI echo. They are in a random order.</p>
      <blockquote className="interview-question">{pair.question}</blockquote>
      <div className="blind-pair">
        {side('left', 'A', pair.left, leftScore, setLeftScore)}
        {side('right', 'B', pair.right, rightScore, setRightScore)}
      </div>
      <fieldset className="field choice">
        <legend className="label">Which one is really {ownerName}?</legend>
        <label className="choice-option">
          <input type="radio" name="pick" data-pick="left" checked={pick === 'left'} onChange={() => setPick('left')} /> <span>Answer A</span>
        </label>
        <label className="choice-option">
          <input type="radio" name="pick" data-pick="right" checked={pick === 'right'} onChange={() => setPick('right')} /> <span>Answer B</span>
        </label>
      </fieldset>
      <Problems problems={problems} />
      <div className="actions">
        <button type="button" className="button" data-action="blind-next" onClick={() => void next()} disabled={!pick || leftScore === 0 || rightScore === 0}>
          Next
        </button>
        <button type="button" className="button-quiet" onClick={onDone}>
          Stop for now
        </button>
      </div>
    </section>
  );
}

function Results({ result, ownerName }: { result: BlindResult; ownerName: string }) {
  if (!result.complete || result.passed === null || !result.breakdown) return null;
  return (
    <section className="panel panel-wide" data-section="blind-results" data-blind-verdict={result.passed ? 'pass' : 'fail'}>
      <h2>{result.passed ? 'Passed: your echo sounds like you.' : 'Not passed yet.'}</h2>
      <p>
        The bar you agreed: each judge picks the real {ownerName} at most {MAX_REAL_PICKS} times in 20, and the echo's answers average {MIN_ECHO_AVERAGE} out of 5 or better.
      </p>
      <ul className="people">
        {result.judges.filter((judge) => judge.finished).map((judge) => (
          <li key={judge.key} data-blind-judge-result={judge.key}>
            <div className="person-head">
              <strong>{judge.label}</strong>
              <span className="status">
                picked the real one {judge.pickedReal} times in {judge.of} · {judge.withinBar ? 'within the bar' : 'over the bar'}
              </span>
            </div>
            <p className="person-line">
              Scored the echo's answers {judge.echoAverage} out of 5 on average, and the real answers {judge.realAverage}.
            </p>
          </li>
        ))}
      </ul>
      <p>
        <strong>
          Echo's average across the judges: {result.echoAverage} out of 5 ({(result.echoAverage ?? 0) >= MIN_ECHO_AVERAGE ? 'meets' : 'below'} the bar).
        </strong>
      </p>

      <h3 className="group-head">Every question</h3>
      <ol className="exchanges" data-blind-breakdown>
        {result.breakdown.map((item, index) => (
          <li key={index} data-blind-item>
            <p className="exchange-question">{item.question}</p>
            <p className="exchange-answer">
              <strong>{ownerName}:</strong> {item.mine}
            </p>
            <p className="exchange-answer">
              <strong>Echo{item.echoCheck === 'fallback' ? ' (had nothing, after two drafts failed the check)' : item.echoCheck === 'redrafted' ? ' (second draft)' : ''}:</strong> {item.echo}
            </p>
            <p className="person-line">
              {item.verdicts.map((verdict) => `${verdict.label} ${verdict.pickedReal ? 'picked the real one' : 'picked the echo'}, echo ${verdict.echoScore}/5`).join(' · ')}
            </p>
          </li>
        ))}
      </ol>
    </section>
  );
}

export function BlindTestScreen({ onBack }: { onBack: () => void }) {
  const [view, setView] = useState<BlindTestView | null>(null);
  const [judging, setJudging] = useState<{ listener: Listener; label: string } | null>(null);
  const [problems, setProblems] = useState<string[]>([]);
  const [restarting, setRestarting] = useState(false);

  async function refresh() {
    setView(await window.echo.blindTest.view());
  }

  useEffect(() => {
    void refresh();
  }, []);

  if (!view) return null;

  async function start() {
    const result = await window.echo.blindTest.start();
    setProblems(result.ok ? [] : result.problems);
    setRestarting(false);
    setJudging(null);
    await refresh();
  }

  const result = view.result;

  return (
    <div data-screen="blind-test" data-blind-stage={view.stage} data-blind-judging={judging ? listenerKey(judging.listener) : ''}>
      <div className="actions back-row">
        <button type="button" className="button-quiet" data-action="back-home" onClick={onBack}>
          Back to home
        </button>
      </div>

      {view.blocked && <p className="warning">{view.blocked}</p>}
      <Problems problems={problems} />

      {!view.blocked && view.stage === 'none' && (
        <section className="panel">
          <h2>Does it sound like you?</h2>
          <p>A blind test, in three parts:</p>
          <ol>
            <li>You write your own answers to 20 questions. Your echo never sees them.</li>
            <li>Your echo answers the same 20.</li>
            <li>
              You and one of your family each see the two answers to every question, side by side, with no labels and in a random order. You say how
              much each sounds like you, and pick the real one.
            </li>
          </ol>
          <p>
            It passes if each judge picks the real you at most {MAX_REAL_PICKS} times in 20, and the echo's answers average {MIN_ECHO_AVERAGE} out of 5 or better.
          </p>
          <div className="actions">
            <button type="button" className="button" data-action="blind-start" onClick={() => void start()}>
              Start the test
            </button>
          </div>
        </section>
      )}

      {!view.blocked && view.stage === 'writing' && <Writing view={view} onChanged={refresh} />}
      {!view.blocked && view.stage === 'echo' && <EchoAnswering view={view} onChanged={refresh} />}

      {!view.blocked && view.stage === 'judging' && result && judging && (
        <Judging
          key={listenerKey(judging.listener)}
          judge={judging.listener}
          label={judging.label}
          ownerName={view.ownerName}
          onDone={() => {
            setJudging(null);
            void refresh();
          }}
        />
      )}

      {!view.blocked && view.stage === 'judging' && result && !judging && (
        <>
          <section className="panel" data-section="blind-judges">
            <h2>Judging</h2>
            <p>
              Each judge sits at this computer and works through the 20 pairs alone. It needs you and at least one of your family. You wrote your own
              answers, so you may well recognise them: the family judge is the harder test.
            </p>
            <ul className="people">
              {view.possibleJudges.map((option) => {
                const run = result.judges.find((judge) => judge.key === listenerKey(option.listener));
                return (
                  <li key={listenerKey(option.listener)} data-blind-judge={listenerKey(option.listener)}>
                    <div className="person-head">
                      <strong>{option.label}</strong>
                      <span className="status">{!run ? 'Has not judged' : run.finished ? 'Finished' : `${run.judged} of ${run.of} judged`}</span>
                    </div>
                    {!run?.finished && (
                      <div className="actions">
                        <button
                          type="button"
                          className="button-quiet"
                          data-action="blind-judge-as"
                          data-judge={listenerKey(option.listener)}
                          onClick={() => setJudging(option)}
                        >
                          {run ? 'Carry on judging' : `Judge as ${option.label}`}
                        </button>
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
            {!result.complete && (
              <p className="hint" data-blind-incomplete>
                The results, and which answer was which, are shown once you and at least one of your family have finished.
              </p>
            )}
          </section>
          <Results result={result} ownerName={view.ownerName} />
        </>
      )}

      {!view.blocked && view.stage !== 'none' && !judging && (
        <div className="remove-row">
          {restarting ? (
            <div className="actions">
              <span className="remove-warning">This starts again from question 1. The test so far is kept in your archive.</span>
              <button type="button" className="button button-stop" data-action="blind-restart-confirm" onClick={() => void start()}>
                Start a new test
              </button>
              <button type="button" className="button-quiet" onClick={() => setRestarting(false)}>
                Carry on with this one
              </button>
            </div>
          ) : (
            <button type="button" className="button-quiet" data-action="blind-restart" onClick={() => setRestarting(true)}>
              Start a new test
            </button>
          )}
          {view.earlierTests > 0 && <p className="hint">{view.earlierTests === 1 ? '1 earlier test is kept.' : `${view.earlierTests} earlier tests are kept.`}</p>}
        </div>
      )}
    </div>
  );
}
