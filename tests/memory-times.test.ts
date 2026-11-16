import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { loadMemoryTimes, restorePrompt, retirePrompt, saveSchedule } from '../src/core/memory-times.ts';
import { NO_MEMORY_TIMES, missedMemoryTime, nextMemoryTime, scheduleProblems } from '../src/shared/memory-times.ts';
import type { MemorySchedule } from '../src/shared/memory-times.ts';

// Local times. 16 November 2026 is a Monday.
const at = (day: number, hours: number, minutes = 0) => new Date(2026, 10, day, hours, minutes);
const MON_WED_10AM: MemorySchedule = { days: [1, 3], time: '10:00', minutes: 30 };

test('a schedule needs real days, a time of day and one of the three lengths', () => {
  assert.deepEqual(scheduleProblems(MON_WED_10AM), []);
  assert.deepEqual(scheduleProblems(NO_MEMORY_TIMES), []);
  assert.equal(scheduleProblems({ ...MON_WED_10AM, days: [1, 1] }).length, 1);
  assert.equal(scheduleProblems({ ...MON_WED_10AM, days: [7 as 0] }).length, 1);
  assert.equal(scheduleProblems({ ...MON_WED_10AM, time: '25:00' }).length, 1);
  assert.equal(scheduleProblems({ ...MON_WED_10AM, time: '9:30' }).length, 1);
  assert.equal(scheduleProblems({ ...MON_WED_10AM, minutes: 45 as 15 }).length, 1);
});

test('the next memory time is the next chosen day at the chosen time', () => {
  assert.deepEqual(nextMemoryTime(MON_WED_10AM, at(16, 9)), at(16, 10));
  assert.deepEqual(nextMemoryTime(MON_WED_10AM, at(16, 10)), at(18, 10));
  assert.deepEqual(nextMemoryTime(MON_WED_10AM, at(19, 12)), at(23, 10));
  assert.deepEqual(nextMemoryTime({ ...MON_WED_10AM, days: [1] }, at(16, 11)), at(23, 10));
  assert.equal(nextMemoryTime(NO_MEMORY_TIMES, at(16, 9)), null);
});

test('a missed memory time gets one nudge, the next day from the usual time, then nothing', () => {
  const saturdays: MemorySchedule = { days: [6], time: '10:00', minutes: 15 };
  // Saturday 21st was missed.
  assert.equal(missedMemoryTime(saturdays, null, at(21, 10, 5)), null, 'not while it is still on');
  assert.equal(missedMemoryTime(saturdays, null, at(21, 20)), null, 'not the same day');
  assert.equal(missedMemoryTime(saturdays, null, at(22, 9)), null, 'not before the usual time');
  assert.deepEqual(missedMemoryTime(saturdays, null, at(22, 10)), at(21, 10));
  assert.deepEqual(missedMemoryTime(saturdays, null, at(22, 23, 59)), at(21, 10));
  assert.equal(missedMemoryTime(saturdays, null, at(23, 10)), null, 'dropped after that day');
});

test('anything done that day counts as having come, and a memory day the next day needs no nudge', () => {
  const saturdays: MemorySchedule = { days: [6], time: '10:00', minutes: 15 };
  assert.equal(missedMemoryTime(saturdays, at(21, 8), at(22, 11)), null, 'a story that morning counts');
  assert.deepEqual(missedMemoryTime(saturdays, at(20, 23), at(22, 11)), at(21, 10), 'the night before does not');
  const weekend: MemorySchedule = { days: [6, 0], time: '10:00', minutes: 15 };
  assert.equal(missedMemoryTime(weekend, null, at(22, 9)), null, 'Sunday has its own reminder');
  assert.equal(missedMemoryTime(NO_MEMORY_TIMES, null, at(22, 11)), null);
});

function setup(): { dir: string; key: Buffer } {
  return { dir: mkdtempSync(path.join(tmpdir(), 'echo-memory-times-')), key: randomBytes(32) };
}

test('the schedule and put-away questions are kept, sealed, and read back', () => {
  const { dir, key } = setup();
  assert.deepEqual(loadMemoryTimes(dir, key), { schedule: NO_MEMORY_TIMES, retired: [] });
  saveSchedule(dir, key, { days: [3, 1, 3], time: '18:30', minutes: 60 });
  assert.deepEqual(loadMemoryTimes(dir, key).schedule, { days: [1, 3], time: '18:30', minutes: 60 });

  assert.equal(retirePrompt(dir, key, '  Who was your first crush?  ', at(16, 10)), true);
  assert.equal(retirePrompt(dir, key, 'Who was your first crush?', at(16, 11)), false);
  assert.deepEqual(loadMemoryTimes(dir, key).retired, [{ text: 'Who was your first crush?', at: at(16, 10).toISOString() }]);
  assert.ok(!readFileSync(path.join(dir, 'memory-times.sealed'), 'utf8').includes('crush'));

  assert.equal(restorePrompt(dir, key, 'Who was your first crush?'), true);
  assert.equal(restorePrompt(dir, key, 'Who was your first crush?'), false);
  assert.deepEqual(loadMemoryTimes(dir, key).retired, []);
  assert.deepEqual(loadMemoryTimes(dir, key).schedule.days, [1, 3], 'putting a question away leaves the schedule alone');
});
