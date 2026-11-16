// Memory times: the days and time the person chose to be asked about their
// life, and the questions they have put away with "I don't remember".
//
// The phone app does the reminding. These rules decide when a memory time is
// next, and whether one gentle nudge is owed for a missed one. There are no
// streaks and nothing counts what was missed.

/** 0 is Sunday, as in `Date.getDay()`. */
export type Weekday = 0 | 1 | 2 | 3 | 4 | 5 | 6;

export const SESSION_MINUTES = [15, 30, 60] as const;
export type SessionMinutes = (typeof SESSION_MINUTES)[number];

export interface MemorySchedule {
  /** No days means no memory times. */
  days: Weekday[];
  /** Local time, 24-hour "HH:MM". */
  time: string;
  minutes: SessionMinutes;
}

export const NO_MEMORY_TIMES: MemorySchedule = { days: [], time: '10:00', minutes: 15 };

/** Monday first, the way people write a week down. */
export const WEEKDAYS: readonly { day: Weekday; name: string }[] = [
  { day: 1, name: 'Monday' },
  { day: 2, name: 'Tuesday' },
  { day: 3, name: 'Wednesday' },
  { day: 4, name: 'Thursday' },
  { day: 5, name: 'Friday' },
  { day: 6, name: 'Saturday' },
  { day: 0, name: 'Sunday' },
];

/** What the screen shows about memory times. Times are ISO strings. */
export interface MemoryTimesView {
  schedule: MemorySchedule;
  /** Questions put away with "I don't remember". Never suggested again. */
  retired: string[];
  /** When the next memory time starts, or null when none are set. */
  next: string | null;
  /** The memory time that was missed, while its one nudge is owed; otherwise null. */
  missed: string | null;
}

const TIME = /^([01]\d|2[0-3]):([0-5]\d)$/;

/** Plain-English problems with a schedule. An empty list means it is fine. */
export function scheduleProblems(schedule: MemorySchedule): string[] {
  const problems: string[] = [];
  const days = schedule.days as readonly number[];
  if (!days.every((day) => Number.isInteger(day) && day >= 0 && day <= 6) || new Set(days).size !== days.length) {
    problems.push('Choose each day at most once.');
  }
  if (!TIME.test(schedule.time)) problems.push('Choose a time of day, such as 10:30.');
  if (!(SESSION_MINUTES as readonly number[]).includes(schedule.minutes)) problems.push('Choose 15, 30 or 60 minutes.');
  return problems;
}

function startOn(day: Date, time: string): Date {
  const [hours, minutes] = time.split(':').map(Number);
  return new Date(day.getFullYear(), day.getMonth(), day.getDate(), hours, minutes);
}

function dayOffset(from: Date, days: number): Date {
  return new Date(from.getFullYear(), from.getMonth(), from.getDate() + days);
}

function isMemoryDay(schedule: MemorySchedule, day: Date): boolean {
  return schedule.days.includes(day.getDay() as Weekday);
}

/** The next memory time that starts after `now`, or null when none are set. */
export function nextMemoryTime(schedule: MemorySchedule, now: Date): Date | null {
  if (schedule.days.length === 0 || !TIME.test(schedule.time)) return null;
  for (let offset = 0; offset <= 7; offset += 1) {
    const day = dayOffset(now, offset);
    const start = startOn(day, schedule.time);
    if (isMemoryDay(schedule, day) && start > now) return start;
  }
  return null;
}

function lastMemoryTime(schedule: MemorySchedule, now: Date): Date | null {
  if (schedule.days.length === 0 || !TIME.test(schedule.time)) return null;
  for (let offset = 0; offset <= 7; offset += 1) {
    const day = dayOffset(now, -offset);
    const start = startOn(day, schedule.time);
    if (isMemoryDay(schedule, day) && start <= now) return start;
  }
  return null;
}

/**
 * The memory time the person missed, if one gentle nudge is owed now; otherwise null.
 *
 * Anything done that day (a story, or "I don't remember") counts as having
 * come. The nudge is owed only on the following day, from the usual time, and
 * not at all when that day is itself a memory day: its own reminder does the
 * job. After that day it is dropped, so nothing piles up.
 */
export function missedMemoryTime(schedule: MemorySchedule, lastActivity: Date | null, now: Date): Date | null {
  const missed = lastMemoryTime(schedule, now);
  if (!missed) return null;
  if (now.getTime() < missed.getTime() + schedule.minutes * 60 * 1000) return null;
  const missedDay = dayOffset(missed, 0);
  if (lastActivity && lastActivity >= missedDay) return null;
  const nextDay = dayOffset(missed, 1);
  if (isMemoryDay(schedule, nextDay)) return null;
  const nudgeFrom = startOn(nextDay, schedule.time);
  return now >= nudgeFrom && now < dayOffset(nextDay, 1) ? missed : null;
}
