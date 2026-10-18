// Minimal browser-global stubs so chrome/player modules with DOM-touching
// top-level imports can be evaluated under `node --test`. Only import-time
// code paths are supported; these stubs are NOT a DOM implementation.

const noop = () => {};

const makeCanvasContext = () => ({
  canvas: null,
  getImageData: () => ({data: []}),
  putImageData: noop,
  drawImage: noop,
  fillRect: noop,
  clearRect: noop,
  fillText: noop,
  measureText: () => ({width: 0}),
  save: noop,
  restore: noop,
  translate: noop,
  scale: noop,
  rotate: noop,
  createImageData: () => ({data: []}),
  setTransform: noop,
  beginPath: noop,
  closePath: noop,
  moveTo: noop,
  lineTo: noop,
  stroke: noop,
  fill: noop,
  arc: noop,
  rect: noop,
  clip: noop,
});

const makeElement = () => {
  const element = {
    style: {},
    classList: {add: noop, remove: noop, toggle: noop, contains: () => false},
    appendChild: noop,
    removeChild: noop,
    addEventListener: noop,
    removeEventListener: noop,
    setAttribute: noop,
    getAttribute: () => null,
    querySelector: () => sharedElement,
    querySelectorAll: () => [],
    getBoundingClientRect: () => ({top: 0, left: 0, width: 0, height: 0}),
    children: [],
    childNodes: [],
    dataset: {},
    innerHTML: '',
    textContent: '',
    getContext: makeCanvasContext,
    width: 0,
    height: 0,
    toBlob: noop,
    toDataURL: () => '',
  };
  return element;
};

const sharedElement = makeElement();

export function installBrowserGlobals() {
  globalThis.document = {
    createElement: makeElement,
    createElementNS: makeElement,
    createDocumentFragment: makeElement,
    body: makeElement(),
    head: makeElement(),
    documentElement: makeElement(),
    addEventListener: noop,
    removeEventListener: noop,
    querySelector: () => sharedElement,
    querySelectorAll: () => [],
    getElementById: () => sharedElement,
    cookie: '',
    readyState: 'complete',
  };
  globalThis.window = globalThis;
  try {
    Object.defineProperty(globalThis, 'navigator', {
      value: {userAgent: 'node', language: 'en', languages: ['en'], platform: 'node'},
      configurable: true,
    });
  } catch {
    // navigator is a non-configurable getter in some Node builds; leave it.
  }
  globalThis.location = {href: 'http://localhost/', origin: 'http://localhost', protocol: 'http:'};
  globalThis.addEventListener = noop;
  globalThis.removeEventListener = noop;
  globalThis.dispatchEvent = () => true;
  globalThis.localStorage = {getItem: () => null, setItem: noop, removeItem: noop};
  globalThis.sessionStorage = globalThis.localStorage;
  globalThis.matchMedia = () => ({matches: false, addEventListener: noop, removeEventListener: noop});
  globalThis.getComputedStyle = () => ({getPropertyValue: () => ''});
  globalThis.requestAnimationFrame = noop;
  globalThis.cancelAnimationFrame = noop;
  globalThis.MediaSource = class {};
  globalThis.HTMLVideoElement = class {};
  globalThis.HTMLElement = class {};
  globalThis.HTMLCanvasElement = class {};
  globalThis.Element = class {};
  globalThis.Node = class {};
  globalThis.NodeList = class {};
  globalThis.Audio = class {};
  globalThis.Event = class {
    constructor(type) {
      this.type = type;
    }
  };
  globalThis.CustomEvent = class extends globalThis.Event {};
  globalThis.MutationObserver = class {
    observe() {}
    disconnect() {}
  };
  globalThis.customElements = {
    define: noop,
    get: () => undefined,
    whenDefined: () => Promise.resolve(),
  };
}
