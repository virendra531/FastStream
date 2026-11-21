import {test} from 'node:test';
import assert from 'node:assert';

import {MP4Box, DataStream} from '../chrome/player/modules/mp4box.mjs';

function makeSamples(count) {
  return Array.from({length: count}, (_, i) => ({
    track_id: 1,
    dts: i * 100,
    cts: i * 100,
    duration: 100,
    size: 4,
    is_sync: i % 30 === 0,
    data: new Uint8Array([i & 255, 0, 0, 0]),
  }));
}

function makeFile(samples) {
  const trak = {tkhd: {track_id: 1}, first_dts: 0, samples, nextSample: 0};
  const file = MP4Box.createFile(false);
  file.moov = {traks: [trak]};
  file.getTrackById = () => trak;
  file.getSample = (_trak, index) => samples[index] || null;
  return {file, trak};
}

function countBox(bytes, fourcc) {
  let count = 0;
  for (let i = 0; i <= bytes.length - 4; i++) {
    if (bytes[i] === fourcc.charCodeAt(0) && bytes[i + 1] === fourcc.charCodeAt(1) &&
        bytes[i + 2] === fourcc.charCodeAt(2) && bytes[i + 3] === fourcc.charCodeAt(3)) {
      count++;
    }
  }
  return count;
}

test('createFragment emits one moof for a batch of samples', () => {
  const {file} = makeFile(makeSamples(60));
  const stream = file.createFragment(1, 0, 59, null);
  const bytes = new Uint8Array(stream.buffer);

  assert.equal(countBox(bytes, 'moof'), 1);
  assert.equal(countBox(bytes, 'mdat'), 1);

  const trun = Buffer.from(bytes).indexOf(Buffer.from('trun'));
  assert.ok(trun > 0);
  assert.equal(bytes[trun + 8], 0);
  assert.equal(bytes[trun + 9], 0);
  assert.equal(bytes[trun + 10], 0);
  assert.equal(bytes[trun + 11], 60);
});

test('processSamples batches samples into fragments instead of one per sample', () => {
  const samples = makeSamples(120);
  const {file, trak} = makeFile(samples);
  const ranges = [];
  let segments = 0;

  file.sampleProcessingStarted = true;
  file.isFragmentationInitialized = true;
  file.fragmentedTracks = [{
    id: 1,
    user: 1,
    trak,
    segmentStream: null,
    nb_samples: 60,
    nb_samples_per_fragment: 60,
  }];
  file.createFragment = (_id, start, end) => {
    ranges.push([start, end]);
    return new DataStream();
  };
  file.onSegment = () => {
    segments++;
  };

  file.processSamples();

  assert.deepEqual(ranges, [[0, 59], [60, 119]]);
  assert.equal(segments, 2);
});
