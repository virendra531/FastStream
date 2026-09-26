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

function frameSequence(frames) {
  let index = 0;
  return () => frames[Math.min(index++, frames.length - 1)];
}

/**
 * The detector reads the live player video, so the harness only needs an
 * element that reports a frame size and can never be seeked.
 */
function makeLiveVideo({readyState = 4} = {}) {
  return {
    videoWidth: WIDTH,
    videoHeight: HEIGHT,
    readyState,
    duration: 100,
    currentTime: 42,
    seekedCount: 0,
    addEventListener(type) {
      if (type === 'seeked') {
        this.seekedCount++;
      }
    },
    removeEventListener() {},
  };
}

function makeClient(video) {
  return {
    player: {
      getVideo: () => video,
      getSource: () => ({mode: 'direct'}),
    },
  };
}

test('detect reads the live video and returns the crop', async () => {
  installCanvasStub(() => makeFrameData(18 / 90, 14 / 90));
  const client = makeClient(makeLiveVideo());

  const detector = new BlackBarDetector();
  const crop = await detector.detect(client);

  assert.deepStrictEqual(crop, {top: 18 / 90, bottom: 14 / 90, left: 0, right: 0});
});

test('detect never seeks the live video', async () => {
  installCanvasStub(() => makeFrameData(18 / 90, 14 / 90));
  const video = makeLiveVideo();
  const client = makeClient(video);

  const detector = new BlackBarDetector();
  await detector.detect(client);

  assert.strictEqual(video.seekedCount, 0);
  assert.strictEqual(video.currentTime, 42);
});

test('detect does not create a second player', async () => {
  installCanvasStub(() => makeFrameData(18 / 90, 14 / 90));
  const client = makeClient(makeLiveVideo());
  client.playerLoader = {
    createPlayer: async () => {
      throw new Error('detect must not spin up an analyzer player');
    },
  };

  const detector = new BlackBarDetector();
  const crop = await detector.detect(client);

  assert.deepStrictEqual(crop, {top: 18 / 90, bottom: 14 / 90, left: 0, right: 0});
});

test('detect returns null when frames contain no black bars', async () => {
  installCanvasStub(() => makeFrameData(0, 0));
  const client = makeClient(makeLiveVideo());

  const detector = new BlackBarDetector();
  const crop = await detector.detect(client);

  assert.strictEqual(crop, null);
});

test('detect returns null when any crop edge exceeds 40%', async () => {
  installCanvasStub(() => makeFrameData(45 / 90, 0));
  const client = makeClient(makeLiveVideo());

  const detector = new BlackBarDetector();
  const crop = await detector.detect(client);

  assert.strictEqual(crop, null);
});

test('detect returns null when the live video has no frame yet', async () => {
  installCanvasStub(() => makeFrameData(18 / 90, 14 / 90));
  const client = makeClient(makeLiveVideo({readyState: 0}));
  client.player.getVideo = () => ({videoWidth: 0, videoHeight: 0, readyState: 0});

  const detector = new BlackBarDetector();
  const crop = await detector.detect(client);

  assert.strictEqual(crop, null);
});

test('detect returns null when there is no live video', async () => {
  installCanvasStub(() => makeFrameData(18 / 90, 14 / 90));

  const detector = new BlackBarDetector();
  const crop = await detector.detect({});

  assert.strictEqual(crop, null);
});

test('detect ignores a single dark frame instead of merging its bar into other frames', async () => {
  const frames = [
    makeFrameData(30 / 90, 0),
    makeFrameData(8 / 90, 8 / 90),
    makeFrameData(8 / 90, 8 / 90),
    makeFrameData(8 / 90, 8 / 90),
    makeFrameData(8 / 90, 8 / 90),
  ];
  installCanvasStub(frameSequence(frames));
  const client = makeClient(makeLiveVideo());

  const detector = new BlackBarDetector();
  const crop = await detector.detect(client);

  assert.deepStrictEqual(crop, {top: 8 / 90, bottom: 8 / 90, left: 0, right: 0});
});

test('detect returns a crop that actually occurred in a sampled frame', async () => {
  const frames = [
    makeFrameData(4 / 90, 4 / 90),
    makeFrameData(10 / 90, 10 / 90),
    makeFrameData(4 / 90, 4 / 90),
    makeFrameData(10 / 90, 10 / 90),
    makeFrameData(4 / 90, 4 / 90),
  ];
  installCanvasStub(frameSequence(frames));
  const client = makeClient(makeLiveVideo());

  const detector = new BlackBarDetector();
  const crop = await detector.detect(client);

  const perFrame = new Set([
    JSON.stringify({top: 4 / 90, bottom: 4 / 90, left: 0, right: 0}),
    JSON.stringify({top: 10 / 90, bottom: 10 / 90, left: 0, right: 0}),
  ]);
  assert.ok(perFrame.has(JSON.stringify(crop)), `crop ${JSON.stringify(crop)} came from no sampled frame`);
});

test('cancel stops an in-flight detection', async () => {
  installCanvasStub(() => makeFrameData(18 / 90, 14 / 90));
  const client = makeClient(makeLiveVideo());

  const detector = new BlackBarDetector();
  const pending = detector.detect(client);
  detector.cancel();

  assert.strictEqual(await pending, null);
});

test('a manual crop is returned without touching the video', async () => {
  let reads = 0;
  installCanvasStub(() => {
    reads++;
    return makeFrameData(0, 0);
  });
  const client = makeClient(makeLiveVideo());

  const detector = new BlackBarDetector();
  detector.setManualCrop({top: 0.1, bottom: 0.1, left: 0, right: 0});

  assert.deepStrictEqual(await detector.detect(client), {top: 0.1, bottom: 0.1, left: 0, right: 0});
  assert.strictEqual(reads, 0);
});
