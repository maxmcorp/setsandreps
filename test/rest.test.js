import test from 'node:test';
import assert from 'node:assert/strict';
import { restEvents, spokenNumbers } from '../rest.js';

const said = (events) => events.map((e) => e.n);

test('a 90 s rest calls 60 and 30 seconds left, then counts down 10 to 0', () => {
  const events = restEvents(90);
  assert.deepEqual(said(events), [60, 30, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1, 0]);
  assert.deepEqual(
    events.map((e) => e.at),
    [-60, -30, -10, -9, -8, -7, -6, -5, -4, -3, -2, -1, 0],
  );
  assert.deepEqual(
    events.map((e) => e.kind),
    ['callout', 'callout', ...Array(10).fill('countdown'), 'zero'],
  );
});

test('a callout is only made when the rest is longer than it', () => {
  assert.deepEqual(said(restEvents(45)), [30, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1, 0]);
  assert.deepEqual(said(restEvents(30)), [10, 9, 8, 7, 6, 5, 4, 3, 2, 1, 0]);
  assert.deepEqual(said(restEvents(60)), [30, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1, 0]);
});

test('a rest shorter than the countdown counts down from its length', () => {
  assert.deepEqual(said(restEvents(5)), [5, 4, 3, 2, 1, 0]);
  assert.deepEqual(restEvents(5)[0].at, -5);
});

test('no rest says nothing', () => {
  assert.deepEqual(restEvents(0), []);
});

test('the spoken numbers are the files a rest needs', () => {
  assert.deepEqual(spokenNumbers(90), [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 30, 60]);
  assert.deepEqual(spokenNumbers(600), [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 30, 60]);
  assert.deepEqual(spokenNumbers(20), [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
});
