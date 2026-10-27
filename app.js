import { restEvents, spokenNumbers } from './rest.js';
import { advice, byWeight, dayKey, lastSession, prefill, rangeVerdict, setsOnDay } from './progression.js';
import { createStore, DEFAULT_TARGET, validTarget } from './store.js';
import { createVoice } from './audio.js';
import { createWakeLock } from './wakelock.js';

const $ = (id) => document.getElementById(id);

// A screen change can come under a finger that is still tapping (a double tap on Save set, a tap
// on Skip rest as the rest runs out), so taps on the set, rest and result screens are ignored
// for this long after one opens.
const TAP_GUARD_MS = 500;
// The longest rest, for the numbers the voice may need.
const MAX_REST = 600;
// The rest screen turns green for the last seconds, to be seen from the bench.
const READY_SECONDS = 10;
// The select options that open the new-exercise, new-group and edit-group forms, and the
// one that lists every exercise.
const NEW_EXERCISE = '\u0000new';
const NEW_GROUP = '\u0000new-group';
const EDIT_GROUP = '\u0000edit-group';
const ALL = '\u0000all';

const ADVICE = { heavier: 'Go heavier', keep: 'Keep the weight', lighter: 'Go lighter' };

const store = createStore(localStorage);
const voice = createVoice();
const wakeLock = createWakeLock((held) =>
  showBanner(held ? '' : 'The screen may lock during a rest. Set Auto-Lock to Never in Settings, Display & Brightness.'),
);

let screen = 'start';
let tapsAllowedAt = 0;
// The exercise on the set, rest and result screens.
let workout = null;
// The set being corrected by Fix that set, or null when the set screen is for a new set.
let fixing = null;
// The rest in progress: { endsAt (a Date.now() time), seconds (the whole rest), frame }.
let rest = null;
// The start screen's group: a group's name, or ALL.
let group = ALL;
let historyExercise = null;
// The day the start screen's ticks were drawn for.
let tickedDay = null;

// Formatting

const kgFormat = new Intl.NumberFormat(undefined, { maximumFractionDigits: 2, useGrouping: false });
const dayFormat = new Intl.DateTimeFormat(undefined, { weekday: 'short', day: 'numeric', month: 'short' });
const timeFormat = new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit' });

function kg(weightKg) {
  return weightKg === null ? 'no weight' : `${kgFormat.format(weightKg)} kg`;
}

// 60 kg × 12, 12 · 55 kg × 10
function describe(sets) {
  return byWeight(sets)
    .map((run) => `${kg(run.weightKg)} × ${run.reps.join(', ')}`)
    .join(' · ');
}

function repRange(target) {
  return target.repsFrom === target.repsTo ? `${target.repsFrom}` : `${target.repsFrom}–${target.repsTo}`;
}

function clock(seconds) {
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}

function describeTarget(target) {
  const restText = target.restSeconds ? `rest ${clock(target.restSeconds)}` : 'no rest';
  return `${target.sets} × ${repRange(target)} · ${restText}`;
}

// '' is no weight (null); text that isn't a weight is undefined. Accepts "42,5" as well as "42.5".
function parseWeight(text) {
  const clean = text.trim().replace(',', '.');
  if (!clean) return null;
  const value = Number(clean);
  return Number.isFinite(value) && value >= 0 ? Math.round(value * 100) / 100 : undefined;
}

// A whole number, or undefined. `blank` is what an empty field means.
function parseWhole(text, blank) {
  const clean = text.trim();
  if (!clean) return blank;
  return /^\d+$/.test(clean) ? Number(clean) : undefined;
}

// Seconds, typed as 90 or 1:30.
function parseRest(text) {
  const clock = text.trim().match(/^(\d+):([0-5]\d)$/);
  return clock ? Number(clock[1]) * 60 + Number(clock[2]) : parseWhole(text, 0);
}

