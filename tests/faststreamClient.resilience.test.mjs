import {test} from 'node:test';
import assert from 'node:assert';

import {installBrowserGlobals} from './helpers/browser-globals.mjs';
import {DownloadStatus} from '../chrome/player/enums/DownloadStatus.mjs';
import {DefaultPlayerEvents} from '../chrome/player/enums/DefaultPlayerEvents.mjs';

// FastStreamClient's import chain reaches DOM-touching UI modules, so the
// globals must be installed before the dynamic import runs (static imports
// are hoisted, which is why the client is imported dynamically here).
installBrowserGlobals();
const {FastStreamClient} = await import('../chrome/player/FastStreamClient.mjs');

const ARG = {
  reportAfterMs: 30_000,
  inFlightReportAfterMs: 90_000,
  minForwardBufferSec: 1,
  recoveryIntervalMs: 8000,
  inFlightLookaheadSec: 15,
};

function makePlayer(overrides = {}) {
  return {
    getCurrentVideoLevelID: () => 0,
    getCurrentAudioLevelID: () => 1,
    ...overrides,
  };
}

function makeClient(overrides = {}) {
  const client = Object.create(FastStreamClient.prototype);
  client.destroyed = false;
  client.state = {currentTime: 0};
  client.stallSince = null;
  client.stallRecovery = null;
  client.failedPlaybackRecovery = null;
  client.fragmentsStore = {};
  client.context = null;
  client.player = null;
  client.consecutiveLoadErrors = 0;
  client.interfaceController = {
    isUserSeeking: () => false,
    updateFragmentsLoaded: () => {},
  };
  return Object.assign(client, overrides);
}

function videoWithBuffered(ranges, ended = false) {
  return {
    ended,
    buffered: {
      length: ranges.length,
      start: (i) => ranges[i][0],
      end: (i) => ranges[i][1],
    },
  };
}

function withFrozenNow(fn) {
  const original = Date.now;
  let now = 0;
  Date.now = () => now;
  const clock = {
    set: (value) => {
      now = value;
    },
    advance: (delta) => {
      now += delta;
    },
  };
  try {
    return fn(clock);
  } finally {
    Date.now = original;
  }
}

// ---------------------------------------------------------------------------
// isStarvedAt — the P38 containment-vs-runway fix
// ---------------------------------------------------------------------------

test('isStarvedAt is starved with no video element', () => {
  const client = makeClient({player: makePlayer()});
  assert.strictEqual(client.isStarvedAt(5), true);
});

test('isStarvedAt is healthy when the playhead has real forward runway', () => {
  const client = makeClient({player: makePlayer({getVideo: () => videoWithBuffered([[0, 10]])})});
  assert.strictEqual(client.isStarvedAt(5), false);
});

test('isStarvedAt is starved at the tail of a range with under 1s of runway', () => {
  // Real repro: the playhead froze at 0.03s of runway. A containment test
  // called this "healthy" so the guard never fired.
  const client = makeClient({player: makePlayer({getVideo: () => videoWithBuffered([[0, 60.03]])})});
  assert.strictEqual(client.isStarvedAt(60.02), true);
  assert.strictEqual(client.isStarvedAt(60.03), true);
});

test('isStarvedAt is healthy with exactly the minimum runway', () => {
  const client = makeClient({player: makePlayer({getVideo: () => videoWithBuffered([[0, 60.0]])})});
  assert.strictEqual(client.isStarvedAt(59.0), false);
});

// ---------------------------------------------------------------------------
// hasFragmentInFlightAt — the P38 boundary fix
// ---------------------------------------------------------------------------

test('hasFragmentInFlightAt counts a fragment that STARTS after a boundary playhead', () => {
  // Live shape: [45.047,60.060] COMPLETE / [60.060,65.065] DOWNLOAD_INITIATED
  // with t = 60.02. The in-flight fragment never "covers" the playhead.
  const client = makeClient({
    fragmentsStore: {0: [
      {start: 45.047, end: 60.06, status: DownloadStatus.DOWNLOAD_COMPLETE},
      {start: 60.06, end: 65.065, status: DownloadStatus.DOWNLOAD_INITIATED},
    ]},
    player: makePlayer(),
  });
  assert.strictEqual(client.hasFragmentInFlightAt(60.02), true);
});

test('hasFragmentInFlightAt ignores a complete fragment', () => {
  const client = makeClient({
    fragmentsStore: {0: [{start: 60, end: 65, status: DownloadStatus.DOWNLOAD_COMPLETE}]},
    player: makePlayer(),
  });
  assert.strictEqual(client.hasFragmentInFlightAt(60), false);
});

