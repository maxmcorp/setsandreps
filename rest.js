// What is said during a rest between sets. Times are seconds relative to the end of the rest,
// so they are all at or before 0, the moment the next set starts.

export const COUNTDOWN_FROM = 10;

// The time left is called out at these, when the rest is longer than that.
const CALLOUTS = [60, 30];

// Everything spoken during a rest of `restSeconds`, in order:
// { at: seconds relative to the end, n: the number spoken, kind: 'callout' | 'countdown' | 'zero' }.
export function restEvents(restSeconds) {
  const events = CALLOUTS.filter((left) => left > COUNTDOWN_FROM && left < restSeconds).map((left) => ({
    at: 0 - left,
    n: left,
    kind: 'callout',
  }));
  for (let left = Math.min(COUNTDOWN_FROM, restSeconds); restSeconds > 0 && left >= 0; left--) {
    events.push({ at: 0 - left, n: left, kind: left === 0 ? 'zero' : 'countdown' });
  }
  return events;
}

// The numbers a rest can speak, so missing sound files can be reported.
export function spokenNumbers(restSeconds) {
  return [...new Set(restEvents(restSeconds).map((e) => e.n))].sort((a, b) => a - b);
}