function listNumbers(numbers) {
  return numbers.length <= 6 ? numbers.join(', ') : `${numbers.slice(0, 5).join(', ')} and ${numbers.length - 5} more`;
}

function today() {
  return dayKey(new Date());
}

// Today's sets of an exercise, oldest first.
function todaySets(exercise) {
  return setsOnDay(store.setsFor(exercise), today());
}

function doneToday(exercise) {
  return todaySets(exercise).length >= store.targetOf(exercise).sets;
}

// Whether any of the sets was done with a weight, so advice can talk about adding weight.
function weighted(sets) {
  return sets.some((s) => s.weightKg !== null);
}

// Target forms: the inputs `${prefix}-sets`, `-from`, `-to` and `-rest`.

function fillTarget(prefix, target) {
  $(`${prefix}-sets`).value = target.sets;
  $(`${prefix}-from`).value = target.repsFrom;
  $(`${prefix}-to`).value = target.repsFrom === target.repsTo ? '' : target.repsTo;
  $(`${prefix}-rest`).value = target.restSeconds;
}

// { target } or { error }. A blank second rep number makes a single number, as in 5 × 5.
function readTarget(prefix) {
  const sets = parseWhole($(`${prefix}-sets`).value);
  const repsFrom = parseWhole($(`${prefix}-from`).value);
  const repsTo = parseWhole($(`${prefix}-to`).value, repsFrom);
  const restSeconds = parseRest($(`${prefix}-rest`).value);
  if (!(sets >= 1 && sets <= 20)) return { error: 'Sets must be a whole number from 1 to 20.' };
  if (!(repsFrom >= 1 && repsFrom <= 100) || !(repsTo >= 1 && repsTo <= 100)) {
    return { error: 'Reps must be whole numbers from 1 to 100.' };
  }
  if (repsTo < repsFrom) return { error: 'The second rep number must not be lower than the first.' };
  if (!(restSeconds >= 0 && restSeconds <= MAX_REST)) return { error: 'Rest must be 0 to 600 seconds (10:00).' };
  return { target: validTarget({ sets, repsFrom, repsTo, restSeconds }) };
}

// Screens

// The screen stays on while a set or a rest is on screen, and only then.
function show(name) {
  for (const section of document.querySelectorAll('.screen')) section.hidden = section.id !== `screen-${name}`;
  document.body.dataset.screen = name;
  screen = name;
  tapsAllowedAt = performance.now() + TAP_GUARD_MS;
  if (name === 'set' || name === 'rest') wakeLock.acquire();
  else wakeLock.release();
  window.scrollTo(0, 0);
}

function guarded(handler) {
  return (event) => {
    if (performance.now() >= tapsAllowedAt) handler(event);
  };
}

function showBanner(text) {
  $('banner').textContent = text;
  $('banner').hidden = !text;
}

function setText(id, text) {
  const element = $(id);
  if (element.textContent !== String(text)) element.textContent = text;
}

// "Label <strong>bold</strong>. Rest" as the content of `element`.
function line(element, label, bold, rest) {
  const strong = document.createElement('strong');
  strong.textContent = bold;
  element.replaceChildren(label, strong, rest);
}

// The first tap arms a delete button, showing armedText(), and a second tap within 3 s runs
// the action. Returns a function that disarms it, for when what it would delete changes.
function confirmTap(button, armedText, action) {
  const text = button.textContent;
  let timer = 0;
  const disarm = () => {
    clearTimeout(timer);
    button.classList.remove('armed');
    button.textContent = text;
  };
  button.addEventListener('click', () => {
    if (!button.classList.contains('armed')) {
      button.classList.add('armed');
      button.textContent = armedText();
      timer = setTimeout(disarm, 3000);
      return;
    }
    disarm();
    action();
  });
  return disarm;
}

// Start screen

function renderStart() {
  const current = store.lastExercise ?? store.exercises[0] ?? null;
  group = store.lastGroup ?? ALL;
  // An exercise can be in several groups: stay in the last one picked if it has the exercise.
  if (current && !groupExercises().includes(current)) group = store.groupsOf(current)[0] ?? ALL;
  renderGroups();
  renderExercises(current);
  renderSummary(current);
}