test('hasFragmentInFlightAt ignores backfill behind the playhead', () => {
  const client = makeClient({
    fragmentsStore: {0: [{start: 0, end: 30, status: DownloadStatus.DOWNLOAD_INITIATED}]},
    player: makePlayer(),
  });
  assert.strictEqual(client.hasFragmentInFlightAt(60), false);
});

test('hasFragmentInFlightAt ignores a distant in-flight fragment beyond the lookahead', () => {
  const client = makeClient({
    fragmentsStore: {0: [{start: 90, end: 95, status: DownloadStatus.DOWNLOAD_INITIATED}]},
    player: makePlayer(),
  });
  assert.strictEqual(client.hasFragmentInFlightAt(60), false);
  // Boundary: start === time + lookahead (15) still counts.
  const boundary = makeClient({
    fragmentsStore: {0: [{start: 75, end: 80, status: DownloadStatus.DOWNLOAD_INITIATED}]},
    player: makePlayer(),
  });
  assert.strictEqual(boundary.hasFragmentInFlightAt(60), true);
});

test('hasFragmentInFlightAt sees an in-flight AUDIO fragment', () => {
  const client = makeClient({
    fragmentsStore: {1: [{start: 60, end: 65, status: DownloadStatus.WAITING}]},
    player: makePlayer(),
  });
  assert.strictEqual(client.hasFragmentInFlightAt(60), true);
});

// ---------------------------------------------------------------------------
// startLoadAt
// ---------------------------------------------------------------------------

test('startLoadAt calls hls.startLoad with the given time', () => {
  const calls = [];
  const client = makeClient({player: makePlayer({hls: {startLoad: (t) => calls.push(t)}})});
  assert.strictEqual(client.startLoadAt(42), true);
  assert.deepStrictEqual(calls, [42]);
});

test('startLoadAt returns false when there is no hls instance', () => {
  const client = makeClient({player: makePlayer()});
  assert.strictEqual(client.startLoadAt(1), false);
  assert.strictEqual(makeClient({player: null}).startLoadAt(1), false);
});

test('startLoadAt swallows an hls.js state-transition throw', () => {
  const client = makeClient({player: makePlayer({hls: {startLoad: () => {
    throw new Error('bad state');
  }}})});
  assert.strictEqual(client.startLoadAt(1), false);
});

// ---------------------------------------------------------------------------
// retryStalledInFlight — the P39 recovery ladder
// ---------------------------------------------------------------------------

test('retryStalledInFlight re-issues immediately on the first attempt', () => {
  withFrozenNow(() => {
    const calls = [];
    const client = makeClient({
      state: {currentTime: 12},
      player: makePlayer({hls: {startLoad: (t) => calls.push(t)}}),
    });
    assert.strictEqual(client.retryStalledInFlight(), true);
    assert.deepStrictEqual(calls, [12]);
    assert.strictEqual(client.stallRecovery.attempts, 1);
  });
});

test('retryStalledInFlight paces re-issues by recoveryIntervalMs', () => {
  withFrozenNow((clock) => {
    const calls = [];
    const client = makeClient({
      state: {currentTime: 5},
      player: makePlayer({hls: {startLoad: (t) => calls.push(t)}}),
    });
    client.retryStalledInFlight(); // attempt 1 at t=0
    clock.set(1000);
    // Too soon: pending, no second request.
    assert.strictEqual(client.retryStalledInFlight(), true);
    assert.strictEqual(client.stallRecovery.attempts, 1);
    assert.strictEqual(calls.length, 1);
    clock.set(ARG.recoveryIntervalMs);
    assert.strictEqual(client.retryStalledInFlight(), true);
    assert.strictEqual(client.stallRecovery.attempts, 2);
    assert.strictEqual(calls.length, 2);
  });
});

test('retryStalledInFlight caps attempts and stays sticky when exhausted', () => {
  withFrozenNow((clock) => {
    const calls = [];
    const client = makeClient({
      state: {currentTime: 5},
      player: makePlayer({hls: {startLoad: (t) => calls.push(t)}}),
    });
    for (let i = 0; i < 5; i++) {
      client.retryStalledInFlight();
      clock.advance(ARG.recoveryIntervalMs + 1);
    }
    assert.strictEqual(client.stallRecovery.attempts, 3);
    assert.strictEqual(calls.length, 3);
    // Once exhausted, further calls keep returning false.
    assert.strictEqual(client.retryStalledInFlight(), false);
    assert.strictEqual(calls.length, 3);
  });
});

// ---------------------------------------------------------------------------
// detectSustainedStall
// ---------------------------------------------------------------------------

test('detectSustainedStall clears state when playback is healthy', () => {
  const client = makeClient({
    stallSince: 123,
    stallRecovery: {attempts: 2, lastAction: 5},
    player: makePlayer({getVideo: () => videoWithBuffered([[0, 10]])}),
  });
  assert.strictEqual(client.detectSustainedStall(), false);
  assert.strictEqual(client.stallSince, null);
  assert.strictEqual(client.stallRecovery, null);
});

