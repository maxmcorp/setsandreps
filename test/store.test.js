import test from 'node:test';
import assert from 'node:assert/strict';
import { createStore, DEFAULT_TARGET, validTarget } from '../store.js';

function memoryStorage(initial = {}) {
  const items = { ...initial };
  return {
    getItem: (k) => (k in items ? items[k] : null),
    setItem: (k, v) => {
      items[k] = String(v);
    },
  };
}

const KEY = 'setsandreps.v1';
const FIVES = { sets: 5, repsFrom: 5, repsTo: 5, restSeconds: 180 };

test('exercises are trimmed and de-duplicated ignoring case', () => {
  const store = createStore(memoryStorage());
  assert.equal(store.addExercise('  Leg   press '), 'Leg press');
  assert.equal(store.addExercise('leg press'), 'Leg press');
  assert.equal(store.addExercise('   '), null);
  assert.deepEqual(store.exercises, ['Leg press']);
});

test('the log survives a reload', () => {
  const storage = memoryStorage();
  const first = createStore(storage);
  first.addExercise('Chest press', FIVES);
  first.addSet({ exercise: 'Chest press', weightKg: 42.5, reps: 5 });
  const again = createStore(storage);
  assert.deepEqual(again.exercises, ['Chest press']);
  assert.equal(again.lastExercise, 'Chest press');
  assert.equal(again.lastSet('Chest press').weightKg, 42.5);
  assert.equal(again.lastSet('Chest press').reps, 5);
  assert.deepEqual(again.targetOf('Chest press'), FIVES);
});

test('the last set is the newest one for that exercise', () => {
  const store = createStore(memoryStorage());
  store.addExercise('Row');
  store.addExercise('Squat');
  store.addSet({ exercise: 'Row', weightKg: 30, reps: 12, at: '2026-10-01T10:00:00.000Z' });
  store.addSet({ exercise: 'Row', weightKg: 27.5, reps: 10, at: '2026-10-08T10:00:00.000Z' });
  store.addSet({ exercise: 'Squat', weightKg: 60, reps: 8, at: '2026-10-09T10:00:00.000Z' });
  assert.equal(store.lastSet('Row').weightKg, 27.5);
  assert.deepEqual(store.setsFor('Row').map((s) => s.reps), [10, 12]);
  assert.equal(store.lastSet('Bench'), null);
});

test('a deleted set is gone', () => {
  const store = createStore(memoryStorage());
  store.addExercise('Row');
  const set = store.addSet({ exercise: 'Row', weightKg: 30, reps: 12 });
  assert.equal(store.deleteSet(set.id), true);
  assert.equal(store.lastSet('Row'), null);
  assert.equal(store.deleteSet(set.id), false);
});

test('a corrected set keeps its id and time, and survives a reload', () => {
  const storage = memoryStorage();
  const store = createStore(storage);
  store.addExercise('Row');
  const set = store.addSet({ exercise: 'Row', weightKg: 30, reps: 12, at: '2026-10-01T10:00:00.000Z' });
  assert.deepEqual(store.updateSet(set.id, { weightKg: 32.5, reps: 11 }), { ...set, weightKg: 32.5, reps: 11 });
  const again = createStore(storage).lastSet('Row');
  assert.deepEqual([again.id, again.at, again.weightKg, again.reps], [set.id, set.at, 32.5, 11]);
  assert.equal(store.updateSet('gone', { weightKg: 1, reps: 1 }), null);
});

test('a deleted exercise takes its sets, target and group places with it', () => {
  const store = createStore(memoryStorage());
  store.addGroup('Pull');
  store.addExercise('Row', FIVES);
  store.addExercise('Pulldown');
  store.addToGroup('Row', 'Pull');
  store.addSet({ exercise: 'Row', weightKg: 30, reps: 5 });
  store.addSet({ exercise: 'Pulldown', weightKg: 40, reps: 10 });
  assert.equal(store.deleteExercise('Row'), true);
  assert.equal(store.deleteExercise('Row'), false);
  assert.deepEqual(store.exercises, ['Pulldown']);
  assert.deepEqual(store.setsFor('Row'), []);
  assert.equal(store.lastSet('Pulldown').reps, 10);
  assert.deepEqual(store.exercisesIn('Pull'), []);
  assert.equal(store.lastExercise, 'Pulldown');
  store.addExercise('Row');
  assert.deepEqual(store.targetOf('Row'), DEFAULT_TARGET);
});