function groupExercises() {
  return group === ALL ? store.exercises : store.exercisesIn(group);
}

// The first exercise in the start screen's group not done today, or null if all are.
function nextExercise() {
  return groupExercises().find((name) => !doneToday(name)) ?? null;
}

function renderGroups() {
  $('group').replaceChildren(
    ...store.groups.map((name) => new Option(name, name)),
    new Option('All exercises', ALL),
    new Option('+ Add group', NEW_GROUP),
    ...(group === ALL ? [] : [new Option(`Rename or delete ${group}`, EDIT_GROUP)]),
  );
  $('group').value = group;
  $('group-field').hidden = false;
  $('new-group').hidden = true;
  $('edit-group').hidden = true;
}

// Shows the new-group or edit-group form in place of the group and exercise fields.
function openGroupForm(form) {
  for (const id of ['group-field', 'exercise-field', 'new-exercise', 'new-group', 'edit-group']) {
    $(id).hidden = id !== form;
  }
  $(`${form}-name`).focus();
}

// Exercises done today are ticked, ones started show how many sets are done. A group without
// exercises opens the new-exercise form.
function renderExercises(current) {
  const exercises = groupExercises();
  $('exercise').replaceChildren(
    ...exercises.map((name) => {
      const done = todaySets(name).length;
      const { sets } = store.targetOf(name);
      const label = done >= sets ? `${name} ✓` : done > 0 ? `${name} ${done}/${sets}` : name;
      return new Option(label, name);
    }),
    new Option('+ Add exercise', NEW_EXERCISE),
  );
  tickedDay = today();
  if (current) $('exercise').value = current;
  $('exercise-field').hidden = exercises.length === 0;
  $('new-exercise').hidden = exercises.length > 0;
  $('new-exercise-cancel').hidden = exercises.length === 0;
  if (exercises.length === 0) fillTarget('new', DEFAULT_TARGET);
}

// Shows a group and selects its first exercise not done today.
function chooseGroup(name) {
  group = name;
  store.selectGroup(name === ALL ? null : name);
  const first = nextExercise() ?? groupExercises()[0] ?? null;
  if (first) store.selectExercise(first);
  renderGroups();
  renderExercises(first);
  renderSummary(first);
}

const LAST_ADVICE = {
  heavier: (target, withWeight) => (withWeight ? 'Go heavier.' : 'Make it harder.'),
  keep: (target) => `Keep the weight, aim for ${target.repsTo}.`,
  lighter: (target, withWeight) => (withWeight ? 'Go lighter.' : 'Make it easier.'),
};

// The target, last session and today's sets of the exercise picked.
function renderSummary(exercise) {
  const targetLine = $('start-target');
  const lastLine = $('start-last');
  const todayLine = $('start-today');
  targetLine.hidden = !exercise;
  todayLine.hidden = true;
  if (!exercise) {
    lastLine.textContent = 'Add the exercise you are about to do.';
    return;
  }
  const target = store.targetOf(exercise);
  targetLine.textContent = describeTarget(target);
  const sets = store.setsFor(exercise);
  const last = lastSession(sets, today());
  if (last.length) {
    const said = LAST_ADVICE[advice(last, target)](target, weighted(last));
    line(lastLine, 'Last time ', describe(last), `. ${said}`);
  } else {
    lastLine.textContent = 'First time doing this exercise.';
  }
  const done = setsOnDay(sets, today());
  if (done.length) {
    const next =
      done.length < target.sets
        ? `Set ${done.length + 1} of ${target.sets} next.`
        : `${target.sets === 1 ? 'The set is' : `All ${target.sets} sets`} done. Start adds another.`;
    line(todayLine, 'Today ', describe(done), `. ${next}`);
    todayLine.hidden = false;
  }
}

