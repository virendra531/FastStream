import {test} from 'node:test';
import assert from 'node:assert';

// FSBlob reads these at module load time, so they must exist before import.
Object.defineProperty(globalThis, 'navigator', {
  value: {userAgent: 'Mozilla/5.0 Firefox/128.0'},
  configurable: true,
  writable: true,
});
globalThis.window = globalThis;
globalThis.addEventListener = () => {};
globalThis.indexedDB = undefined;

// AlertPolyfill -> SweetAlert -> DOMElements touches the DOM at import time.
globalThis.document = {
  querySelector: () => null,
  querySelectorAll: () => [],
  createElement: () => ({style: {}, setAttribute() {}, appendChild() {}}),
  body: {appendChild() {}, classList: {add() {}, remove() {}}},
  addEventListener: () => {},
};
globalThis.Element = class Element {};
globalThis.HTMLElement = class HTMLElement extends globalThis.Element {};

// Firefox path: not Chrome -> the Cache API branch is taken.
let cacheOpenBehavior = () => Promise.reject(
    new DOMException('NS_ERROR_FILE_NO_DEVICE_SPACE', 'NS_ERROR_FILE_NO_DEVICE_SPACE'),
);

globalThis.caches = {
  open: (name) => cacheOpenBehavior(name),
  delete: () => Promise.resolve(true),
};

globalThis.DOMException = DOMException;

const {FSBlob} = await import('../chrome/player/modules/FSBlob.mjs');

test('falls back to memory storage when the Cache API rejects', async () => {
  const unhandled = [];
  const onUnhandled = (reason) => unhandled.push(reason);
  process.on('unhandledRejection', onUnhandled);

  const blob = new FSBlob();

  // The constructor must not leave a rejected promise dangling.
  await blob.setupPromise.catch(() => {});
  await new Promise((r) => setTimeout(r, 10));

  process.off('unhandledRejection', onUnhandled);

  assert.deepStrictEqual(
      unhandled.map((e) => e.message),
      [],
      'constructor leaked an unhandled rejection',
  );
  assert.strictEqual(blob.cache, null, 'should not keep a dead cache handle');
  assert.strictEqual(blob.setupPromise, null, 'setupPromise should be cleared');

  process.off('unhandledRejection', onUnhandled);
});

test('saveBlobAsync still works in memory after the fallback', async () => {
  cacheOpenBehavior = () => Promise.resolve({
    put: () => Promise.resolve(),
    match: () => Promise.resolve(null),
    delete: () => Promise.resolve(true),
  });

  const blob = new FSBlob();
  await blob.setupPromise;
  const data = new Uint8Array([1, 2, 3]);
  const id = await blob.saveBlobAsync(new Blob([data]));
  assert.ok(id, 'should return an identifier');
});

test('healthy cache setup keeps the cache reference', async () => {
  const sentinel = {put() {}, match() {}, delete() {}};
  cacheOpenBehavior = () => Promise.resolve(sentinel);

  const blob = new FSBlob();
  await blob.setupPromise;
  assert.strictEqual(blob.cache, sentinel);
});

test('storage failure does not show a user-facing dialog', async () => {
  const alerts = [];
  const {AlertPolyfill} = await import('../chrome/player/utils/AlertPolyfill.mjs');
  const original = AlertPolyfill.alert;
  AlertPolyfill.alert = (msg) => alerts.push(msg);

  cacheOpenBehavior = () => Promise.reject(new Error('NS_ERROR_FILE_NO_DEVICE_SPACE'));
  const blob = new FSBlob();
  await blob.setupPromise?.catch?.(() => {});
  await new Promise((r) => setTimeout(r, 10));

  AlertPolyfill.alert = original;
  assert.deepStrictEqual(alerts, [], 'must not alert the user on storage fallback');
});
