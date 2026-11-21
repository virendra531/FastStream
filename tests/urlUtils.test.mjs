import assert from 'node:assert/strict';
import test from 'node:test';
import {PlayerModes} from '../chrome/player/enums/PlayerModes.mjs';
import {URLUtils} from '../chrome/player/utils/URLUtils.mjs';

test('trailing slash after a media extension does not hide the mode', () => {
  const url = 'https://www.porner.xxx/get_file/8512/hash/93660000/93660478/93660478_720m.mp4/';
  assert.equal(URLUtils.get_url_extension(url), 'mp4');
  assert.equal(URLUtils.getModeFromURL(url), PlayerModes.ACCELERATED_MP4);
});

test('trailing slash is ignored when the extension has a query string', () => {
  const url = 'https://media.test/video.mp4/?v=auto';
  assert.equal(URLUtils.get_url_extension(url), 'mp4');
  assert.equal(URLUtils.getModeFromURL(url), PlayerModes.ACCELERATED_MP4);
});