test("a renamed exercise keeps its sets, target and groups, but can't take another exercise's name", () => {
  const store = createStore(memoryStorage());
  store.addGroup('Legs');
  store.addExercise('Legpress', FIVES);
  store.addExercise('Squat');
  store.addToGroup('Legpress', 'Legs');
  store.addSet({ exercise: 'Legpress', weightKg: 80, reps: 5 });
  assert.equal(store.renameExercise('Legpress', ' Leg  press '), 'Leg press');
  assert.deepEqual(store.exercises, ['Leg press', 'Squat']);
  assert.equal(store.lastSet('Leg press').weightKg, 80);
  assert.deepEqual(store.setsFor('Legpress'), []);
  assert.deepEqual(store.exercisesIn('Legs'), ['Leg press']);
  assert.equal(store.lastExercise, 'Leg press');
  assert.deepEqual(store.targetOf('Leg press'), FIVES);
  assert.deepEqual(store.targetOf('Legpress'), DEFAULT_TARGET);
  assert.equal(store.renameExercise('Leg press', 'leg PRESS'), 'leg PRESS');
  assert.deepEqual(store.targetOf('leg PRESS'), FIVES);
  assert.equal(store.renameExercise('leg PRESS', 'squat'), null);
  assert.equal(store.renameExercise('leg PRESS', '  '), null);
  assert.equal(store.renameExercise('Bench', 'Row'), null);
  assert.deepEqual(store.exercises, ['leg PRESS', 'Squat']);
});

test('a new exercise gets the default target unless given one', () => {
  const store = createStore(memoryStorage());
  store.addExercise('Row');
  assert.deepEqual(store.targetOf('Row'), { sets: 3, repsFrom: 8, repsTo: 12, restSeconds: 90 });
  store.addExercise('Squat', FIVES);
  assert.deepEqual(store.targetOf('Squat'), FIVES);
  assert.deepEqual(store.targetOf('Nothing'), DEFAULT_TARGET);
});

test('adding an exercise that exists keeps its target', () => {
  const store = createStore(memoryStorage());
  store.addExercise('Squat', FIVES);
  assert.equal(store.addExercise(' squat ', { sets: 3, repsFrom: 8, repsTo: 12, restSeconds: 60 }), 'Squat');
  assert.deepEqual(store.targetOf('Squat'), FIVES);
});

test('a target is changed only to one that makes sense', () => {
  const store = createStore(memoryStorage());
  store.addExercise('Row');
  const base = { sets: 3, repsFrom: 8, repsTo: 12, restSeconds: 90 };
  for (const bad of [
    { ...base, sets: 0 },
    { ...base, sets: 21 },
    { ...base, repsFrom: 0 },
    { ...base, repsFrom: 10, repsTo: 9 },
    { ...base, repsTo: 101 },
    { ...base, sets: 2.5 },
    { ...base, repsFrom: '8' },
    { ...base, restSeconds: 601 },
    { ...base, restSeconds: -1 },
    null,
  ]) {
    assert.equal(store.setTarget('Row', bad), null, JSON.stringify(bad));
  }
  assert.deepEqual(store.targetOf('Row'), DEFAULT_TARGET);
  assert.deepEqual(store.setTarget('Row', { ...base, repsFrom: 6, repsTo: 6, restSeconds: 0 }), {
    ...base,
    repsFrom: 6,
    repsTo: 6,
    restSeconds: 0,
  });
  assert.equal(store.setTarget('Bench', base), null);
  assert.equal(store.addExercise('Bench', { ...base, sets: 0 }), null);
  assert.deepEqual(store.exercises, ['Row']);
});

test('a valid target is copied without anything else', () => {
  assert.deepEqual(validTarget({ ...FIVES, extra: 1 }), FIVES);
});

test('exercise names that are object keys are ordinary names', () => {
  const storage = memoryStorage();
  const store = createStore(storage);
  store.addExercise('constructor');
  store.addExercise('__proto__', FIVES);
  assert.deepEqual(store.targetOf('constructor'), DEFAULT_TARGET);
  assert.deepEqual(store.targetOf('__proto__'), FIVES);
  assert.deepEqual(createStore(storage).targetOf('__proto__'), FIVES);
});

