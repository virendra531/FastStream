import {test} from 'node:test';
import assert from 'node:assert';
import {BlackBarDetector} from '../chrome/player/modules/analyzer/BlackBarDetector.mjs';

function makeCtx() {
  return {
    drawImage() {},
    getImageData() {
      return {width: 160, height: 90, data: new Uint8ClampedArray(160 * 90 * 4)};
    },
  };
}

function makeDocument() {
  return {
    createElement() {
      return {
        width: 0,
        height: 0,
        getContext: () => makeCtx(),
      };
    },
  };
}

function makeVideo(initialTime, duration = 100) {
  const listeners = new Map();
  const video = {
    duration,
    readyState: 2,
    _t: initialTime,
    seekCount: 0,
  };
  Object.defineProperty(video, 'currentTime', {
    get() {
      return this._t;
    },
    set(v) {
      this._t = v;
      this.seekCount++;
      setTimeout(() => video.fire('seeked'), 1);
    },
  });
  video.addEventListener = (type, cb) => listeners.set(type, cb);
  video.removeEventListener = (type) => listeners.delete(type);
  video.fire = (type) => listeners.get(type)?.();
  return video;
}

function setup() {
  const originalDocument = globalThis.document;
  globalThis.document = makeDocument();
  return () => {
    if (originalDocument === undefined) {
      delete globalThis.document;
    } else {
      globalThis.document = originalDocument;
    }
  };
}

test('detect restores the original playback position after sampling', async () => {
  const restore = setup();
  try {
    const detector = new BlackBarDetector();
    const video = makeVideo(42);
    await detector.detect(video);
    assert.equal(video.currentTime, 42);
  } finally {
    restore();
  }
});

test('cancel makes an in-flight detect return null and restore position', async () => {
  const restore = setup();
  try {
    const detector = new BlackBarDetector();
    const video = makeVideo(42);
    const promise = detector.detect(video);
    await new Promise((resolve) => setTimeout(resolve, 5));
    detector.cancel();
    const crop = await promise;
    assert.equal(crop, null);
    assert.equal(video.currentTime, 42);
  } finally {
    restore();
  }
});

test('detect returns null for live streams without seeking', async () => {
  const restore = setup();
  try {
    const detector = new BlackBarDetector();
    const video = makeVideo(42, Infinity);
    const crop = await detector.detect(video);
    assert.equal(crop, null);
    assert.equal(video.currentTime, 42);
  } finally {
    restore();
  }
});