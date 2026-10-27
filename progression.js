// Sets judged against an exercise's target, and what the next set starts with.
//
// A target is { sets, repsFrom, repsTo, restSeconds }. Sets are { weightKg, reps, at } and can come
// in any order (the store gives them newest first): everything here sorts its own copy oldest first.

function pad(n) {
  return String(n).padStart(2, '0');
}

// The local calendar day, as 2026-10-20. A day is a session.
export function dayKey(date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function chronological(sets) {
  return [...sets].sort((a, b) => a.at.localeCompare(b.at));
}

// 'under' the rep range, 'in' it (both ends included), or 'over' it.
export function rangeVerdict(reps, target) {
  if (reps < target.repsFrom) return 'under';
  if (reps > target.repsTo) return 'over';
  return 'in';
}

// A day's sets of one exercise, judged by its first `target.sets` sets (extra sets don't count):
// 'heavier' when every planned set was done and reached the top of the range, 'lighter' when any
// fell under the range, 'keep' otherwise.
export function advice(daySets, target) {
  const planned = chronological(daySets).slice(0, target.sets);
  if (planned.some((s) => s.reps < target.repsFrom)) return 'lighter';
  if (planned.length === target.sets && planned.every((s) => s.reps >= target.repsTo)) return 'heavier';
  return 'keep';
}

// The sets done on a day (a dayKey), oldest first.
export function setsOnDay(sets, day) {
  return chronological(sets.filter((s) => dayKey(new Date(s.at)) === day));
}

// The sets of the most recent day before `today` (a dayKey) that has any, oldest first; [] if none.
export function lastSession(sets, today) {
  const earlier = chronological(sets).filter((s) => dayKey(new Date(s.at)) < today);
  return earlier.length ? setsOnDay(earlier, dayKey(new Date(earlier.at(-1).at))) : [];
}

// Runs of sets at the same weight, oldest first: [{ weightKg, reps: [12, 12] }, { weightKg, reps: [10] }].
export function byWeight(sets) {
  const runs = [];
  for (const set of chronological(sets)) {
    const run = runs.at(-1);
    if (run && run.weightKg === set.weightKg) run.reps.push(set.reps);
    else runs.push({ weightKg: set.weightKg, reps: [set.reps] });
  }
  return runs;
}

// What the next set of an exercise starts with, from its sets so far: { setNumber, weightKg, reps }.
// The first set of the day takes the weight of the first set last session, later ones the weight
// of the set before. Reps are those of the same set last session, else of the set before, else
// the top of the range. weightKg is null for no weight, as in the log.
export function prefill(sets, target, now = new Date()) {
  const today = setsOnDay(sets, dayKey(now));
  const last = lastSession(sets, dayKey(now));
  const before = today.at(-1);
  return {
    setNumber: today.length + 1,
    weightKg: before ? before.weightKg : (last[0]?.weightKg ?? null),
    reps: last[today.length]?.reps ?? before?.reps ?? target.repsTo,
  };
}