test('broken saved data starts a fresh log, and a copy of it is kept', () => {
  const storage = memoryStorage({ [KEY]: '{not json' });
  const store = createStore(storage);
  assert.deepEqual(store.exercises, []);
  store.addExercise('Row');
  assert.equal(storage.getItem(`${KEY}.unreadable`), '{not json');
});

test('saved entries that would break the app are dropped, and the original is kept aside', () => {
  const good = { id: 'a', exercise: 'Row', weightKg: 30, reps: 10, at: '2026-10-01T10:00:00.000Z' };
  const saved = JSON.stringify({
    exercises: [7, 'Row', ' '],
    targets: { Row: FIVES, Ghost: FIVES },
    groups: [null, { name: 'Pull', exercises: ['Row', 7, 'Ghost'] }],
    sets: [good, { ...good, id: 'b', at: 'yesterday' }, { ...good, id: 'c', reps: 7.5 }, { ...good, id: 'd', reps: -1 }, null],
    lastExercise: 5,
    lastGroup: 'Pull',
  });
  const storage = memoryStorage({ [KEY]: saved });
  const store = createStore(storage);
  assert.deepEqual(store.exercises, ['Row']);
  assert.deepEqual(store.targetOf('Row'), FIVES);
  assert.deepEqual(store.groups, ['Pull']);
  assert.deepEqual(store.exercisesIn('Pull'), ['Row']);
  assert.deepEqual(store.setsFor('Row').map((s) => s.id), ['a']);
  assert.equal(store.lastExercise, null);
  assert.equal(store.lastGroup, 'Pull');
  assert.equal(storage.getItem(`${KEY}.unreadable`), saved);

  const nullGroups = memoryStorage({ [KEY]: JSON.stringify({ exercises: ['Row'], groups: null, sets: [] }) });
  assert.deepEqual(createStore(nullGroups).groups, []);
});

test('a saved target that makes no sense falls back to the default, with a copy kept', () => {
  const saved = JSON.stringify({ exercises: ['Row', 'Squat'], targets: { Row: { ...FIVES, sets: 0 }, Squat: FIVES }, sets: [] });
  const storage = memoryStorage({ [KEY]: saved });
  const store = createStore(storage);
  assert.deepEqual(store.targetOf('Row'), DEFAULT_TARGET);
  assert.deepEqual(store.targetOf('Squat'), FIVES);
  assert.equal(storage.getItem(`${KEY}.unreadable`), saved);

  const listTargets = memoryStorage({ [KEY]: JSON.stringify({ exercises: ['Row'], targets: [FIVES], sets: [] }) });
  assert.deepEqual(createStore(listTargets).targetOf('Row'), DEFAULT_TARGET);
  assert.notEqual(listTargets.getItem(`${KEY}.unreadable`), null);
});

test('repeats in a saved log are read once, so deleting a set deletes only that one', () => {
  const set = { id: 'x', exercise: 'Row', weightKg: 30, reps: 10, at: '2026-10-01T10:00:00.000Z' };
  const saved = JSON.stringify({
    exercises: ['Row', 'Row', 'Squat'],
    groups: [
      { name: 'Pull', exercises: ['Row', 'Row'] },
      { name: 'pull', exercises: ['Squat'] },
    ],
    sets: [set, { ...set, reps: 11 }, { ...set, id: 'y', reps: 9, at: '2026-10-02T10:00:00.000Z' }],
  });
  const storage = memoryStorage({ [KEY]: saved });
  const store = createStore(storage);
  assert.deepEqual(store.exercises, ['Row', 'Squat']);
  assert.deepEqual(store.groups, ['Pull']);
  assert.deepEqual(store.exercisesIn('Pull'), ['Row']);
  assert.deepEqual(store.setsFor('Row').map((s) => s.reps), [9, 10]);
  store.deleteSet('x');
  assert.deepEqual(store.setsFor('Row').map((s) => s.id), ['y']);
  assert.equal(storage.getItem(`${KEY}.unreadable`), saved);
});

