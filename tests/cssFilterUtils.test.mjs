import {test} from 'node:test';
import assert from 'node:assert';
import {CSSFilterUtils} from '../chrome/player/utils/CSSFilterUtils.mjs';
import {DaltonizerTypes} from '../chrome/player/options/defaults/DaltonizerTypes.mjs';

function baseOptions(overrides = {}) {
  return {
    disableVisualFilters: false,
    videoDaltonizerType: DaltonizerTypes.NONE,
    videoDaltonizerStrength: 0,
    videoBrightness: 1,
    videoContrast: 1,
    videoSaturation: 1,
    videoGamma: 1,
    videoGrayscale: 0,
    videoSepia: 0,
    videoInvert: 0,
    videoHueRotate: 0,
    ...overrides,
  };
}

test('no gamma filter when videoGamma is 1', () => {
  assert.strictEqual(CSSFilterUtils.getFilterString(baseOptions()), '');
});

test('gamma url appended at end when videoGamma is not 1', () => {
  const str = CSSFilterUtils.getFilterString(baseOptions({
    videoBrightness: 1.2,
    videoHueRotate: 90,
    videoGamma: 2,
  }));
  assert.match(str, /brightness\(1\.2\)/);
  assert.match(str, /hue-rotate\(90deg\)/);
  assert.ok(str.endsWith('url(#video-gamma-2)'));
});

test('gamma url embeds the value', () => {
  const str = CSSFilterUtils.getFilterString(baseOptions({videoGamma: 1.5}));
  assert.strictEqual(str, 'url(#video-gamma-1.5)');
});

test('no filters at all when disableVisualFilters is true', () => {
  const str = CSSFilterUtils.getFilterString(baseOptions({
    disableVisualFilters: true,
    videoGamma: 2,
  }));
  assert.strictEqual(str, '');
});
