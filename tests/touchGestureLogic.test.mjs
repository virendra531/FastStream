import {test} from 'node:test';
import assert from 'node:assert';

import {
  getTapZone,
  getSeekDirection,
  getSeekAmount,
  isTouchDevice,
  createTapResolver,
} from '../chrome/player/ui/TouchGestureLogic.mjs';

test('getTapZone reports controls in the bottom 15%', () => {
  const rect = {top: 0, height: 1000};
  assert.strictEqual(getTapZone(100, 900, rect), 'controls');
  assert.strictEqual(getTapZone(100, 849, rect), 'video');
  assert.strictEqual(getTapZone(100, 850, rect), 'controls');
});

test('getTapZone handles a rect offset from the viewport top', () => {
  const rect = {top: 100, height: 1000};
  assert.strictEqual(getTapZone(50, 950, rect), 'controls');
  assert.strictEqual(getTapZone(50, 949, rect), 'video');
});

test('getTapZone defaults to video for a degenerate rect', () => {
  assert.strictEqual(getTapZone(10, 10, {top: 0, height: 0}), 'video');
  assert.strictEqual(getTapZone(10, 10, null), 'video');
});

test('getSeekDirection is backward on the left half and forward on the right', () => {
  const rect = {left: 0, width: 1000};
  assert.strictEqual(getSeekDirection(100, rect), -1);
  assert.strictEqual(getSeekDirection(900, rect), 1);
  assert.strictEqual(getSeekDirection(500, rect), 1);
});

test('getSeekDirection is forward for a degenerate rect', () => {
  assert.strictEqual(getSeekDirection(10, {left: 0, width: 0}), 1);
  assert.strictEqual(getSeekDirection(10, null), 1);
});

test('getSeekAmount multiplies the step size by five', () => {
  assert.strictEqual(getSeekAmount(2), 10);
  assert.strictEqual(getSeekAmount(0.5), 2.5);
});

test('isTouchDevice requires touch points and a coarse or mobile pointer', () => {
  assert.strictEqual(isTouchDevice(5, true, false), true);
  assert.strictEqual(isTouchDevice(5, false, true), true);
  assert.strictEqual(isTouchDevice(0, true, true), false);
  assert.strictEqual(isTouchDevice(5, false, false), false);
});

function makeFakeScheduler() {
  let nextId = 1;
  const tasks = new Map();
  return {
    schedule: (fn) => {
      const id = nextId++;
      tasks.set(id, fn);
      return id;
    },
    cancel: (id) => {
      tasks.delete(id);
    },
    runAll: () => {
      for (const [id, fn] of [...tasks]) {
        tasks.delete(id);
        fn();
      }
    },
    get size() {
      return tasks.size;
    },
  };
}

test('a lone tap resolves as single after the window elapses', () => {
  const single = [];
  const double = [];
  const clock = makeFakeScheduler();
  const resolver = createTapResolver({
    onSingle: (p) => single.push(p),
    onDouble: (p) => double.push(p),
    schedule: clock.schedule,
    cancel: clock.cancel,
    window: 300,
  });

  assert.strictEqual(resolver.tap('a', 0), 'single');
  assert.strictEqual(clock.size, 1);
  clock.runAll();
  assert.deepStrictEqual(single, ['a']);
  assert.deepStrictEqual(double, []);
});

test('a second tap within the window resolves as double and cancels the single', () => {
  const single = [];
  const double = [];
  const clock = makeFakeScheduler();
  const resolver = createTapResolver({
    onSingle: (p) => single.push(p),
    onDouble: (p) => double.push(p),
    schedule: clock.schedule,
    cancel: clock.cancel,
    window: 300,
  });

  resolver.tap('a', 0);
  assert.strictEqual(resolver.tap('b', 200), 'double');
  assert.strictEqual(clock.size, 0);
  clock.runAll();
  assert.deepStrictEqual(single, []);
  assert.deepStrictEqual(double, ['b']);
});

test('a tap after the window has elapsed starts a fresh pair', () => {
  const single = [];
  const double = [];
  const clock = makeFakeScheduler();
  const resolver = createTapResolver({
    onSingle: (p) => single.push(p),
    onDouble: (p) => double.push(p),
    schedule: clock.schedule,
    cancel: clock.cancel,
    window: 300,
  });

  resolver.tap('a', 0);
  clock.runAll();
  assert.strictEqual(resolver.tap('b', 400), 'single');
  assert.strictEqual(resolver.tap('c', 500), 'double');
  assert.deepStrictEqual(single, ['a']);
  assert.deepStrictEqual(double, ['c']);
});
