# Gamma Slider Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Gamma slider to the FastStream Video Options page (between Saturation and Grayscale) that applies true gamma correction via an SVG `feComponentTransfer` filter.

**Architecture:** The new `videoGamma` option defaults to `1` (neutral). The options page slider follows the existing generic `.video-option` wiring (range 10-300, `data-multiplier` 100). `CSSFilterUtils.getFilterString()` appends `url(#video-gamma-filter)` at the end of the CSS filter chain when `videoGamma !== 1`; `FastStreamClient.updateCSSFilters()` injects/removes the hidden SVG gamma filter (exponent = `1 / gamma`) into the player DOM, mirroring the daltonizer pattern. Higher gamma = brighter.

**Tech Stack:** Vanilla ES modules, SVG filters (`feComponentTransfer`/`feFuncR/G/B`), WebExtension i18n, node:test for unit tests.

## Global Constraints

- Neutral gamma is `1.0`; higher brightens, lower darkens; `exponent = 1 / gamma`
- Slider range: `min=10 max=300 value=100 step=1` (0.1–3.0, 100% = neutral)
- Follow the existing daltonizer SVG-injection pattern in `updateCSSFilters()` (remove-and-recreate on every call, fixed ids `video-gamma-svg` / `video-gamma-filter`)
- Gamma `url()` must be appended **last** in the filter chain, inside the `!disableVisualFilters` guard
- Every `.video-option` uses the generic wiring in `chrome/player/options/options.mjs` — no per-option JS needed for the slider
- Localization: new key `options_video_gamma` added to all 16 locale files under `chrome/_locales/`, then `combined-locales.json` regenerated with `npm run combine-locales`
- Tests run with `node --test tests/<file>.mjs` (node:test + node:assert, style of `tests/blackBarDetector.test.mjs`)
- Final verification: `npm run build` regenerates `built/web/player/*`

---

### Task 1: Gamma filter engine + unit tests

**Files:**
- Modify: `chrome/player/utils/CSSFilterUtils.mjs:19-56` (`getFilterString`)
- Modify: `chrome/player/modules/SVGDaltonizer.mjs:499-511` (add `makeGammaFilter`)
- Test: `tests/cssFilterUtils.test.mjs` (create)

**Interfaces:**
- Produces: `SVGDaltonizer.makeGammaFilter(gamma)` → `{svg, filter}` (gamma is a number; `svg` is an `<svg>` element, `filter` is an `<filter id="video-gamma-filter">` with `feComponentTransfer` containing `feFuncR/G/B type="gamma"`)
- Produces: `CSSFilterUtils.makeGammaFilter(gamma)` → same shape as above (pass-through)
- Produces: `CSSFilterUtils.getFilterString(options)` now includes `url(#video-gamma-filter)` at the end when `options.videoGamma !== 1`

- [ ] **Step 1: Write the failing test**

Create `tests/cssFilterUtils.test.mjs`:

```js
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
  assert.ok(str.endsWith('url(#video-gamma-filter)'));
});

test('no filters at all when disableVisualFilters is true', () => {
  const str = CSSFilterUtils.getFilterString(baseOptions({
    disableVisualFilters: true,
    videoGamma: 2,
  }));
  assert.strictEqual(str, '');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/cssFilterUtils.test.mjs`
Expected: FAIL — asserts on `url(#video-gamma-filter)` fail because `getFilterString` does not yet emit it.

- [ ] **Step 3: Add `makeGammaFilter` to SVGDaltonizer**

In `chrome/player/modules/SVGDaltonizer.mjs`, insert this method inside the `SVGDaltonizer` class, immediately after the `makeLMSDaltonizerFilter` method (between its closing `}` and the final class-closing `}`):

```js
  /**
   * Generates an SVG filter for gamma correction.
   * @param {number} gamma - Gamma value. 1 is neutral; >1 brightens, <1 darkens.
   * @return {SVGFilterResult} An object containing the SVG and filter elements.
   */
  static makeGammaFilter(gamma) {
    const {svg, filter} = SVGUtils.makeSVGFilter();
    const transfer = document.createElementNS(SVGStandard, 'feComponentTransfer');
    const exponent = 1 / gamma;
    for (const channel of ['R', 'G', 'B']) {
      const func = document.createElementNS(SVGStandard, `feFunc${channel}`);
      func.setAttribute('type', 'gamma');
      func.setAttribute('amplitude', '1');
      func.setAttribute('exponent', '' + exponent);
      func.setAttribute('offset', '0');
      transfer.appendChild(func);
    }
    filter.appendChild(transfer);

    return {
      svg,
      filter,
    };
  }
```

Note: `SVGStandard`, `SVGUtils.makeSVGFilter()`, and `document` are already available in this module (`SVGStandard` and `SVGUtils` are module-scope; `document` is a browser global). `makeSVGFilter()` already sets `color-interpolation-filters="sRGB"`.

- [ ] **Step 4: Pass through in CSSFilterUtils + append gamma url in `getFilterString`**

In `chrome/player/utils/CSSFilterUtils.mjs`:

