import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  BLIND_QUESTIONS,
  blindResult,
  blindStage,
  newBlindTest,
  newJudgeRun,
  nextPair,
  recordVerdict,
  verdictProblems,
} from '../src/shared/blind-test.ts';
import type { BlindTest, JudgeRun, PairVerdict } from '../src/shared/blind-test.ts';

/** A random source that gives the same numbers every time. */
function seeded(seed = 7) {
  let state = seed;
  return () => {
    state = (state * 1103515245 + 12345) % 2147483648;
    return state / 2147483648;
  };
}

function answered(): BlindTest {
  const fresh = newBlindTest('t1', '2026-11-12T12:00:00.000Z');
  return { ...fresh, items: fresh.items.map((item, index) => ({ ...item, mine: `mine ${index}`, echo: `echo ${index}`, echoCheck: 'passed' as const })) };
}

/** Judges every pair. `spot` decides whether the judge picks the real answer for a given pair. */
function judgeAll(test: BlindTest, run: JudgeRun, spot: (pairNumber: number) => boolean, echoScore = 4): JudgeRun {
  let current = run;
  for (;;) {
    const pair = nextPair(test, current);
    if (!pair) return current;
    const realIsLeft = pair.left.startsWith('mine');
    const pickReal = spot(pair.number);
    const verdict: PairVerdict = {
      pick: pickReal === realIsLeft ? 'left' : 'right',
      leftScore: realIsLeft ? 5 : echoScore,
      rightScore: realIsLeft ? echoScore : 5,
    };
    current = recordVerdict(current, verdict);
  }
}

test('there are twenty different questions, and the test moves through its stages', () => {
  assert.equal(BLIND_QUESTIONS.length, 20);
  assert.equal(new Set(BLIND_QUESTIONS).size, 20);
  assert.equal(blindStage(null), 'none');
  const fresh = newBlindTest('t1', '2026-11-12T12:00:00.000Z');
  assert.equal(blindStage(fresh), 'writing');
  const written = { ...fresh, items: fresh.items.map((item) => ({ ...item, mine: 'x' })) };
  assert.equal(blindStage(written), 'echo');
  assert.equal(blindStage(answered()), 'judging');
});

test('a judge sees every question once, in a shuffled order, with the sides mixed and no labels', () => {
  const test_ = answered();
  const run = newJudgeRun('owner', 'Me', 20, seeded());
  assert.deepEqual([...run.order].sort((a, b) => a - b), Array.from({ length: 20 }, (_, i) => i));
  assert.notDeepEqual(run.order, Array.from({ length: 20 }, (_, i) => i));
  assert.ok(run.realOnLeft.includes(true) && run.realOnLeft.includes(false));

  const first = nextPair(test_, run)!;
  assert.deepEqual(Object.keys(first).sort(), ['left', 'number', 'of', 'question', 'right']); // nothing says which is which
  assert.deepEqual([first.number, first.of], [1, 20]);
  assert.equal(first.question, BLIND_QUESTIONS[run.order[0]!]);
  assert.deepEqual([first.left, first.right].map((answer) => answer.split(' ')[1]).sort(), [String(run.order[0]), String(run.order[0])]);

  // Another judge gets a different order.
  assert.notDeepEqual(newJudgeRun('a', 'Ada', 20, seeded(99)).order, run.order);
});

test('a verdict is scored against the truth, whichever side the real answer was on', () => {
  const test_ = answered();
  let run = newJudgeRun('owner', 'Me', 20, seeded());
  const pair = nextPair(test_, run)!;
  const realIsLeft = pair.left.startsWith('mine');
  run = recordVerdict(run, { pick: realIsLeft ? 'right' : 'left', leftScore: realIsLeft ? 5 : 2, rightScore: realIsLeft ? 2 : 5 });
  assert.deepEqual(run.judgements[0], { item: run.order[0], pickedReal: false, realScore: 5, echoScore: 2 });
  assert.equal(nextPair(test_, run)!.number, 2);

  assert.equal(verdictProblems({ pick: 'left', leftScore: 0, rightScore: 5 }).length, 1);
  assert.equal(verdictProblems({ pick: 'left', leftScore: 3.5, rightScore: 5 }).length, 1);
  assert.equal(verdictProblems({ pick: 'middle' as never, leftScore: 3, rightScore: 5 }).length, 1);
  assert.deepEqual(verdictProblems({ pick: 'right', leftScore: 1, rightScore: 5 }), []);
});

test('nothing is revealed until a judge has finished, and the labelled answers only when the test is complete', () => {
  const test_ = answered();
  let owner = newJudgeRun('owner', 'Me', 20, seeded());
  owner = recordVerdict(owner, { pick: 'left', leftScore: 3, rightScore: 3 });
  const partway = blindResult({ ...test_, judges: [owner] });
  assert.deepEqual([partway.judges[0]!.judged, partway.judges[0]!.finished, partway.judges[0]!.pickedReal, partway.echoAverage], [1, false, null, null]);
  assert.deepEqual([partway.complete, partway.passed, partway.breakdown], [false, null, null]);

  owner = judgeAll(test_, newJudgeRun('owner', 'Me', 20, seeded()), (n) => n <= 10);
  const alone = blindResult({ ...test_, judges: [owner] });
  assert.deepEqual([alone.judges[0]!.pickedReal, alone.judges[0]!.echoAverage, alone.judges[0]!.withinBar], [10, 4, true]);
  assert.deepEqual([alone.complete, alone.passed, alone.breakdown], [false, null, null]); // one judge is not the test
});

test('the pass bar: each judge picks the real person at most 13 times in 20, and the echo averages 4 or better', () => {
  const test_ = answered();
  const run = (key: string, label: string, realPicks: number, echoScore: number) =>
    judgeAll(test_, newJudgeRun(key, label, 20, seeded(key.length + 3)), (n) => n <= realPicks, echoScore);

  const pass = blindResult({ ...test_, judges: [run('owner', 'Me', 13, 4), run('a', 'Ada', 9, 4)] });
  assert.deepEqual([pass.complete, pass.passed, pass.echoAverage], [true, true, 4]);
  assert.equal(pass.breakdown!.length, 20);
  assert.deepEqual(Object.keys(pass.breakdown![0]!).sort(), ['echo', 'echoCheck', 'mine', 'question', 'verdicts']);
  assert.deepEqual(pass.breakdown![0]!.verdicts.map((v) => v.label), ['Me', 'Ada']);

  // One judge spots the real one 14 times: fail, however good the scores.
  const spotted = blindResult({ ...test_, judges: [run('owner', 'Me', 14, 5), run('a', 'Ada', 9, 5)] });
  assert.deepEqual([spotted.passed, spotted.judges[0]!.withinBar, spotted.judges[1]!.withinBar], [false, false, true]);

  // Nobody can tell them apart, but the echo's answers score under 4: fail.
  const flat = blindResult({ ...test_, judges: [run('owner', 'Me', 10, 4), run('a', 'Ada', 10, 3)] });
  assert.deepEqual([flat.passed, flat.echoAverage], [false, 3.5]);

  // Two family judges and no judging by the person is not complete.
  assert.equal(blindResult({ ...test_, judges: [run('a', 'Ada', 9, 5), run('b', 'Ben', 9, 5)] }).complete, false);
});