function showMessage(text) {
  $('start-message').textContent = text;
}

// Adds the exercise typed into the new-exercise form, also to the start screen's group, and
// selects it. An existing exercise keeps its target and other groups. Returns { name } or { error }.
function addTypedExercise() {
  const typed = $('new-exercise-name').value;
  if (!typed.trim()) return { error: 'Type a name for the exercise.' };
  const { target, error } = readTarget('new');
  if (error) return { error };
  const existed = store.exercises.length;
  const name = store.addExercise(typed, target);
  if (group !== ALL) store.addToGroup(name, group);
  $('new-exercise-name').value = '';
  fillTarget('new', DEFAULT_TARGET);
  store.selectExercise(name);
  const note = store.exercises.length === existed ? `${name} was already here, with its own target.` : '';
  return { name, note };
}

// The exercise to start, { name } or { error }: the selected one, or the one typed into the
// new-exercise form.
function currentExercise() {
  if (groupFormOpen()) return { error: 'Finish the group first, or tap Cancel.' };
  if (!$('new-exercise').hidden) {
    const added = addTypedExercise();
    if (added.name) renderStart();
    return added;
  }
  const value = $('exercise').value;
  return value && value !== NEW_EXERCISE ? { name: value } : { error: 'Add an exercise first.' };
}

function groupFormOpen() {
  return !$('new-group').hidden || !$('edit-group').hidden;
}

$('group').addEventListener('change', (event) => {
  const value = event.target.value;
  showMessage('');
  if (value === NEW_GROUP) {
    openGroupForm('new-group');
  } else if (value === EDIT_GROUP) {
    $('edit-group-name').value = group;
    disarmDeleteGroup();
    openGroupForm('edit-group');
  } else {
    chooseGroup(value);
  }
});

$('new-group').addEventListener('submit', (event) => {
  event.preventDefault();
  const name = store.addGroup($('new-group-name').value);
  if (!name) {
    showMessage('Type a name for the group.');
    return;
  }
  $('new-group-name').value = '';
  $('new-group-name').blur();
  showMessage('');
  chooseGroup(name);
});

$('new-group-cancel').addEventListener('click', () => {
  $('new-group-name').value = '';
  showMessage('');
  renderStart();
});

$('exercise').addEventListener('change', (event) => {
  const value = event.target.value;
  showMessage('');
  if (value === NEW_EXERCISE) {
    $('exercise-field').hidden = true;
    $('new-exercise').hidden = false;
    fillTarget('new', DEFAULT_TARGET);
    // The lines shown were for the previous exercise.
    renderSummary(null);
    $('new-exercise-name').focus();
    return;
  }
  store.selectExercise(value);
  renderSummary(value);
});

$('new-exercise').addEventListener('submit', (event) => {
  event.preventDefault();
  const added = addTypedExercise();
  if (added.error) {
    showMessage(added.error);
    return;
  }
  document.activeElement?.blur();
  renderStart();
  showMessage(added.note);
});

$('new-exercise-cancel').addEventListener('click', () => {
  $('new-exercise-name').value = '';
  showMessage('');
  renderStart();
});

$('edit-group').addEventListener('submit', (event) => {
  event.preventDefault();
  const typed = $('edit-group-name').value;
  const name = store.renameGroup(group, typed);
  if (!name) {
    showMessage(typed.trim() ? 'There is already a group with that name.' : 'Type a name for the group.');
    return;
  }
  $('edit-group-name').blur();
  showMessage('');
  renderStart();
});

$('edit-group-cancel').addEventListener('click', () => {
  showMessage('');
  renderStart();
});

const disarmDeleteGroup = confirmTap(
  $('delete-group'),
  () => 'Tap again to delete',
  () => {
    const name = group;
    store.deleteGroup(name);
    renderStart();
    showMessage(`Deleted ${name}. Its exercises are still in All exercises.`);
  },
);