test('detectSustainedStall clears state while the user is seeking', () => {
  const client = makeClient({
    stallSince: 5,
    interfaceController: {isUserSeeking: () => true, updateFragmentsLoaded: () => {}},
  });
  assert.strictEqual(client.detectSustainedStall(), false);
  assert.strictEqual(client.stallSince, null);
});

test('detectSustainedStall treats an ended stream as finished, not stalled', () => {
  const client = makeClient({
    stallSince: 5,
    stallRecovery: {attempts: 1, lastAction: 0},
    player: makePlayer({getVideo: () => videoWithBuffered([], true)}),
  });
  assert.strictEqual(client.detectSustainedStall(), false);
  assert.strictEqual(client.stallSince, null);
  assert.strictEqual(client.stallRecovery, null);
});

test('detectSustainedStall begins measuring on the first starved tick', () => {
  withFrozenNow((clock) => {
    const client = makeClient({
      state: {currentTime: 5},
      player: makePlayer({getVideo: () => videoWithBuffered([[0, 5]])}),
    });
    clock.set(5000);
    assert.strictEqual(client.detectSustainedStall(), false);
    assert.strictEqual(client.stallSince, 5000);
  });
});

test('detectSustainedStall does not report before the 30s budget', () => {
  withFrozenNow((clock) => {
    const client = makeClient({
      state: {currentTime: 5},
      player: makePlayer({getVideo: () => videoWithBuffered([[0, 5]])}),
    });
    client.detectSustainedStall();
    clock.set(ARG.reportAfterMs - 1000);
    assert.strictEqual(client.detectSustainedStall(), false);
    assert.strictEqual(client.stallSince, 0);
  });
});

test('detectSustainedStall does not report while a re-issue is pending, and keeps stallSince', () => {
  withFrozenNow((clock) => {
    const calls = [];
    const client = makeClient({
      state: {currentTime: 5},
      player: makePlayer({
        getVideo: () => videoWithBuffered([[0, 5]]),
        hls: {startLoad: (t) => calls.push(t)},
      }),
      context: {emit: () => {
        throw new Error('should not report while a re-issue is pending');
      }},
    });
    client.detectSustainedStall();
    clock.set(ARG.reportAfterMs);
    assert.strictEqual(client.detectSustainedStall(), false);
    assert.deepStrictEqual(calls, [5]);
    // P39 rule: stallSince must NOT be re-armed after a re-issue.
    assert.strictEqual(client.stallSince, 0);
  });
});

test('detectSustainedStall reports stalled_playback on the CONTEXT bus', () => {
  withFrozenNow((clock) => {
    const events = [];
    const selfEvents = [];
    const client = makeClient({
      state: {currentTime: 5},
      // No hls, so the re-issue cannot succeed and the report path is reached.
      player: makePlayer({getVideo: () => videoWithBuffered([[0, 5]])}),
      context: {emit: (...args) => events.push(args)},
    });
    client.emit = (...args) => selfEvents.push(args);
    client.detectSustainedStall();
    clock.set(ARG.reportAfterMs);
    assert.strictEqual(client.detectSustainedStall(), true);
    assert.strictEqual(client.stallSince, null);
    assert.strictEqual(events.length, 1);
    assert.strictEqual(events[0][0], DefaultPlayerEvents.ERROR);
    assert.strictEqual(events[0][1], 'stalled_playback');
    // The P38 bug: reporting on this.emit produced an undeliverable reason.
    assert.strictEqual(selfEvents.length, 0);
  });
});

test('detectSustainedStall uses the 90s in-flight budget while a fragment is in flight', () => {
  withFrozenNow((clock) => {
    const events = [];
    const client = makeClient({
      state: {currentTime: 60.02},
      fragmentsStore: {0: [{start: 60.06, end: 65.06, status: DownloadStatus.DOWNLOAD_INITIATED}]},
      player: makePlayer({getVideo: () => videoWithBuffered([[0, 60.06]])}),
      context: {emit: (...args) => events.push(args)},
    });
    client.detectSustainedStall();
    clock.set(ARG.reportAfterMs);
    assert.strictEqual(client.detectSustainedStall(), false);
    assert.strictEqual(events.length, 0);
    clock.set(ARG.inFlightReportAfterMs);
    assert.strictEqual(client.detectSustainedStall(), true);
    assert.strictEqual(events.length, 1);
    assert.strictEqual(events[0][1], 'stalled_playback_fragment_in_flight');
  });
});

// ---------------------------------------------------------------------------
// recoverStalledPlayback — the P33 failed-fragment recovery
// ---------------------------------------------------------------------------

