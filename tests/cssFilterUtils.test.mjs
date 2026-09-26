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
    videoFlip: 0,
    videoZoom: 1,
    videoRotate: 0,
    ...overrides,
  };
}

const EPSILON = 1e-9;

/**
 * Parses the crop part of the transform, which must be a percentage translate
 * followed by a scale. Percentages are required because they resolve against
 * the element box without needing a layout read.
 */
function parseCropTransform(str) {
  const match = /translate\((-?[\d.e+-]+)%\s*,\s*(-?[\d.e+-]+)%\)\s*scale\(([\d.e+-]+)\s*,\s*([\d.e+-]+)\)/.exec(str);
  assert.ok(match, `expected a percentage crop transform, got: ${str}`);
  return {
    tx: Number(match[1]) / 100,
    ty: Number(match[2]) / 100,
    sx: Number(match[3]),
    sy: Number(match[4]),
  };
}

/**
 * Applies a CSS transform to a value expressed in element-relative units, with
 * the element box normalised to 1x1 and transform-origin at its centre.
 */
function project(value, translate, scale) {
  return 0.5 + translate + scale * (value - 0.5);
}

/**
 * Returns where the uncropped content rect ends up in element-relative units.
 * It must span exactly 0..1 on both axes for the bars to be gone.
 */
function projectedContentBox(crop, transform) {
  return {
    left: project(crop.left, transform.tx, transform.sx),
    right: project(1 - crop.right, transform.tx, transform.sx),
    top: project(crop.top, transform.ty, transform.sy),
    bottom: project(1 - crop.bottom, transform.ty, transform.sy),
  };
}

function cropTransformString(crop, overrides = {}) {
  return CSSFilterUtils.getTransformString(baseOptions({
    removeBlackBars: true,
    blackBarCrop: crop,
    ...overrides,
  }));
}

/**
 * Black bar removal stretches vertically only. The top and bottom bars are
 * removed so the picture fills the element top to bottom, while the horizontal
 * axis is left completely untouched: no side cropping, no side translation.
 */
function assertVerticalOnlyStretch(crop) {
  const transform = parseCropTransform(cropTransformString(crop));
  const box = projectedContentBox(crop, transform);

  assert.strictEqual(transform.sx, 1, 'horizontal scale must be exactly 1');
  assert.strictEqual(transform.tx, 0, 'horizontal translate must be exactly 0');
  assert.ok(Math.abs(box.left - crop.left) < EPSILON, `left edge moved to ${box.left}`);
  assert.ok(Math.abs(box.right - (1 - crop.right)) < EPSILON, `right edge moved to ${box.right}`);
  assert.ok(Math.abs(box.top) < EPSILON, `top edge sits at ${box.top}`);
  assert.ok(Math.abs(box.bottom - 1) < EPSILON, `bottom edge sits at ${box.bottom}`);
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

test('crop transform stretches vertically only, ignoring detected side bars', () => {
  assertVerticalOnlyStretch({top: 0.05, bottom: 0.05, left: 0.05, right: 0.05});
});

test('crop transform stretches vertically only with asymmetric bars', () => {
  assertVerticalOnlyStretch({top: 0.2, bottom: 0.05, left: 0, right: 0});
});

test('crop transform stretches vertically only with pillarbox bars and no letterbox', () => {
  assertVerticalOnlyStretch({top: 0, bottom: 0, left: 0.1, right: 0.06});
});

test('crop transform compensates for an off-centre content rect', () => {
  assertVerticalOnlyStretch({top: 0.3, bottom: 0.02, left: 0.04, right: 0.18});
});

test('crop transform still stretches when combined with the user zoom', () => {
  const crop = {top: 0.2, bottom: 0.05, left: 0.1, right: 0};
  const transform = parseCropTransform(cropTransformString(crop, {videoZoom: 2}));
  assert.ok(Math.abs(transform.sx) >= 1, 'user zoom may scale x, crop must not');
  assert.ok(Math.abs(transform.sy) >= 1, 'vertical stretch must still be present');
  const box = projectedContentBox(crop, transform);
  assert.ok(box.top <= EPSILON, `zoomed top edge sits at ${box.top}`);
  assert.ok(box.bottom >= 1 - EPSILON, `zoomed bottom edge sits at ${box.bottom}`);
});

test('no crop transform when black bar removal is disabled', () => {
  const str = cropTransformString({top: 0.1, bottom: 0.1, left: 0, right: 0}, {removeBlackBars: false});
  assert.strictEqual(str, '');
});

test('no crop transform when no crop has been detected', () => {
  assert.strictEqual(CSSFilterUtils.getTransformString(baseOptions({removeBlackBars: true})), '');
});