// Number fields: a tap selects what is there, so typing replaces it; Enter closes the keyboard.
for (const input of document.querySelectorAll('input[inputmode]')) {
  input.addEventListener('focus', (event) => event.target.select());
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') event.target.blur();
  });
}

$('open-history').addEventListener('click', () => openHistory(store.lastExercise));

$('start-button').addEventListener('click', () => {
  const { name, error, note } = currentExercise();
  if (!name) {
    showMessage(error);
    return;
  }
  showMessage('');
  document.activeElement?.blur();
  voice.unlock();
  store.selectExercise(name);
  openSet(name);
  if (note) setMessage(note);
});

// Set screen

// Opens the set screen for the next set of `exercise`, or with `fix` (a set of today's) to correct it.
function openSet(exercise, fix = null) {
  workout = exercise;
  fixing = fix;
  const target = store.targetOf(exercise);
  const sets = store.setsFor(exercise);
  const done = setsOnDay(sets, today());
  const next = prefill(sets, target);
  const values = fix ?? next;
  if (fix) {
    setText('set-heading', `Fix set ${done.findIndex((s) => s.id === fix.id) + 1}`);
  } else {
    setText('set-heading', next.setNumber > target.sets ? `Set ${next.setNumber}, extra` : `Set ${next.setNumber} of ${target.sets}`);
  }
  setText('set-exercise', exercise);
  setText('set-target', `${repRange(target)} reps`);
  $('weight').value = values.weightKg === null ? '' : kgFormat.format(values.weightKg);
  $('reps').value = String(values.reps);
  const shown = done.filter((s) => s.id !== fix?.id);
  const last = lastSession(sets, today());
  if (shown.length) line($('set-info'), 'Today ', describe(shown), '');
  else if (last.length) line($('set-info'), 'Last time ', describe(last), '');
  else $('set-info').textContent = '';
  setMessage('');
  show('set');
}

function setMessage(text) {
  $('set-message').textContent = text;
}

function stepReps(by) {
  const reps = parseWhole($('reps').value) ?? 0;
  $('reps').value = String(Math.min(999, Math.max(0, reps + by)));
  setMessage('');
}

$('reps-down').addEventListener('click', () => stepReps(-1));
$('reps-up').addEventListener('click', () => stepReps(1));

$('set-back').addEventListener('click', () => {
  fixing = null;
  renderStart();
  show('start');
});

$('save-button').addEventListener(
  'click',
  guarded(() => {
    if (screen !== 'set') return;
    const weightKg = parseWeight($('weight').value);
    if (weightKg === undefined) {
      setMessage('Weight must be a number, like 42.5.');
      return;
    }
    const reps = parseWhole($('reps').value);
    if (reps === undefined || reps > 999) {
      setMessage('Reps must be a whole number, like 10.');
      return;
    }
    document.activeElement?.blur();
    voice.unlock();
    const fixed = fixing && store.updateSet(fixing.id, { weightKg, reps });
    if (!fixed) store.addSet({ exercise: workout, weightKg, reps });
    fixing = null;
    afterSet();
  }),
);

// After a set is saved: the result once the planned sets are done, else a rest, else the next set.
function afterSet() {
  const target = store.targetOf(workout);
  if (todaySets(workout).length >= target.sets) showResult();
  else startRest();
}

// Corrects the exercise's latest set of today.
function fixLast() {
  const last = todaySets(workout).at(-1);
  openSet(workout, last ?? null);
}

// Rest

// The rest runs from the time of the exercise's latest set, so it carries on where it was after
// a fix, after One more set, and after the app was in the background.
function startRest() {
  const target = store.targetOf(workout);
  const done = todaySets(workout);
  const last = done.at(-1);
  const endsAt = last ? Date.parse(last.at) + target.restSeconds * 1000 : 0;
  if (endsAt <= Date.now()) {
    openSet(workout);
    return;
  }
  rest = { endsAt, seconds: target.restSeconds, frame: 0 };
  scheduleVoice();
  const number = done.length + 1;
  setText('rest-context', workout);
  setText('rest-next', number > target.sets ? `Set ${number}, extra, on zero` : `Set ${number} of ${target.sets} on zero`);
  line($('rest-saved'), 'Saved ', `${kg(last.weightKg)} × ${last.reps}`, '');
  document.body.dataset.zone = 'none';
  show('rest');
  restFrame();
}

