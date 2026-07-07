import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyCheck, MAX_ERRORS } from '../src/transitions.js';

const NOW = '2026-07-07T12:00:00.000Z';
const ok = (status, price) => ({ ok: true, status, price });

test('first check establishes baseline and never notifies, even if in stock', () => {
  const { state, notifications } = applyCheck(undefined, ok('IN_STOCK', 'INR 34500'), NOW);
  assert.deepEqual(notifications, []);
  assert.equal(state.status, 'IN_STOCK');
  assert.equal(state.notifiedInStock, true); // guarded so later flapping can't re-alert
  assert.equal(state.lastCheckedAt, NOW);
  assert.equal(state.lastChangedAt, NOW);
});

test('OUT_OF_STOCK → IN_STOCK notifies once', () => {
  const prev = applyCheck(undefined, ok('OUT_OF_STOCK'), NOW).state;
  const { state, notifications } = applyCheck(prev, ok('IN_STOCK'), NOW);
  assert.deepEqual(notifications, ['IN_STOCK']);
  assert.equal(state.notifiedInStock, true);
  // still in stock next run → no repeat
  const again = applyCheck(state, ok('IN_STOCK'), NOW);
  assert.deepEqual(again.notifications, []);
});

test('UNKNOWN → IN_STOCK also notifies', () => {
  const prev = applyCheck(undefined, ok('UNKNOWN'), NOW).state;
  const { notifications } = applyCheck(prev, ok('IN_STOCK'), NOW);
  assert.deepEqual(notifications, ['IN_STOCK']);
});

test('leaving IN_STOCK resets the flag so the next restock alerts again', () => {
  let s = applyCheck(undefined, ok('OUT_OF_STOCK'), NOW).state;
  s = applyCheck(s, ok('IN_STOCK'), NOW).state;          // notified
  s = applyCheck(s, ok('OUT_OF_STOCK'), NOW).state;       // sold out again
  assert.equal(s.notifiedInStock, false);
  const { notifications } = applyCheck(s, ok('IN_STOCK'), NOW);
  assert.deepEqual(notifications, ['IN_STOCK']);
});

test('errors accumulate; 3rd consecutive error → BLOCKED with one-time notification', () => {
  let s = applyCheck(undefined, ok('OUT_OF_STOCK'), NOW).state;
  let r = applyCheck(s, { ok: false }, NOW);
  assert.equal(r.state.consecutiveErrors, 1);
  assert.equal(r.state.status, 'OUT_OF_STOCK'); // keeps last known status
  assert.deepEqual(r.notifications, []);
  r = applyCheck(r.state, { ok: false }, NOW);
  assert.equal(r.state.consecutiveErrors, 2);
  r = applyCheck(r.state, { ok: false }, NOW);
  assert.equal(r.state.status, 'BLOCKED');
  assert.deepEqual(r.notifications, ['BLOCKED']);
  // stays blocked, but no second email
  r = applyCheck(r.state, { ok: false }, NOW);
  assert.equal(r.state.status, 'BLOCKED');
  assert.deepEqual(r.notifications, []);
  assert.equal(MAX_ERRORS, 3);
});

test('a successful check recovers from BLOCKED and re-arms the blocked email', () => {
  let s = { status: 'BLOCKED', consecutiveErrors: 5, notifiedInStock: false, notifiedBlocked: true, lastCheckedAt: NOW, lastChangedAt: NOW };
  const r = applyCheck(s, ok('OUT_OF_STOCK'), NOW);
  assert.equal(r.state.status, 'OUT_OF_STOCK');
  assert.equal(r.state.consecutiveErrors, 0);
  assert.equal(r.state.notifiedBlocked, false);
});

test('successful check keeps previous price when new one is missing', () => {
  let s = applyCheck(undefined, ok('OUT_OF_STOCK', 'INR 21999'), NOW).state;
  s = applyCheck(s, ok('OUT_OF_STOCK'), NOW).state;
  assert.equal(s.price, 'INR 21999');
});

test('lastChangedAt only moves when status changes', () => {
  const T1 = '2026-07-07T12:00:00.000Z';
  const T2 = '2026-07-07T12:10:00.000Z';
  const T3 = '2026-07-07T12:20:00.000Z';
  let s = applyCheck(undefined, ok('OUT_OF_STOCK'), T1).state;
  s = applyCheck(s, ok('OUT_OF_STOCK'), T2).state;
  assert.equal(s.lastChangedAt, T1);
  assert.equal(s.lastCheckedAt, T2);
  s = applyCheck(s, ok('IN_STOCK'), T3).state;
  assert.equal(s.lastChangedAt, T3);
});
