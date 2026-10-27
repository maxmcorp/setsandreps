// The training log, kept in the phone's local storage.

import { chronological, dayKey, rangeVerdict } from './progression.js';

const KEY = 'setsandreps.v1';

export const DEFAULT_TARGET = Object.freeze({ sets: 3, repsFrom: 8, repsTo: 12, restSeconds: 90 });

const MAX_REPS = 999;

function whole(value, from, to) {
  return Number.isInteger(value) && value >= from && value <= to;
}

// A copy of the target if it makes sense, else null: 1-20 sets, a rep range within 1-100 that
// may be a single number, and 0-600 s of rest (0 is no rest).
export function validTarget(t) {
  if (!t || typeof t !== 'object') return null;
  const { sets, repsFrom, repsTo, restSeconds } = t;
  const ok = whole(sets, 1, 20) && whole(repsFrom, 1, 100) && whole(repsTo, repsFrom, 100) && whole(restSeconds, 0, 600);
  return ok ? { sets, repsFrom, repsTo, restSeconds } : null;
}

// Targets are kept by exercise name in an object without a prototype, so an exercise called
// "constructor" or "__proto__" is an ordinary key.
function noTargets() {
  return Object.create(null);
}

function empty() {
  return { exercises: [], targets: noTargets(), groups: [], sets: [], lastExercise: null, lastGroup: null };
}

function tidy(name) {
  return name.trim().replace(/\s+/g, ' ');
}