function scheduleVoice() {
  voice.start(restEvents(rest.seconds), performance.now() + (rest.endsAt - Date.now()));
}

function restFrame() {
  if (!rest) return;
  const left = (rest.endsAt - Date.now()) / 1000;
  if (left <= 0) {
    // On time, "0" is playing now: let it. Long past, the app was away and nothing queued should play.
    const late = left < -1;
    endRest({ silence: late });
    if (!late) navigator.vibrate?.(400);
    openSet(workout);
    return;
  }
  setText('rest-left', clock(Math.ceil(left)));
  $('rest-bar').style.setProperty('--left', Math.min(left / rest.seconds, 1));
  document.body.dataset.zone = left <= READY_SECONDS ? 'ready' : 'none';
  rest.frame = requestAnimationFrame(restFrame);
}

function endRest({ silence }) {
  if (!rest) return;
  cancelAnimationFrame(rest.frame);
  if (silence) voice.stop();
  rest = null;
  document.body.dataset.zone = 'none';
}

$('skip-button').addEventListener(
  'click',
  guarded(() => {
    endRest({ silence: true });
    openSet(workout);
  }),
);

$('rest-fix').addEventListener(
  'click',
  guarded(() => {
    endRest({ silence: true });
    fixLast();
  }),
);

// Back in the app. Sounds queued before it went to the background would play late, so the rest
// of the rest is scheduled again; ticks drawn yesterday are redrawn.
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'visible') return;
  if (rest) {
    if (rest.endsAt <= Date.now()) {
      endRest({ silence: true });
      openSet(workout);
    } else {
      voice.resume();
      scheduleVoice();
    }
  } else if (screen === 'start' && tickedDay !== today()) {
    renderStart();
  }
});

// Result

const REASON = {
  heavier: (target, withWeight) =>
    `Every set reached ${target.repsTo}. ${withWeight ? 'Add weight' : 'Make it harder'} next time.`,
  keep: (target) => `Aim for ${target.repsTo} on every set.`,
  lighter: (target, withWeight) =>
    `A set fell under ${target.repsFrom}. ${withWeight ? 'Take some weight off' : 'Make it easier'} next time.`,
};

function showResult() {
  const target = store.targetOf(workout);
  const done = todaySets(workout);
  const result = advice(done, target);
  document.body.dataset.advice = result;
  $('result-advice').textContent = ADVICE[result];
  $('result-context').textContent = workout;
  $('result-sets').textContent = describe(done);
  $('result-reason').textContent = REASON[result](target, weighted(done.slice(0, target.sets)));
  show('result');
}

// Moves on to the group's next exercise not done today; any other can still be picked.
$('next-button').addEventListener(
  'click',
  guarded(() => {
    const next = nextExercise();
    if (next) store.selectExercise(next);
    renderStart();
    show('start');
  }),
);

$('more-button').addEventListener(
  'click',
  guarded(() => {
    voice.unlock();
    startRest();
  }),
);

$('result-fix').addEventListener('click', guarded(fixLast));

$('result-history').addEventListener(
  'click',
  guarded(() => openHistory(workout)),
);

// History

function openHistory(exercise) {
  historyExercise = exercise ?? store.lastExercise ?? store.exercises[0] ?? null;
  $('backup-status').textContent = '';
  renderHistory();
  show('history');
}

// Every exercise, under its group's name once there are groups.
function exerciseOptions() {
  const options = (names) => names.map((name) => new Option(name, name));
  const groups = store.groups;
  if (!groups.length) return options(store.exercises);
  return [...groups, null]
    .map((name) => {
      const optgroup = document.createElement('optgroup');
      optgroup.label = name ?? 'No group';
      optgroup.append(...options(store.exercisesIn(name)));
      return optgroup;
    })
    .filter((optgroup) => optgroup.children.length > 0);
}

