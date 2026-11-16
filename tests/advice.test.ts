import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { addAdvice, changeAdvice, loadAdvice, removeAdvice } from '../src/core/advice.ts';
import { OCCASIONS, adviceAudience, adviceKindLabel, adviceProblems, tidyAdvice } from '../src/shared/advice.ts';
import type { AdviceDetails } from '../src/shared/advice.ts';
import { mayHear } from '../src/shared/people.ts';
import type { Person } from '../src/shared/people.ts';

const ADA: Person = { id: 'a', name: 'Ada', relationship: 'daughter', callsMe: 'Dad', mayTalkToEcho: true, addedAt: '2026-11-11T00:00:00.000Z' };
const BEN: Person = { id: 'b', name: 'Ben', relationship: 'son', callsMe: 'Dad', mayTalkToEcho: true, addedAt: '2026-11-11T00:00:00.000Z' };
const WEDDING: AdviceDetails = { personId: 'a', occasion: 'Your wedding day', kind: 'on-the-day', date: '', text: 'Marry someone who makes you laugh.' };

test('advice needs a person from the list, an occasion and some words', () => {
  assert.deepEqual(adviceProblems(WEDDING, [ADA]), []);
  assert.equal(adviceProblems({ ...WEDDING, personId: 'nobody' }, [ADA]).length, 1);
  assert.equal(adviceProblems({ ...WEDDING, personId: '' }, [ADA]).length, 1);
  assert.equal(adviceProblems({ ...WEDDING, occasion: '   ' }, [ADA]).length, 1);
  assert.equal(adviceProblems({ ...WEDDING, text: '  ' }, [ADA]).length, 1);
  assert.equal(adviceProblems({ ...WEDDING, text: 'x'.repeat(20_001) }, [ADA]).length, 1);
  assert.equal(adviceProblems({ ...WEDDING, kind: 'sometime' as never }, [ADA]).length, 1);
});

test('a date is optional, must be a real day, and only belongs to advice kept for the day', () => {
  assert.deepEqual(adviceProblems({ ...WEDDING, date: '2031-05-04' }, [ADA]), []);
  assert.equal(adviceProblems({ ...WEDDING, date: '2031-02-30' }, [ADA]).length, 1);
  assert.equal(adviceProblems({ ...WEDDING, date: 'next spring' }, [ADA]).length, 1);
  assert.equal(tidyAdvice({ ...WEDDING, date: '2031-05-04' }).date, '2031-05-04');
  assert.equal(tidyAdvice({ ...WEDDING, kind: 'when-asked', date: '2031-05-04' }).date, '');
  assert.equal(tidyAdvice({ ...WEDDING, occasion: '  Your wedding day ', text: ' Be kind. ' }).occasion, 'Your wedding day');
});

test('advice is only ever shared with the person it is for', () => {
  const audience = adviceAudience(WEDDING);
  assert.equal(mayHear(audience, 'a', [ADA, BEN]), true);
  assert.equal(mayHear(audience, 'b', [ADA, BEN]), false);
  assert.equal(mayHear(audience, 'a', [BEN]), false); // the person was removed from the list
});

test('there are occasions to choose from, and each kind has a plain label', () => {
  assert.ok(OCCASIONS.length >= 10);
  assert.equal(new Set(OCCASIONS).size, OCCASIONS.length);
  assert.notEqual(adviceKindLabel('when-asked'), adviceKindLabel('on-the-day'));
});

test('advice is added, changed and removed, and is not on disk in the clear', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'echo-advice-'));
  const key = randomBytes(32);
  assert.deepEqual(loadAdvice(dir, key), []);
  const typed = addAdvice(dir, key, WEDDING, null);
  const spoken = addAdvice(dir, key, { ...WEDDING, personId: 'b', kind: 'when-asked', occasion: 'Losing a job' }, { mediaId: 'm-1', mimeType: 'audio/webm' });
  assert.equal(typed.mediaId, undefined);
  assert.equal(spoken.mediaId, 'm-1');
  assert.deepEqual(loadAdvice(dir, key).map((a) => a.occasion), ['Your wedding day', 'Losing a job']);

  assert.equal(changeAdvice(dir, key, spoken.id, { ...WEDDING, personId: 'b', kind: 'when-asked', occasion: 'Losing a job', text: 'It is only a job.' }), true);
  assert.equal(loadAdvice(dir, key)[1]!.text, 'It is only a job.');
  assert.equal(loadAdvice(dir, key)[1]!.mediaId, 'm-1'); // changing the words keeps the recording
  assert.equal(changeAdvice(dir, key, 'no-such-id', WEDDING), false);

  assert.ok(!readFileSync(path.join(dir, 'advice.sealed')).toString('latin1').includes('makes you laugh'));
  assert.throws(() => loadAdvice(dir, randomBytes(32)));

  assert.equal(removeAdvice(dir, key, typed.id)?.id, typed.id);
  assert.equal(removeAdvice(dir, key, typed.id), null);
  assert.equal(loadAdvice(dir, key).length, 1);
});
