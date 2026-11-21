import {test} from 'node:test';
import assert from 'node:assert';

const assignments = [];
globalThis.document = {
  createElement: () => ({
    set crossOrigin(value) {
      assignments.push(['crossOrigin', value]);
    },
    set src(value) {
      assignments.push(['src', value]);
    },
    addEventListener() {},
    removeEventListener() {},
  }),
};

const {default: DirectVideoPlayer} = await import('../chrome/player/players/DirectVideoPlayer.mjs');

test('sets crossOrigin before src so Web Audio is not silent on remote URLs', async () => {
  assignments.length = 0;
  const player = new DirectVideoPlayer({}, {});

  await player.setSource({url: 'https://example.com/video.mp4'});

  assert.deepEqual(assignments, [
    ['crossOrigin', 'anonymous'],
    ['src', 'https://example.com/video.mp4'],
  ]);
});