function renderHistory() {
  const select = $('history-exercise');
  select.replaceChildren(...exerciseOptions());
  if (historyExercise) select.value = historyExercise;
  $('history-group-list').replaceChildren(...store.groups.map(groupCheck));
  $('history-groups').hidden = !historyExercise || store.groups.length === 0;
  const target = historyExercise ? store.targetOf(historyExercise) : null;
  $('history-target').hidden = !historyExercise;
  if (target) line($('history-target'), 'Target ', describeTarget(target), '');
  const sets = historyExercise ? store.setsFor(historyExercise) : [];

  // Days newest first, each day's sets oldest first, so they are numbered as they were done.
  const days = new Map();
  for (const set of sets) {
    const when = new Date(set.at);
    const key = dayKey(when);
    if (!days.has(key)) days.set(key, { label: dayFormat.format(when), sets: [] });
    days.get(key).sets.unshift(set);
  }

  $('history-list').replaceChildren(
    ...[...days.values()].map((day) => {
      const block = document.createElement('section');
      block.className = 'day';
      const heading = document.createElement('h3');
      heading.textContent = day.label;
      const list = document.createElement('ol');
      list.append(...day.sets.map((set, i) => historyEntry(set, i + 1, target)));
      block.append(heading, list);
      return block;
    }),
  );
  $('history-empty').hidden = sets.length > 0;
  $('exercise-actions').hidden = !historyExercise;
  $('rename-form').hidden = true;
  $('target-form').hidden = true;
  disarmDeleteExercise();
}

// A checkbox that puts the shown exercise in a group or takes it out.
function groupCheck(name) {
  const label = document.createElement('label');
  label.className = 'check';
  const box = document.createElement('input');
  box.type = 'checkbox';
  box.checked = store.groupsOf(historyExercise).includes(name);
  box.addEventListener('change', () => {
    if (box.checked) store.addToGroup(historyExercise, name);
    else store.removeFromGroup(historyExercise, name);
    renderHistory();
  });
  label.append(box, name);
  return label;
}

function historyEntry(set, number, target) {
  const item = document.createElement('li');
  item.className = `entry ${rangeVerdict(set.reps, target)}`;
  const which = document.createElement('span');
  which.className = 'which';
  const when = document.createElement('small');
  when.textContent = timeFormat.format(new Date(set.at));
  which.append(`Set ${number}`, when);
  const weight = document.createElement('span');
  weight.textContent = kg(set.weightKg);
  const reps = document.createElement('span');
  reps.className = 'count';
  reps.textContent = `× ${set.reps}`;
  const remove = document.createElement('button');
  remove.type = 'button';
  remove.className = 'delete';
  remove.textContent = '✕';
  remove.setAttribute('aria-label', `Delete set ${number}`);
  confirmTap(
    remove,
    () => 'Delete',
    () => {
      store.deleteSet(set.id);
      renderHistory();
    },
  );
  item.append(which, weight, reps, remove);
  return item;
}

$('history-exercise').addEventListener('change', (event) => {
  historyExercise = event.target.value;
  renderHistory();
});

$('change-target').addEventListener('click', () => {
  fillTarget('edit', store.targetOf(historyExercise));
  $('target-message').textContent = '';
  $('exercise-actions').hidden = true;
  $('target-form').hidden = false;
  $('edit-sets').focus();
});

$('target-form').addEventListener('submit', (event) => {
  event.preventDefault();
  const { target, error } = readTarget('edit');
  if (error) {
    $('target-message').textContent = error;
    return;
  }
  store.setTarget(historyExercise, target);
  document.activeElement?.blur();
  renderHistory();
});

$('target-cancel').addEventListener('click', renderHistory);