function newId() {
  if (globalThis.crypto?.randomUUID) return crypto.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function isSet(s) {
  return (
    s &&
    typeof s.id === 'string' &&
    typeof s.exercise === 'string' &&
    tidy(s.exercise) !== '' &&
    whole(s.reps, 0, MAX_REPS) &&
    (s.weightKg === null || (Number.isFinite(s.weightKg) && s.weightKg >= 0)) &&
    typeof s.at === 'string' &&
    Number.isFinite(Date.parse(s.at))
  );
}

function isGroup(g) {
  return g && typeof g.name === 'string' && tidy(g.name) !== '' && Array.isArray(g.exercises);
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

// A filter that lets each key through the first time only.
function firstTime() {
  const seen = new Set();
  return (key) => {
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  };
}

// Saved data that would break the app is dropped, and repeats are read once: only this app
// writes it, but a restore by an older version could have stored a set with a bad date or a
// repeated id, or an exercise twice. `dropped` tells if anything was.
function clean(saved) {
  let dropped = false;
  // A list that is missing (an older log) is empty; one that is something else is dropped.
  const keep = (list, ok) => {
    if (list !== undefined && !Array.isArray(list)) dropped = true;
    const all = Array.isArray(list) ? list : [];
    const kept = all.filter(ok);
    if (kept.length !== all.length) dropped = true;
    return kept;
  };
  const newExercise = firstTime();
  const exercises = keep(saved.exercises, (e) => typeof e === 'string' && tidy(e) !== '' && newExercise(e));
  // A target that doesn't make sense, or is for no exercise, is dropped: the default stands in.
  const targets = noTargets();
  if (saved.targets !== undefined && !isPlainObject(saved.targets)) dropped = true;
  for (const [name, t] of Object.entries(isPlainObject(saved.targets) ? saved.targets : {})) {
    const target = validTarget(t);
    if (target && exercises.includes(name)) targets[name] = target;
    else dropped = true;
  }
  const newGroup = firstTime();
  const newSetId = firstTime();
  const data = {
    exercises,
    targets,
    groups: keep(saved.groups, (g) => isGroup(g) && newGroup(g.name.toLocaleLowerCase())).map((g) => {
      const newMember = firstTime();
      return { name: g.name, exercises: keep(g.exercises, (e) => exercises.includes(e) && newMember(e)) };
    }),
    sets: keep(saved.sets, (s) => isSet(s) && newSetId(s.id)),
    lastExercise: typeof saved.lastExercise === 'string' ? saved.lastExercise : null,
    lastGroup: typeof saved.lastGroup === 'string' ? saved.lastGroup : null,
  };
  return { data, dropped };
}

function newestFirst(a, b) {
  return b.at.localeCompare(a.at);
}

function pad(n) {
  return String(n).padStart(2, '0');
}

function csvField(value) {
  const text = value === null || value === undefined ? '' : String(value);
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function createStore(storage, key = KEY) {
  let data = read();

  // Unreadable data starts a fresh log rather than breaking the app. Whenever anything saved
  // can't be used, the original text is kept aside, so the next write doesn't destroy the only copy.
  function read() {
    const raw = storage.getItem(key);
    let saved = null;
    try {
      saved = JSON.parse(raw);
    } catch {
      // Handled below.
    }
    const readable = saved && Array.isArray(saved.exercises) && Array.isArray(saved.sets);
    const { data, dropped } = readable ? clean(saved) : { data: empty(), dropped: Boolean(raw) };
    if (dropped) {
      try {
        storage.setItem(`${key}.unreadable`, raw);
      } catch {
        // No room for the copy.
      }
    }
    return data;
  }

  function write() {
    storage.setItem(key, JSON.stringify(data));
  }

  function findExercise(name) {
    const wanted = name.toLocaleLowerCase();
    return data.exercises.find((e) => e.toLocaleLowerCase() === wanted);
  }

  function findGroup(name) {
    const wanted = name.toLocaleLowerCase();
    return data.groups.find((g) => g.name.toLocaleLowerCase() === wanted);
  }

  function findGroupNamed(name) {
    return data.groups.find((g) => g.name === name);
  }

  function inAnyGroup(exercise) {
    return data.groups.some((g) => g.exercises.includes(exercise));
  }

  return {
    get exercises() {
      return [...data.exercises];
    },

    get lastExercise() {
      return data.lastExercise && findExercise(data.lastExercise) ? data.lastExercise : null;
    },

    // Returns the stored name, which is the existing one if it differs only in case; an existing
    // exercise keeps its own target. Null if the name is blank or the target doesn't make sense.
    addExercise(name, target = DEFAULT_TARGET) {
      const clean = tidy(name);
      const checked = validTarget(target);
      if (!clean || !checked) return null;
      const existing = findExercise(clean);
      if (existing) return existing;
      data.exercises.push(clean);
      data.targets[clean] = checked;
      write();
      return clean;
    },

    // Renames an exercise in its sets, target and groups too. Returns the new name, or null if it
    // is blank or another exercise has it.
    renameExercise(name, newName) {
      const clean = tidy(newName);
      if (!data.exercises.includes(name) || !clean) return null;
      const other = findExercise(clean);
      if (other && other !== name) return null;
      const rename = (e) => (e === name ? clean : e);
      data.exercises = data.exercises.map(rename);
      for (const s of data.sets) s.exercise = rename(s.exercise);
      for (const g of data.groups) g.exercises = g.exercises.map(rename);
      if (name in data.targets) {
        const target = data.targets[name];
        delete data.targets[name];
        data.targets[clean] = target;
      }
      data.lastExercise = rename(data.lastExercise);
      write();
      return clean;
    },

    // Deletes an exercise, its target and all its sets.
    deleteExercise(name) {
      if (!data.exercises.includes(name)) return false;
      data.exercises = data.exercises.filter((e) => e !== name);
      data.sets = data.sets.filter((s) => s.exercise !== name);
      delete data.targets[name];
      for (const g of data.groups) g.exercises = g.exercises.filter((e) => e !== name);
      if (data.lastExercise === name) data.lastExercise = null;
      write();
      return true;
    },

    // The exercise's sets, rep range and rest: { sets, repsFrom, repsTo, restSeconds }.
    targetOf(name) {
      return { ...(data.targets[name] ?? DEFAULT_TARGET) };
    },

    // Returns the stored target, or null if the exercise doesn't exist or the target doesn't make sense.
    setTarget(name, target) {
      const checked = validTarget(target);
      if (!data.exercises.includes(name) || !checked) return null;
      data.targets[name] = checked;
      write();
      return { ...checked };
    },

    get groups() {
      return data.groups.map((g) => g.name);
    },

    // Returns the stored name, which is the existing one if it differs only in case.
    addGroup(name) {
      const clean = tidy(name);
      if (!clean) return null;
      const existing = findGroup(clean);
      if (existing) return existing.name;
      data.groups.push({ name: clean, exercises: [] });
      write();
      return clean;
    },

    // Returns the new name, or null if it is blank or another group has it.
    renameGroup(name, newName) {
      const group = findGroupNamed(name);
      const clean = tidy(newName);
      if (!group || !clean) return null;
      const other = findGroup(clean);
      if (other && other !== group) return null;
      group.name = clean;
      if (data.lastGroup === name) data.lastGroup = clean;
      write();
      return clean;
    },

    // The group's exercises and their sets stay.
    deleteGroup(name) {
      const group = findGroupNamed(name);
      if (!group) return false;
      data.groups = data.groups.filter((g) => g !== group);
      if (data.lastGroup === name) data.lastGroup = null;
      write();
      return true;
    },

    // The group last picked, or null.
    get lastGroup() {
      return data.lastGroup && findGroupNamed(data.lastGroup) ? data.lastGroup : null;
    },

    selectGroup(name) {
      data.lastGroup = name;
      write();
    },

    // An exercise can be in any number of groups.
    groupsOf(exercise) {
      return data.groups.filter((g) => g.exercises.includes(exercise)).map((g) => g.name);
    },

    // Puts an exercise at the end of a group, unless it is in it already.
    addToGroup(exercise, group) {
      const found = findGroupNamed(group);
      if (!found || found.exercises.includes(exercise)) return;
      found.exercises.push(exercise);
      write();
    },

    removeFromGroup(exercise, group) {
      const found = findGroupNamed(group);
      if (!found) return;
      found.exercises = found.exercises.filter((e) => e !== exercise);
      write();
    },

    // A group's exercises in the order they were put in it; null gives the exercises in no group.
    exercisesIn(group) {
      if (group === null) return data.exercises.filter((e) => !inAnyGroup(e));
      return [...(findGroupNamed(group)?.exercises ?? [])];
    },

    selectExercise(name) {
      data.lastExercise = name;
      write();
    },

    addSet({ exercise, weightKg, reps, at = new Date().toISOString() }) {
      const set = { id: newId(), exercise, weightKg, reps, at };
      data.sets.push(set);
      data.lastExercise = exercise;
      write();
      return set;
    },

    // Corrects a set's weight and reps; it keeps its id and time. Returns the set, or null if it is gone.
    updateSet(id, { weightKg, reps }) {
      const set = data.sets.find((s) => s.id === id);
      if (!set) return null;
      Object.assign(set, { weightKg, reps });
      write();
      return set;
    },

    deleteSet(id) {
      const before = data.sets.length;
      data.sets = data.sets.filter((s) => s.id !== id);
      write();
      return data.sets.length < before;
    },

    // Newest first.
    setsFor(exercise) {
      return data.sets.filter((s) => s.exercise === exercise).sort(newestFirst);
    },

    lastSet(exercise) {
      return this.setsFor(exercise)[0] ?? null;
    },

    toJSON() {
      return JSON.stringify({ app: 'setsandreps', version: 1, ...data }, null, 2);
    },

    // One row per set, oldest first. `set` numbers the sets of an exercise on a day; `range` is
    // judged by the exercise's target now.
    toCSV() {
      const rows = [['date', 'time', 'exercise', 'set', 'weight_kg', 'reps', 'range']];
      const counts = new Map();
      for (const s of chronological(data.sets)) {
        const d = new Date(s.at);
        const day = dayKey(d);
        const count = (counts.get(`${day}\u0000${s.exercise}`) ?? 0) + 1;
        counts.set(`${day}\u0000${s.exercise}`, count);
        rows.push([
          day,
          `${pad(d.getHours())}:${pad(d.getMinutes())}`,
          s.exercise,
          count,
          s.weightKg,
          s.reps,
          rangeVerdict(s.reps, this.targetOf(s.exercise)),
        ]);
      }
      return rows.map((r) => r.map(csvField).join(',')).join('\n') + '\n';
    },

    // Merges a backup into the log: sets already present (same id) are kept as they are, groups
    // get the backup's exercises added to their own, and exercises new to this log take the
    // backup's target. Names are matched the way typed names are, and sets or targets that don't
    // make sense are skipped. Throws if the text is not a Sets & Reps backup.
    importJSON(text) {
      let backup;
      try {
        backup = JSON.parse(text);
      } catch {
        throw new Error('not-a-backup');
      }
      if (!backup || backup.app !== 'setsandreps' || !Array.isArray(backup.sets)) {
        throw new Error('not-a-backup');
      }
      const known = new Set(data.sets.map((s) => s.id));
      const fresh = backup.sets.filter((s) => {
        if (!isSet(s) || known.has(s.id)) return false;
        known.add(s.id);
        return true;
      });
      const here = new Set(data.exercises);
      const groups = Array.isArray(backup.groups) ? backup.groups.filter(isGroup) : [];
      const exercises = Array.isArray(backup.exercises) ? backup.exercises : [];
      const names = [...exercises, ...groups.flatMap((g) => g.exercises), ...fresh.map((s) => s.exercise)];
      for (const name of names) {
        const clean = typeof name === 'string' ? tidy(name) : '';
        if (clean && !findExercise(clean)) data.exercises.push(clean);
      }
      for (const [name, t] of Object.entries(isPlainObject(backup.targets) ? backup.targets : {})) {
        const found = findExercise(tidy(name));
        const target = validTarget(t);
        if (found && !here.has(found) && target) data.targets[found] = target;
      }
      for (const group of groups) {
        const name = tidy(group.name);
        const mine = findGroup(name) ?? { name, exercises: [] };
        if (!data.groups.includes(mine)) data.groups.push(mine);
        for (const exercise of group.exercises) {
          const found = typeof exercise === 'string' && findExercise(tidy(exercise));
          if (found && !mine.exercises.includes(found)) mine.exercises.push(found);
        }
      }
      data.sets.push(
        ...fresh.map((s) => ({
          ...s,
          exercise: findExercise(tidy(s.exercise)),
          at: new Date(s.at).toISOString(),
        })),
      );
      write();
      return { added: fresh.length };
    },
  };
}
