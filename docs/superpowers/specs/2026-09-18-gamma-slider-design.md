# Gamma Slider - Design Spec

## Overview

Add a Gamma slider to the Video Options section of the FastStream options page, positioned between the Saturation and Grayscale sliders. Gamma is a tonal correction that primarily adjusts mid-tone brightness without shifting the black/white point. Because CSS has no native `gamma()` filter function, gamma is implemented with an SVG `feComponentTransfer` filter (`type="gamma"`), following the existing daltonizer pattern of injecting a hidden SVG into the player DOM and referencing it via `url(#...)` in the CSS filter string.

Behavior follows the VLC/IINA convention: `1.0` (100%) is neutral, values above 1.0 brighten, values below 1.0 darken.

## Requirements

- New "Gamma" slider in the options page Video section, between Saturation and Grayscale
- Range 0.1-3.0 (slider 10-300%), neutral/default 1.0 (100%)
- Higher gamma = brighter (exponent = `1 / gamma`)
- True gamma math via SVG `feComponentTransfer`, not a brightness/contrast approximation
- Applies to both the main player video and the preview player
- Persisted as a normal video option (like saturation/contrast)
- Localized label added to all locales

## Components

### 1. Options Page UI

**File:** `chrome/player/options/index.html`

Add a `.video-option` block between the `videoSaturation` (line 98) and `videoGrayscale` (line 101) blocks:

```html
<div class="video-option search-target-remove" data-option="videoGamma">
    <div class="label search-target-text" data-i18n="options_video_gamma"></div>
    <input class="number" type="text" data-i18n-label="options_video_gamma"></input>
    <input class="range" type="range" min="10" max="300" value="100" step="1" list="snap-hundred"
        data-i18n-label="options_video_gamma"></input>
</div>
```

The generic `.video-option` wiring in `chrome/player/options/options.mjs` handles load, number/range sync, `optionChanged()` persistence, and double-click reset via `data-multiplier` (default 100) automatically. No per-option JS changes needed.

### 2. Default Options

**File:** `chrome/player/options/defaults/DefaultOptions.mjs`

Add `videoGamma: 1` after `videoSaturation` (line 30).

**File:** `chrome/player/FastStreamClient.mjs`

- Add `videoGamma: 1` to the default options object after `videoSaturation` (line 77).
- Add `this.options.videoGamma = options.videoGamma;` in the option-merging block between `videoSaturation` (line 351) and `videoGrayscale` (line 352).

### 3. Filter Engine

**File:** `chrome/player/utils/CSSFilterUtils.mjs`

- New static helper `makeGammaFilter(gamma)` returning `{svg, filter}`:
  - Build via existing `SVGUtils.makeSVGFilter()` (which sets `color-interpolation-filters="sRGB"`).
  - Add `feComponentTransfer` child, containing `feFuncR`, `feFuncG`, `feFuncB`, each with `type="gamma"`, `amplitude="1"`, `offset="0"`, and `exponent = 1 / gamma`.
  - Return `{svg, filter}` (mirrors `makeLMSDaltonizerFilter`).
- In `getFilterString()`, after the existing `videoHueRotate` block and inside the `!disableVisualFilters` guard:

  ```js
  if (options.videoGamma !== 1) {
    filters.push(`url(#video-gamma-filter)`);
  }
  ```

  Gamma is appended **last** so it acts as the final tonal correction on the already-adjusted image.

### 4. Player Wiring

**File:** `chrome/player/FastStreamClient.mjs`, `updateCSSFilters()` (line 411)

Mirror the daltonizer injection block exactly (remove-and-recreate on every update so a changed slider value always produces a filter with the current exponent), using fixed ids `video-gamma-svg` / `video-gamma-filter`:

```js
const previous = document.getElementById('video-gamma-svg');
if (previous) {
  previous.remove();
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

Both the `player` and `previewPlayer` videos reference the fixed id `video-gamma-filter`, so `updateCSSFilters()` needs no other changes.

Edge case: no player is loaded yet when `updateCSSFilters()` runs every option change - the SVG is appended to `playerContainer` which always exists, and the video element receives the filter string later. No change needed.

### 5. Localization

**Files:** `chrome/_locales/<lang>/messages.json` (all 16 locales) and `combined-locales.json`

Add the key `options_video_gamma` with message value "Gamma" (effectively identical across languages) to every locale file, placed after `options_video_saturation`. Keep locales in sync by running `npm run combine-locales` afterward.

### 6. Build

Run `npm run build` to regenerate the bundled `built/web/player/*` mirror and zips.

## Testing

- **New:** `tests/cssFilterUtils.test.mjs` (node:test style, mirroring `tests/blackBarDetector.test.mjs`):
  - `getFilterString` includes `url(#video-gamma-filter)` at the end of the string when `videoGamma !== 1`
  - `getFilterString` omits gamma when `videoGamma === 1`
  - `getFilterString` is unchanged for a full default options object
- Manual: load a video, set Gamma to 200% - image brightens in midtones; set to 50% - darkens; back to 100% - no change; works with brightness/contrast/saturation combos; disableVisualFilters disables it.

## Files to Create/Modify

| File | Action | Purpose |
|------|--------|---------|
| `chrome/player/options/index.html` | Modify | Add Gamma slider between Saturation and Grayscale |
| `chrome/player/options/defaults/DefaultOptions.mjs` | Modify | Add `videoGamma: 1` default |
| `chrome/player/FastStreamClient.mjs` | Modify | Default, option merge, SVG filter injection in `updateCSSFilters()` |
| `chrome/player/utils/CSSFilterUtils.mjs` | Modify | `makeGammaFilter()`, gamma `url()` in `getFilterString()` |
| `chrome/_locales/<lang>/messages.json` | Modify | Add `options_video_gamma` to all 16 locales |
| `combined-locales.json` | Modify | Regenerated via `npm run combine-locales` |
| `tests/cssFilterUtils.test.mjs` | **Create** | Unit tests for filter string |