test('a saved list that is not a list is dropped with a copy kept, but a missing one is not', () => {
  const storage = memoryStorage({ [KEY]: JSON.stringify({ exercises: ['Row'], groups: {}, sets: [] }) });
  assert.deepEqual(createStore(storage).groups, []);
  assert.notEqual(storage.getItem(`${KEY}.unreadable`), null);
});

test('a sound log, old or new, is read as it is with no copy kept aside', () => {
  const old = memoryStorage({ [KEY]: JSON.stringify({ exercises: ['Row'], sets: [], lastExercise: 'Row' }) });
  assert.equal(createStore(old).lastExercise, 'Row');
  assert.equal(old.getItem(`${KEY}.unreadable`), null);
  const storage = memoryStorage();
  const store = createStore(storage);
  store.addGroup('Pull');
  store.addExercise('Row', FIVES);
  store.addToGroup('Row', 'Pull');
  store.addSet({ exercise: 'Row', weightKg: null, reps: 0 });
  createStore(storage);
  assert.equal(storage.getItem(`${KEY}.unreadable`), null);
});

test('a backup restores into an empty log, and restoring twice adds nothing', () => {
  const source = createStore(memoryStorage());
  source.addExercise('Row', FIVES);
  source.addExercise('Pulldown');
  source.addSet({ exercise: 'Row', weightKg: 30, reps: 5 });
  source.addSet({ exercise: 'Row', weightKg: null, reps: 4 });
  const backup = source.toJSON();

  const target = createStore(memoryStorage());
  assert.deepEqual(target.importJSON(backup), { added: 2 });
  assert.deepEqual(target.exercises, ['Row', 'Pulldown']);
  assert.deepEqual(target.setsFor('Row').map((s) => s.reps).sort(), [4, 5]);
  assert.deepEqual(target.targetOf('Row'), FIVES);
  assert.deepEqual(target.importJSON(backup), { added: 0 });
});

test('restoring matches exercise names ignoring case', () => {
  const target = createStore(memoryStorage());
  target.addExercise('Leg press');
  const backup = JSON.stringify({
    app: 'setsandreps',
    exercises: ['leg press'],
    sets: [{ id: 'a', exercise: 'leg press', weightKg: 80, reps: 10, at: '2026-10-01T10:00:00.000Z' }],
  });
  target.importJSON(backup);
  assert.deepEqual(target.exercises, ['Leg press']);
  assert.equal(target.lastSet('Leg press').reps, 10);
});

test('restoring tidies names the way typed names are, so nothing is duplicated or orphaned', () => {
  const target = createStore(memoryStorage());
  target.addExercise('Leg press');
  const backup = JSON.stringify({
    app: 'setsandreps',
    exercises: [' Leg press ', 'Calf  raise'],
    groups: [{ name: ' Legs ', exercises: [' leg press', 'calf raise '] }],
    sets: [
      { id: 'a', exercise: ' leg  press ', weightKg: 80, reps: 10, at: '2026-10-01T10:00:00.000Z' },
      { id: 'b', exercise: 'Calf raise', weightKg: 20, reps: 15, at: '2026-10-01T10:05:00.000Z' },
    ],
  });
  assert.deepEqual(target.importJSON(backup), { added: 2 });
  assert.deepEqual(target.exercises, ['Leg press', 'Calf raise']);
  assert.deepEqual(target.groups, ['Legs']);
  assert.deepEqual(target.exercisesIn('Legs'), ['Leg press', 'Calf raise']);
  assert.equal(target.lastSet('Leg press').reps, 10);
  assert.equal(target.lastSet('Calf raise').reps, 15);
});

test('restoring gives new exercises the backup target, matched like names; existing ones keep theirs', () => {
  const target = createStore(memoryStorage());
  target.addExercise('Bench press');
  const sixes = { sets: 4, repsFrom: 6, repsTo: 6, restSeconds: 120 };
  const backup = JSON.stringify({
    app: 'setsandreps',
    exercises: ['Bench press', 'Calf  raise', 'Row', 'Dip'],
    targets: { ' bench  PRESS': FIVES, ' calf RAISE ': sixes, Row: { ...FIVES, repsTo: 2 }, Ghost: FIVES },
    sets: [],
  });
  target.importJSON(backup);
  assert.deepEqual(target.exercises, ['Bench press', 'Calf raise', 'Row', 'Dip']);
  assert.deepEqual(target.targetOf('Bench press'), DEFAULT_TARGET);
  assert.deepEqual(target.targetOf('Calf raise'), sixes);
  assert.deepEqual(target.targetOf('Row'), DEFAULT_TARGET);
  assert.deepEqual(target.targetOf('Dip'), DEFAULT_TARGET);
  assert.deepEqual(target.exercises.includes('Ghost'), false);
});

