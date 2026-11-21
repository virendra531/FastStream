import {test} from 'node:test';
import assert from 'node:assert';

globalThis.document = {
  createElement: () => ({
    buffered: {length: 0},
    currentTime: 0,
    readyState: 4,
    paused: true,
    addEventListener() {},
    removeEventListener() {},
  }),
};
globalThis.MediaSource = {isTypeSupported: () => true};

const {default: MP4Player} = await import('../chrome/player/players/mp4/MP4Player.mjs');

function makePlayer() {
  const client = {
    getFragment: (level, index) => (index === 0 ? {sn: 0, start: 300, end: 301} : null),
    getFragments: () => [],
    makeFragment() {},
    setSeekSave() {},
  };
  const player = new MP4Player(client, {});
  player.loaded = true;
  player.currentFragments = [];
  player.video.currentTime = 300;
  player.removes = [];
  player.mediaSource = {
    duration: 978,
    addSourceBuffer: () => ({}),
    removeSourceBuffer() {},
  };
  player.videoSourceBuffer = {
    remove(start, end) {
      player.removes.push([start, end]);
    },
  };
  return player;
}

test('runLoad bounds back-buffer removal to at most once per second of playback', () => {
  const player = makePlayer();
  for (let i = 0; i < 250; i++) {
    player.runLoad();
  }
  assert.equal(player.removes.length, 1);

  player.video.currentTime = 310;
  for (let i = 0; i < 250; i++) {
    player.runLoad();
  }
  assert.equal(player.removes.length, 2);
});

test('setupHLS bundles multiple samples into each SourceBuffer append', () => {
  const player = makePlayer();
  player.metaData = {
    videoTracks: [{id: 1, codec: 'avc1.640033'}],
    audioTracks: [{id: 2, codec: 'mp4a.40.2'}],
    duration: 978000,
    timescale: 1000,
  };
  player.mp4box.fragmentedTracks.length = 0;
  const nbSamples = [];
  player.mp4box.setSegmentOptions = (id, user, options) => nbSamples.push(options.nbSamples);
  player.mp4box.initializeSegmentation = () => [{buffer: new Uint8Array()}, {buffer: new Uint8Array()}];
  player.mp4box.seek = () => {};
  player.mp4box.start = () => {};
  player.videoSourceBuffer = null;
  player.mediaSource.addSourceBuffer = () => ({
    addEventListener() {},
    appendBuffer() {},
  });

  player.setupHLS();

  assert.deepEqual(nbSamples, [60, 60]);
});