1. In `getFilterString()`, inside the `if (!options.disableVisualFilters)` block, add after the `videoHueRotate` block (lines 50-52):

```js
      if (options.videoGamma !== 1) {
        filters.push(`url(#video-gamma-filter)`);
      }
```

2. Add a pass-through method after `makeLMSDaltonizerFilter`:

```js
  /**
   * Creates an SVG gamma correction filter.
   * @param {number} gamma - Gamma value (1 = neutral, >1 brightens, <1 darkens).
   * @return {{svg: SVGElement, filter: SVGFilterElement}} The SVG and filter elements.
   */
  static makeGammaFilter(gamma) {
    return SVGDaltonizer.makeGammaFilter(gamma);
  }
```

- [ ] **Step 5: Run test to verify it passes**

Run: `node --test tests/cssFilterUtils.test.mjs`
Expected: PASS — all 3 tests green.

- [ ] **Step 6: Commit**

```bash
git add chrome/player/utils/CSSFilterUtils.mjs chrome/player/modules/SVGDaltonizer.mjs tests/cssFilterUtils.test.mjs
git commit -m "feat: add SVG gamma filter and filter string support"
```

---

### Task 2: `videoGamma` option defaults and plumbing

**Files:**
- Modify: `chrome/player/options/defaults/DefaultOptions.mjs:30` (after `videoSaturation: 1,`)
- Modify: `chrome/player/FastStreamClient.mjs:77` (default options object) and `:351` (option merge block)

**Interfaces:**
- Consumes: nothing from other tasks; the `videoGamma` field, once set on `options`, feeds Task 1's `getFilterString`.
- Produces: `videoGamma` present on `DefaultOptions` and on `FastStreamClient` `this.options` after `updateOptions`.

- [ ] **Step 1: Add default to `DefaultOptions.mjs`**

In `chrome/player/options/defaults/DefaultOptions.mjs`, change:

```js
  videoSaturation: 1,
  videoGrayscale: 0,
```

to:

```js
  videoSaturation: 1,
  videoGamma: 1,
  videoGrayscale: 0,
```

- [ ] **Step 2: Add default to `FastStreamClient` defaults**

In `chrome/player/FastStreamClient.mjs`, in the default options object (near line 77), change:

```js
      videoSaturation: 1,
      videoGrayscale: 0,
```

to:

```js
      videoSaturation: 1,
      videoGamma: 1,
      videoGrayscale: 0,
```

- [ ] **Step 3: Merge the option**

In the same file, in the option-merge block (near line 351), change:

```js
    this.options.videoSaturation = options.videoSaturation;
    this.options.videoGrayscale = options.videoGrayscale;
```

to:

```js
    this.options.videoSaturation = options.videoSaturation;
    this.options.videoGamma = options.videoGamma;
    this.options.videoGrayscale = options.videoGrayscale;
```

- [ ] **Step 4: Sanity check no regressions**

Run: `node --test tests/cssFilterUtils.test.mjs`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add chrome/player/options/defaults/DefaultOptions.mjs chrome/player/FastStreamClient.mjs
git commit -m "feat: add videoGamma default option"
```

---

### Task 3: Gamma slider in the options page

**Files:**
- Modify: `chrome/player/options/index.html:93-106` (between Saturation and Grayscale blocks)

**Interfaces:**
- Consumes: `videoGamma` option from Task 2; generic `.video-option` wiring in `chrome/player/options/options.mjs` (no per-option JS needed).
- Produces: a slider that reads/writes `Options.videoGamma` (100 = 1.0), persists via `optionChanged()`, resets on double-click.

- [ ] **Step 1: Insert the slider block**

In `chrome/player/options/index.html`, insert between the closing `</div>` of the `videoSaturation` block (line 98) and the opening `<div` of the `videoGrayscale` block (line 101):

```html
                <div class="video-option search-target-remove" data-option="videoGamma">
                    <div class="label search-target-text" data-i18n="options_video_gamma"></div>
                    <input class="number" type="text" data-i18n-label="options_video_gamma"></input>
                    <input class="range" type="range" min="10" max="300" value="100" step="1" list="snap-hundred"
                        data-i18n-label="options_video_gamma"></input>
                </div>
```

- [ ] **Step 2: Verify the options page markup balance**

Run: `node -e "const fs=require('fs'); const html=fs.readFileSync('chrome/player/options/index.html','utf8'); console.log('video-option blocks:', (html.match(/class=\"video-option/g)||[]).length)"`
Expected: prints `video-option blocks: 11` (was 10 — the 10 existing blocks include `daltonizerStrength`).

- [ ] **Step 3: Commit**

```bash
git add chrome/player/options/index.html
git commit -m "feat: add gamma slider to video options page"
```

---

### Task 4: Inject the gamma SVG filter in the player

**Files:**
- Modify: `chrome/player/FastStreamClient.mjs:411-441` (`updateCSSFilters`)