test('restoring skips sets with bad dates or numbers, and repeated ids', () => {
  const target = createStore(memoryStorage());
  const set = (id, fields) => ({ id, exercise: 'Row', weightKg: 30, reps: 10, at: '2026-10-01T10:00:00.000Z', ...fields });
  const backup = JSON.stringify({
    app: 'setsandreps',
    sets: [
      set('ok', {}),
      set('ok', { reps: 9 }),
      set('date', { at: 'yesterday' }),
      set('reps', { reps: -5 }),
      set('half', { reps: 2.5 }),
      set('many', { reps: 1000 }),
      set('none', { reps: undefined }),
      set('kg', { weightKg: -1 }),
      set('blank', { exercise: '  ' }),
      set('plain-date', { at: '2026-10-02' }),
    ],
  });
  assert.deepEqual(target.importJSON(backup), { added: 2 });
  assert.deepEqual(target.setsFor('Row').map((s) => s.id), ['plain-date', 'ok']);
  assert.equal(target.lastSet('Row').at, '2026-10-02T00:00:00.000Z');
  assert.deepEqual(target.importJSON(JSON.stringify({ app: 'setsandreps', exercises: 'Row', sets: [] })), { added: 0 });
});

test('a file that is not a backup is refused, a Superslow backup too', () => {
  const store = createStore(memoryStorage());
  assert.throws(() => store.importJSON('hello'), /not-a-backup/);
  assert.throws(() => store.importJSON('{"sets": []}'), /not-a-backup/);
  assert.throws(() => store.importJSON(JSON.stringify({ app: 'superslow', exercises: [], sets: [] })), /not-a-backup/);
});

test('CSV has a header and one row per set, oldest first, numbered per exercise and day', () => {
  const store = createStore(memoryStorage());
  store.addExercise('Press, seated');
  store.addExercise('Row');
  const at = (day, hour) => new Date(2026, 9, day, hour).toISOString();
  store.addSet({ exercise: 'Press, seated', weightKg: 20, reps: 13, at: at(2, 11) });
  store.addSet({ exercise: 'Press, seated', weightKg: null, reps: 7, at: at(1, 10) });
  store.addSet({ exercise: 'Row', weightKg: 30, reps: 10, at: at(2, 10) });
  store.addSet({ exercise: 'Press, seated', weightKg: 20, reps: 10, at: at(2, 10) });
  const lines = store.toCSV().trim().split('\n');
  assert.equal(lines[0], 'date,time,exercise,set,weight_kg,reps,range');
  assert.deepEqual(lines.slice(1), [
    '2026-10-01,10:00,"Press, seated",1,,7,under',
    '2026-10-02,10:00,Row,1,30,10,in',
    '2026-10-02,10:00,"Press, seated",1,20,10,in',
    '2026-10-02,11:00,"Press, seated",2,20,13,over',
  ]);
});

test('changing a target judges the sets already logged by the new one', () => {
  const store = createStore(memoryStorage());
  store.addExercise('Row');
  store.addSet({ exercise: 'Row', weightKg: 30, reps: 10 });
  assert.match(store.toCSV(), /,10,in\n$/);
  store.setTarget('Row', { sets: 3, repsFrom: 11, repsTo: 12, restSeconds: 90 });
  assert.match(store.toCSV(), /,10,under\n$/);
});