test('recoverStalledPlayback re-requests a failed fragment under the playhead', () => {
  withFrozenNow((clock) => {
    const calls = [];
    const failed = {start: 0, end: 10, status: DownloadStatus.DOWNLOAD_FAILED};
    const client = makeClient({
      state: {currentTime: 5},
      fragmentsStore: {0: [failed]},
      player: makePlayer({
        getVideo: () => videoWithBuffered([[0, 5]]),
        hls: {startLoad: (t) => calls.push(t)},
      }),
    });
    // First tick only seeds the retry window.
    assert.strictEqual(client.recoverStalledPlayback(), false);
    clock.set(5000);
    assert.strictEqual(client.recoverStalledPlayback(), true);
    assert.strictEqual(failed.status, DownloadStatus.WAITING);
    assert.deepStrictEqual(calls, [5]);
  });
});

test('recoverStalledPlayback skips past the dead segment once retries are exhausted', () => {
  withFrozenNow((clock) => {
    clock.set(10_000);
    const seeks = [];
    const loads = [];
    const failed = {start: 0, end: 10, status: DownloadStatus.DOWNLOAD_FAILED};
    const client = makeClient({
      state: {currentTime: 5},
      fragmentsStore: {0: [failed]},
      player: makePlayer({
        getVideo: () => videoWithBuffered([[0, 5]]),
        hls: {startLoad: (t) => loads.push(t)},
      }),
      failedPlaybackRecovery: {attempts: 3, lastAction: 0},
    });
    Object.defineProperty(client, 'currentTime', {
      configurable: true,
      get: () => 5,
      set: (value) => seeks.push(value),
    });
    assert.strictEqual(client.recoverStalledPlayback(), true);
    assert.deepStrictEqual(seeks, [10.1]);
    assert.deepStrictEqual(loads, [10.1]);
    assert.strictEqual(client.failedPlaybackRecovery, null);
  });
});

test('recoverStalledPlayback clears recovery state when the playhead is not starving', () => {
  const client = makeClient({
    state: {currentTime: 5},
    fragmentsStore: {0: [{start: 0, end: 10, status: DownloadStatus.DOWNLOAD_FAILED}]},
    player: makePlayer({getVideo: () => videoWithBuffered([[0, 20]])}),
    failedPlaybackRecovery: {attempts: 1, lastAction: 0},
  });
  assert.strictEqual(client.recoverStalledPlayback(), false);
  assert.strictEqual(client.failedPlaybackRecovery, null);
});

// ---------------------------------------------------------------------------
// setSource serialization — P43
// ---------------------------------------------------------------------------

test('setSource serializes overlapping calls (max concurrency 1, order preserved)', async () => {
  const client = Object.create(FastStreamClient.prototype);
  const log = [];
  let active = 0;
  let maxActive = 0;
  client.__setSourceInternal = async (source) => {
    active += 1;
    maxActive = Math.max(maxActive, active);
    log.push('start:' + source);
    await new Promise((resolve) => setTimeout(resolve, source === 'a' ? 30 : 10));
    log.push('end:' + source);
    active -= 1;
  };
  const first = client.setSource('a');
  const second = client.setSource('b');
  await Promise.all([first, second]);
  assert.strictEqual(maxActive, 1);
  assert.deepStrictEqual(log, ['start:a', 'end:a', 'start:b', 'end:b']);
});

test('setSource last-wins and does not deadlock when a call throws', async () => {
  const client = Object.create(FastStreamClient.prototype);
  const log = [];
  client.__setSourceInternal = async (source) => {
    log.push(source);
    if (source === 'a') {
      throw new Error('boom');
    }
  };
  const first = client.setSource('a');
  const second = client.setSource('b');
  await assert.rejects(first, /boom/);
  await second;
  assert.deepStrictEqual(log, ['a', 'b']);
});

// ---------------------------------------------------------------------------
// resetFailed — P32
// ---------------------------------------------------------------------------

test('resetFailed re-requests when it recovered a failed fragment', () => {
  const retried = [];
  const client = makeClient({
    fragmentsStore: {0: [
      {status: DownloadStatus.DOWNLOAD_FAILED},
      {status: DownloadStatus.WAITING},
    ]},
  });
  client.retryFailedFragments = () => {
    retried.push(true);
    return true;
  };
  client.resetFailed();
  assert.strictEqual(client.fragmentsStore[0][0].status, DownloadStatus.WAITING);
  assert.strictEqual(retried.length, 1);
});

test('resetFailed does not re-request when nothing was failed', () => {
  const retried = [];
  const client = makeClient({
    fragmentsStore: {0: [{status: DownloadStatus.WAITING}]},
  });
  client.retryFailedFragments = () => {
    retried.push(true);
    return true;
  };
  client.resetFailed();
  assert.strictEqual(retried.length, 0);
});
