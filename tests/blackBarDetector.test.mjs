import {test} from 'node:test';
import assert from 'node:assert';
import {BlackBarDetector} from '../chrome/player/modules/analyzer/BlackBarDetector.mjs';

const WIDTH = 160;
const HEIGHT = 90;
const BRIGHT = 200;

function makeFrameData(topBar, bottomBar) {
  const data = new Uint8ClampedArray(WIDTH * HEIGHT * 4);
  const topRows = Math.round(topBar * HEIGHT);
  const bottomRows = Math.round(bottomBar * HEIGHT);
  for (let y = 0; y < HEIGHT; y++) {
    const inBar = y < topRows || y >= HEIGHT - bottomRows;
    for (let x = 0; x < WIDTH; x++) {
      const idx = (y * WIDTH + x) * 4;
      const value = inBar ? 0 : BRIGHT;
      data[idx] = value;
      data[idx + 1] = value;
      data[idx + 2] = value;
      data[idx + 3] = 255;
    }
  }
  return data;
}

function installCanvasStub(frameDataFactory) {
  globalThis.document = {
    createElement: (tag) => {
      if (tag !== 'canvas') {
        return {};
      }
      const canvas = {width: 0, height: 0};
      canvas.getContext = () => ({
        willReadFrequently: true,
        drawImage: () => {},
        getImageData: (x, y, w, h) => ({
          width: w,
          height: h,
          data: frameDataFactory(),
        }),
      });
      return canvas;
    },
  };
}

function makeAnalyzerPlayer(frameDataFactory, {duration = 100} = {}) {
  const seekHistory = [];
  const video = {
    duration,
    videoWidth: 160,
    videoHeight: 90,
    _currentTime: 0,
    _seekedListeners: [],
    get currentTime() {
      return this._currentTime;
    },
    set currentTime(value) {
      if (value === this._currentTime) {
        return;
      }
      this._currentTime = value;
      seekHistory.push(value);
      queueMicrotask(() => {
        for (const listener of this._seekedListeners.slice()) {
          listener();
        }
      });
    },
    addEventListener(type, listener) {
      if (type === 'seeked') {
        this._seekedListeners.push(listener);
      }
    },
    removeEventListener(type, listener) {
      if (type === 'seeked') {
        this._seekedListeners = this._seekedListeners.filter((l) => l !== listener);
      }
    },
  };

  const handlers = Object.create(null);
  const player = {
    video,
    seekHistory,
    volume: 1,
    muted: false,
    destroyed: false,
    setup: async () => {},
    on(type, listener) {
      (handlers[type] ??= []).push(listener);
      return this;
    },
    off(type, listener) {
      if (handlers[type]) {
        handlers[type] = handlers[type].filter((l) => l !== listener);
      }
    },
    emit(type) {
      for (const listener of (handlers[type] ?? []).slice()) {
        listener({type});
      }
    },
    setCurrentVideoLevelID() {},
    setCurrentAudioLevelID() {},
    async setSource() {
      this.emit('loadedmetadata');
    },
    pause() {},
    destroy() {
      this.destroyed = true;
    },
    getVideo() {
      return video;
    },
  };

  return player;
}

function makeClient(analyzerPlayer) {
  return {
    player: {
      getSource: () => ({mode: 'direct'}),
    },
    playerLoader: {
      createPlayer: async () => analyzerPlayer,
    },
    attachProcessorsToPlayer: () => {},
    getCurrentVideoLevelID: () => null,
    getCurrentAudioLevelID: () => null,
  };
}

test('detect samples a detached analyzer player and returns the aggregated crop', async () => {
  installCanvasStub(() => makeFrameData(18 / 90, 14 / 90));
  const analyzerPlayer = makeAnalyzerPlayer(() => makeFrameData(18 / 90, 14 / 90));
  const client = makeClient(analyzerPlayer);

  const detector = new BlackBarDetector();
  const crop = await detector.detect(client);

  assert.deepStrictEqual(crop, {top: 18 / 90, bottom: 14 / 90, left: 0, right: 0});
  assert.deepStrictEqual(analyzerPlayer.seekHistory, [10, 25, 50, 75, 90]);
  assert.strictEqual(analyzerPlayer.destroyed, true);
});

test('detect returns null when frames contain no black bars', async () => {
  installCanvasStub(() => makeFrameData(0, 0));
  const client = makeClient(makeAnalyzerPlayer(() => makeFrameData(0, 0)));

  const detector = new BlackBarDetector();
  const crop = await detector.detect(client);

  assert.strictEqual(crop, null);
});

test('detect returns null when any crop edge exceeds 40%', async () => {
  installCanvasStub(() => makeFrameData(45 / 90, 0));
  const client = makeClient(makeAnalyzerPlayer(() => makeFrameData(45 / 90, 0)));

  const detector = new BlackBarDetector();
  const crop = await detector.detect(client);

  assert.strictEqual(crop, null);
});

test('detect returns null when the analyzer video has no valid duration', async () => {
  installCanvasStub(() => makeFrameData(18 / 90, 14 / 90));
  const client = makeClient(makeAnalyzerPlayer(() => makeFrameData(18 / 90, 14 / 90), {duration: 0}));

  const detector = new BlackBarDetector();
  const crop = await detector.detect(client);

  assert.strictEqual(crop, null);
});