test('an exercise can be in several groups, and the rest are in no group', () => {
  const store = createStore(memoryStorage());
  assert.equal(store.addGroup(' Push '), 'Push');
  assert.equal(store.addGroup('push'), 'Push');
  assert.equal(store.addGroup('  '), null);
  store.addGroup('Pull');
  store.addGroup('Legs');
  for (const name of ['Chest press', 'Deadlift', 'Calf raise']) store.addExercise(name);
  store.addToGroup('Chest press', 'Push');
  store.addToGroup('Deadlift', 'Pull');
  store.addToGroup('Deadlift', 'Legs');
  store.addToGroup('Deadlift', 'Legs');
  assert.deepEqual(store.groups, ['Push', 'Pull', 'Legs']);
  assert.deepEqual(store.exercisesIn('Pull'), ['Deadlift']);
  assert.deepEqual(store.exercisesIn('Legs'), ['Deadlift']);
  assert.deepEqual(store.groupsOf('Deadlift'), ['Pull', 'Legs']);
  assert.deepEqual(store.exercisesIn(null), ['Calf raise']);
  store.removeFromGroup('Deadlift', 'Pull');
  assert.deepEqual(store.groupsOf('Deadlift'), ['Legs']);
  store.removeFromGroup('Deadlift', 'Legs');
  assert.deepEqual(store.exercisesIn(null), ['Deadlift', 'Calf raise']);
});

test('the last group picked is remembered, renamed with it, and forgotten when it is deleted', () => {
  const storage = memoryStorage();
  const store = createStore(storage);
  assert.equal(store.lastGroup, null);
  store.addGroup('Legs');
  store.selectGroup('Legs');
  assert.equal(createStore(storage).lastGroup, 'Legs');
  store.renameGroup('Legs', 'Lower');
  assert.equal(store.lastGroup, 'Lower');
  store.deleteGroup('Lower');
  assert.equal(store.lastGroup, null);
  store.addGroup('Lower');
  assert.equal(store.lastGroup, null);
});

test("a group can be renamed, but not to blank or to another group's name", () => {
  const store = createStore(memoryStorage());
  store.addGroup('Push');
  store.addGroup('Pull');
  store.addExercise('Chest press');
  store.addToGroup('Chest press', 'Push');
  assert.equal(store.renameGroup('Push', '  Upper  body '), 'Upper body');
  assert.deepEqual(store.exercisesIn('Upper body'), ['Chest press']);
  assert.equal(store.renameGroup('Upper body', 'upper BODY'), 'upper BODY');
  assert.equal(store.renameGroup('upper BODY', 'pull'), null);
  assert.equal(store.renameGroup('upper BODY', ' '), null);
  assert.deepEqual(store.groups, ['upper BODY', 'Pull']);
});

test('deleting a group keeps its exercises and their sets', () => {
  const store = createStore(memoryStorage());
  store.addGroup('Legs');
  store.addExercise('Leg press');
  store.addToGroup('Leg press', 'Legs');
  store.addSet({ exercise: 'Leg press', weightKg: 80, reps: 10 });
  assert.equal(store.deleteGroup('Legs'), true);
  assert.deepEqual(store.groups, []);
  assert.deepEqual(store.exercisesIn(null), ['Leg press']);
  assert.equal(store.lastSet('Leg press').reps, 10);
});

test('a log saved before groups loads with its exercises in no group', () => {
  const saved = JSON.stringify({ exercises: ['Row'], sets: [], lastExercise: 'Row' });
  const store = createStore(memoryStorage({ [KEY]: saved }));
  assert.deepEqual(store.groups, []);
  assert.deepEqual(store.exercisesIn(null), ['Row']);
  store.addGroup('Pull');
  store.addToGroup('Row', 'Pull');
  assert.deepEqual(store.exercisesIn('Pull'), ['Row']);
});

test('a backup adds its groups and their exercises to the ones already here', () => {
  const source = createStore(memoryStorage());
  source.addGroup('Pull');
  source.addGroup('Legs');
  for (const name of ['Row', 'Deadlift']) source.addExercise(name);
  source.addToGroup('Row', 'Pull');
  source.addToGroup('Deadlift', 'Pull');
  source.addToGroup('Deadlift', 'Legs');
  const backup = source.toJSON();

  const target = createStore(memoryStorage());
  target.addGroup('pull');
  target.addExercise('deadlift');
  target.addToGroup('deadlift', 'pull');
  target.importJSON(backup);
  assert.deepEqual(target.groups, ['pull', 'Legs']);
  assert.deepEqual(target.exercisesIn('pull'), ['deadlift', 'Row']);
  assert.deepEqual(target.exercisesIn('Legs'), ['deadlift']);
  assert.deepEqual(target.importJSON(backup), { added: 0 });
  assert.deepEqual(target.exercisesIn('pull'), ['deadlift', 'Row']);
});
