import test from 'node:test';
import assert from 'node:assert/strict';
import {
  advice,
  byWeight,
  chronological,
  dayKey,
  lastSession,
  prefill,
  rangeVerdict,
  setsOnDay,
} from '../progression.js';

const TARGET = { sets: 3, repsFrom: 8, repsTo: 12, restSeconds: 90 };

// A set on a local day of October 2026, at a local hour and minute.
function set(day, hour, reps, weightKg = 60, minute = 0) {
  return { weightKg, reps, at: new Date(2026, 9, day, hour, minute).toISOString() };
}

// Newest first, as the store's setsFor gives them.
function newestFirst(sets) {
  return chronological(sets).reverse();
}

test('reps under, in and over the range', () => {
  assert.equal(rangeVerdict(7, TARGET), 'under');
  assert.equal(rangeVerdict(8, TARGET), 'in');
  assert.equal(rangeVerdict(12, TARGET), 'in');
  assert.equal(rangeVerdict(13, TARGET), 'over');
});

test('every planned set at the top of the range: go heavier', () => {
  assert.equal(advice([set(20, 10, 12), set(20, 11, 12), set(20, 12, 13)], TARGET), 'heavier');
});

test('a set under the range: go lighter, even before all sets are done', () => {
  assert.equal(advice([set(20, 10, 12), set(20, 11, 7)], TARGET), 'lighter');
  assert.equal(advice([set(20, 10, 12), set(20, 11, 11), set(20, 12, 7)], TARGET), 'lighter');
});

test('otherwise keep the weight, also when the planned sets are not all done', () => {
  assert.equal(advice([set(20, 10, 12), set(20, 11, 11), set(20, 12, 10)], TARGET), 'keep');
  assert.equal(advice([set(20, 10, 12), set(20, 11, 12)], TARGET), 'keep');
  assert.equal(advice([], TARGET), 'keep');
});

test('extra sets do not count, whatever order the sets come in', () => {
  const day = [set(20, 10, 12), set(20, 11, 12), set(20, 12, 12), set(20, 13, 6)];
  assert.equal(advice(day, TARGET), 'heavier');
  assert.equal(advice(newestFirst(day), TARGET), 'heavier');
  const extraAtTop = [set(20, 10, 12), set(20, 11, 7), set(20, 12, 12), set(20, 13, 12)];
  assert.equal(advice(newestFirst(extraAtTop), TARGET), 'lighter');
});

test('a single rep number is a range of one, as in 5 x 5', () => {
  const fives = { sets: 5, repsFrom: 5, repsTo: 5, restSeconds: 180 };
  const day = [10, 11, 12, 13, 14].map((hour) => set(20, hour, 5, 100));
  assert.equal(advice(day, fives), 'heavier');
  assert.equal(advice([...day.slice(0, 4), set(20, 14, 4, 100)], fives), 'lighter');
  assert.equal(rangeVerdict(5, fives), 'in');
  assert.equal(rangeVerdict(6, fives), 'over');
});

test('a day is the local calendar day', () => {
  assert.equal(dayKey(new Date(2026, 9, 5, 23, 59)), '2026-10-05');
  const sets = [set(20, 23, 10, 60, 59), set(21, 0, 9, 60, 1), set(21, 9, 8)];
  assert.deepEqual(setsOnDay(newestFirst(sets), '2026-10-21').map((s) => s.reps), [9, 8]);
});

test('the last session is the most recent earlier day, oldest set first', () => {
  const sets = [set(14, 10, 10), set(14, 11, 9), set(17, 10, 12), set(17, 11, 11), set(20, 10, 12)];
  assert.deepEqual(lastSession(newestFirst(sets), '2026-10-20').map((s) => s.reps), [12, 11]);
  assert.deepEqual(lastSession(sets, '2026-10-17').map((s) => s.reps), [10, 9]);
  assert.deepEqual(lastSession(sets, '2026-10-14'), []);
  assert.deepEqual(lastSession([], '2026-10-14'), []);
});

test('sets are grouped into runs at the same weight', () => {
  const sets = [set(20, 10, 12, 60), set(20, 11, 12, 60), set(20, 12, 10, 55), set(20, 13, 8, null)];
  assert.deepEqual(byWeight(newestFirst(sets)), [
    { weightKg: 60, reps: [12, 12] },
    { weightKg: 55, reps: [10] },
    { weightKg: null, reps: [8] },
  ]);
});

test('the first set ever starts at the top of the range with no weight', () => {
  assert.deepEqual(prefill([], TARGET, new Date(2026, 9, 20, 9)), { setNumber: 1, weightKg: null, reps: 12 });
});

test('the first set of the day starts from the first set last session', () => {
  const last = [set(17, 10, 11, 60), set(17, 11, 10, 55), set(17, 12, 9, 55)];
  assert.deepEqual(prefill(newestFirst(last), TARGET, new Date(2026, 9, 20, 9)), {
    setNumber: 1,
    weightKg: 60,
    reps: 11,
  });
});

test('a later set takes the weight of the set before and the reps of the same set last session', () => {
  const sets = [set(17, 10, 11, 60), set(17, 11, 10, 60), set(20, 10, 12, 62.5)];
  const now = new Date(2026, 9, 20, 11);
  assert.deepEqual(prefill(newestFirst(sets), TARGET, now), { setNumber: 2, weightKg: 62.5, reps: 10 });
  assert.deepEqual(prefill(sets, TARGET, now), prefill(newestFirst(sets), TARGET, now));
});

test('a set past the last session takes the reps of the set before', () => {
  const sets = [set(17, 10, 11, 60), set(20, 10, 12, 60), set(20, 11, 9, 60)];
  assert.deepEqual(prefill(newestFirst(sets), TARGET, new Date(2026, 9, 20, 12)), {
    setNumber: 3,
    weightKg: 60,
    reps: 9,
  });
});

test('no weight carries over as no weight', () => {
  const sets = [set(17, 10, 15, null)];
  assert.deepEqual(prefill(sets, TARGET, new Date(2026, 9, 20, 9)), { setNumber: 1, weightKg: null, reps: 15 });
});