**Interfaces:**
- Consumes: `CSSFilterUtils.makeGammaFilter(gamma)` from Task 1; `this.options.videoGamma` from Task 2; `DOMElements.playerContainer` (already imported at line 11).
- Produces: `#video-gamma-svg` element present in the player container whenever `videoGamma !== 1`, removed otherwise; stable `id` `video-gamma-filter` referenced by the filter string.

- [ ] **Step 1: Add the injection block**

In `chrome/player/FastStreamClient.mjs`, inside `updateCSSFilters()`, insert the following **between** the end of the daltonizer injection block (closing `}` of the `if (this.options.videoDaltonizerType !== ...)` at line 427) and `const filterStr = ...` (line 429):

```js
    const gammaPrevious = document.getElementById('video-gamma-svg');
    if (gammaPrevious) {
      gammaPrevious.remove();
    }

    if (this.options.videoGamma !== 1) {
      const {svg, filter} = CSSFilterUtils.makeGammaFilter(this.options.videoGamma);
      svg.id = 'video-gamma-svg';
      filter.id = 'video-gamma-filter';
      svg.style.position = 'absolute';
      svg.style.width = '0px';
      svg.style.height = '0px';
      DOMElements.playerContainer.appendChild(svg);
    }
```

- [ ] **Step 2: Verify no regressions in the unit tests**

Run: `node --test tests/cssFilterUtils.test.mjs`
Expected: PASS (3 tests).

- [ ] **Step 3: Commit**

```bash
git add chrome/player/FastStreamClient.mjs
git commit -m "feat: inject gamma SVG filter into player DOM"
```

---

### Task 5: Localization

**Files:**
- Modify: all 16 locale files `chrome/_locales/<lang>/messages.json` (`en, de, es, fr, id, it, ja, ko, ms, nl, pl, pt_BR, ru, tr, zh_CN, zh_TW`)
- Regenerate: `combined-locales.json` via `npm run combine-locales`

**Interfaces:**
- Produces: `options_video_gamma` i18n key used by the Task 3 slider markup.

- [ ] **Step 1: Add the key to every locale file**

In each `chrome/_locales/<lang>/messages.json`, find the `"options_video_saturation"` entry (ends with `},`) and insert this immediately after it (keeping 4-space indentation):

For `en`, `de`, `es`, `fr`, `id`, `it`, `ms`, `nl`, `pl`, `pt_BR`, `tr`:

```json
    "options_video_gamma": {
        "message": "Gamma"
    },
```

For `ru`:

```json
    "options_video_gamma": {
        "message": "Гамма"
    },
```

For `ja`:

```json
    "options_video_gamma": {
        "message": "ガンマ"
    },
```

For `ko`:

```json
    "options_video_gamma": {
        "message": "감마"
    },
```

For `zh_CN`:

```json
    "options_video_gamma": {
        "message": "伽马"
    },
```

For `zh_TW`:

```json
    "options_video_gamma": {
        "message": "伽瑪"
    },
```

- [ ] **Step 2: Regenerate the combined locales file**

Run: `npm run combine-locales`
Expected: writes `combined-locales.json`; console shows key-check output with no `Missing keys in` lines for `options_video_gamma`.

- [ ] **Step 3: Verify all locales contain the key**

Run: `node -e "const fs=require('fs'); const dirs=fs.readdirSync('chrome/_locales'); const missing=dirs.filter(d=>!fs.readFileSync('chrome/_locales/'+d+'/messages.json','utf8').includes('options_video_gamma')); console.log(missing.length? 'MISSING: '+missing.join(', ') : 'all 16 locales have options_video_gamma');"`
Expected: prints `all 16 locales have options_video_gamma`.

- [ ] **Step 4: Commit**

```bash
git add chrome/_locales combined-locales.json
git commit -m "chore: add gamma label localization"
```

---

### Task 6: Rebuild bundles and verify

**Files:**
- Regenerate: `built/web/player/**` and `built/*.zip` via `npm run build`

**Interfaces:**
- Consumes: all source changes from Tasks 1-5.

- [ ] **Step 1: Rebuild**

Run: `npm run build`
Expected: build completes; `built/web` is recreated with bundled modules.

- [ ] **Step 2: Verify the built mirror has the feature**

Run: `rg -l "video-gamma-filter" built/web/player`
Expected: matches at least `built/web/player/utils/CSSFilterUtils.mjs` (bundled).

- [ ] **Step 3: Verify built options page has the slider**

Run: `rg -n "videoGamma" built/web/player/options/index.html`
Expected: one match for the `data-option="videoGamma"` slider block.

- [ ] **Step 4: Commit**

```bash
git add built
git commit -m "chore: rebuild bundles with gamma slider"
```

---

## Manual Verification Checklist

1. Load the extension, open the FastStream options page → Video section. A "Gamma" slider appears between "Saturation" and "Grayscale".
2. Play any video. Set Gamma to 200% → midtones brighten; set to 50% → darken; 100% → no change.
3. Combine Gamma (150%) with Brightness (120%) and Contrast (80%) — all apply together, gamma corrects last.
4. Toggle "disable visual filters" if available — gamma (and all filters) off.
5. Reload the options page — the saved gamma value persists.
6. Double-click the gamma slider — resets to 100%.