$('rename-exercise').addEventListener('click', () => {
  $('rename-exercise-name').value = historyExercise;
  $('rename-message').textContent = '';
  $('exercise-actions').hidden = true;
  $('rename-form').hidden = false;
  $('rename-exercise-name').focus();
});

$('rename-form').addEventListener('submit', (event) => {
  event.preventDefault();
  const typed = $('rename-exercise-name').value;
  const name = store.renameExercise(historyExercise, typed);
  if (!name) {
    $('rename-message').textContent = typed.trim()
      ? 'There is already an exercise with that name.'
      : 'Type a name for the exercise.';
    return;
  }
  $('rename-exercise-name').blur();
  if (workout === historyExercise) workout = name;
  historyExercise = name;
  renderHistory();
});

$('rename-cancel').addEventListener('click', renderHistory);

const disarmDeleteExercise = confirmTap(
  $('delete-exercise'),
  () => {
    const count = store.setsFor(historyExercise).length;
    return count === 0 ? 'Tap again to delete' : `Tap again to delete it and ${count === 1 ? '1 set' : `${count} sets`}`;
  },
  () => {
    store.deleteExercise(historyExercise);
    historyExercise = store.exercises[0] ?? null;
    renderHistory();
  },
);

$('history-back').addEventListener('click', () => {
  renderStart();
  show('start');
});

function backupStatus(text) {
  $('backup-status').textContent = text;
}

// Hands a file to the iOS share sheet (Save to Files, AirDrop, Mail), or downloads it
// where sharing files isn't supported.
async function exportFile(name, type, text) {
  const file = new File([text], name, { type });
  if (navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file] });
      backupStatus(`Exported ${name}.`);
    } catch (error) {
      if (error.name !== 'AbortError') backupStatus(`Export failed: ${error.message}`);
    }
    return;
  }
  const url = URL.createObjectURL(file);
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  backupStatus(`Downloaded ${name}.`);
}

$('export-csv').addEventListener('click', () => exportFile(`setsandreps-${today()}.csv`, 'text/csv', store.toCSV()));
$('export-json').addEventListener('click', () =>
  exportFile(`setsandreps-backup-${today()}.json`, 'application/json', store.toJSON()),
);

$('import-json').addEventListener('change', async (event) => {
  const file = event.target.files[0];
  event.target.value = '';
  if (!file) return;
  try {
    const { added } = store.importJSON(await file.text());
    backupStatus(added === 1 ? 'Restored 1 set.' : `Restored ${added} sets.`);
    historyExercise ??= store.exercises[0] ?? null;
    renderHistory();
  } catch {
    backupStatus(`${file.name} is not a Sets & Reps backup.`);
  }
});

// Startup

// iPhones (and iPads, which report themselves as Macs with touch) mute the voice with the
// ring/silent switch; elsewhere it is the media volume.
const isApple = /iPhone|iPad|iPod/.test(navigator.userAgent) || (/Macintosh/.test(navigator.userAgent) && navigator.maxTouchPoints > 1);
if (isApple) $('volume-note').textContent = 'Ring switch on, or the rest countdown is silent.';

renderStart();
show('start');

voice.load().then((available) => {
  const needed = spokenNumbers(MAX_REST);
  const missing = needed.filter((n) => !available.includes(n));
  if (!missing.length) return;
  $('sound-note').textContent =
    missing.length === needed.length
      ? 'No recorded numbers yet, so beeps play instead.'
      : `Beeps play for ${listNumbers(missing)}: no recording yet.`;
  $('sound-note').hidden = false;
});

navigator.storage?.persist?.();

// Offline support. Only over https, so local testing always loads fresh files.
if ('serviceWorker' in navigator && location.protocol === 'https:') {
  const hadController = Boolean(navigator.serviceWorker.controller);
  navigator.serviceWorker.register('sw.js');
  // A new version took over: reload, but never in the middle of a workout.
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (hadController && screen === 'start' && !rest) location.reload();
  });
}
