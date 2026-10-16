# Black Bar Removal Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add automatic detection and removal of black bars encoded into video files during playback using canvas-based frame analysis and CSS transforms.

**Architecture:** A new `BlackBarDetector` module samples video frames to detect black bar boundaries, then CSS `transform: scale() translate()` is applied to the `<video>` element to zoom the content region to fill the player. Detection runs once on `LOADEDMETADATA`. Manual crop override is supported.

**Tech Stack:** Vanilla JS (ES modules), Canvas API for frame analysis, CSS transforms for display, existing `CSSFilterUtils` and `FastStreamClient` infrastructure.

## Global Constraints

- No external dependencies (everything is bundled in the extension)
- Must work on both Chrome (Manifest V3) and Firefox
- Follow existing code patterns (ES modules, EventEmitter pattern, DOMElements for element references)
- CSS transforms are applied via `CSSFilterUtils.getTransformString()` and `FastStreamClient.updateCSSFilters()`
- Options are stored in `FastStreamClient.options` and session storage for per-session persistence
- UI elements follow the ToolManager pattern with `data-tool` attributes and `toolSettings` configuration

---

## Task 1: Create BlackBarDetector Module

**Files:**
- Create: `chrome/player/modules/analyzer/BlackBarDetector.mjs`

**Interfaces:**
- Produces: `BlackBarDetector` class with `detect(video)`, `setManualCrop(crop)`, `clearManualCrop()`, `getCrop()` methods

- [ ] **Step 1: Create the BlackBarDetector class with canvas setup and constants**

```js
// chrome/player/modules/analyzer/BlackBarDetector.mjs

const CANVAS_WIDTH = 160;
const CANVAS_HEIGHT = 90;
const BRIGHTNESS_THRESHOLD = 15;
const SAMPLE_POSITIONS = [0.1, 0.25, 0.5, 0.75, 0.9];

export class BlackBarDetector {
  constructor() {
    this.canvas = document.createElement('canvas');
    this.canvas.width = CANVAS_WIDTH;
    this.canvas.height = CANVAS_HEIGHT;
    this.ctx = this.canvas.getContext('2d', {
      willReadFrequently: true,
    });
    this.manualCrop = null;
    this.detectedCrop = null;
  }
```

- [ ] **Step 2: Implement the detect method**

```js
  detect(video) {
    if (this.manualCrop) {
      return this.manualCrop;
    }

    const duration = video.duration;
    if (!duration || duration <= 0 || video.videoWidth === 0 || video.videoHeight === 0) {
      return null;
    }

    const crops = [];

    for (const position of SAMPLE_POSITIONS) {
      const time = duration * position;
      const crop = this.detectFromFrame(video, time);
      if (crop) {
        crops.push(crop);
      }
    }

    if (crops.length === 0) {
      return null;
    }

    // Use tightest crop (max of all detected values)
    const result = {
      top: Math.max(...crops.map((c) => c.top)),
      bottom: Math.max(...crops.map((c) => c.bottom)),
      left: Math.max(...crops.map((c) => c.left)),
      right: Math.max(...crops.map((c) => c.right)),
    };

    // Validate: crop should not exceed 40% on any edge
    const maxCrop = 0.4;
    result.top = Math.min(result.top, maxCrop);
    result.bottom = Math.min(result.bottom, maxCrop);
    result.left = Math.min(result.left, maxCrop);
    result.right = Math.min(result.right, maxCrop);

    this.detectedCrop = result;
    return result;
  }
```

- [ ] **Step 3: Implement the detectFromFrame method for single frame analysis**

```js
  detectFromFrame(video, time) {
    const originalTime = video.currentTime;

    // Seek to target time
    video.currentTime = time;

    // Draw frame to canvas
    this.ctx.drawImage(video, 0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
    const imageData = this.ctx.getImageData(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
    const data = imageData.data;

    // Detect edges
    const top = this.detectTopEdge(data);
    const bottom = this.detectBottomEdge(data);
    const left = this.detectLeftEdge(data);
    const right = this.detectRightEdge(data);

    // Restore original time
    video.currentTime = originalTime;

    return {top, bottom, left, right};
  }
```

- [ ] **Step 4: Implement edge detection methods**

```js
  detectTopEdge(data) {
    for (let y = 0; y < CANVAS_HEIGHT; y++) {
      if (this.isRowContent(data, y)) {
        return y / CANVAS_HEIGHT;
      }
    }
    return 1;
  }

  detectBottomEdge(data) {
    for (let y = CANVAS_HEIGHT - 1; y >= 0; y--) {
      if (this.isRowContent(data, y)) {
        return (CANVAS_HEIGHT - 1 - y) / CANVAS_HEIGHT;
      }
    }
    return 1;
  }

  detectLeftEdge(data) {
    for (let x = 0; x < CANVAS_WIDTH; x++) {
      if (this.isColumnContent(data, x)) {
        return x / CANVAS_WIDTH;
      }
    }
    return 1;
  }

  detectRightEdge(data) {
    for (let x = CANVAS_WIDTH - 1; x >= 0; x--) {
      if (this.isColumnContent(data, x)) {
        return (CANVAS_WIDTH - 1 - x) / CANVAS_WIDTH;
      }
    }
    return 1;
  }

  isRowContent(data, y) {
    let totalBrightness = 0;
    for (let x = 0; x < CANVAS_WIDTH; x++) {
      const idx = (y * CANVAS_WIDTH + x) * 4;
      const r = data[idx];
      const g = data[idx + 1];
      const b = data[idx + 2];
      totalBrightness += (r + g + b) / 3;
    }
    const avgBrightness = totalBrightness / CANVAS_WIDTH;
    return avgBrightness > BRIGHTNESS_THRESHOLD;
  }

  isColumnContent(data, x) {
    let totalBrightness = 0;
    for (let y = 0; y < CANVAS_HEIGHT; y++) {
      const idx = (y * CANVAS_WIDTH + x) * 4;
      const r = data[idx];
      const g = data[idx + 1];
      const b = data[idx + 2];
      totalBrightness += (r + g + b) / 3;
    }
    const avgBrightness = totalBrightness / CANVAS_HEIGHT;
    return avgBrightness > BRIGHTNESS_THRESHOLD;
  }
```

- [ ] **Step 5: Implement manual crop methods**

```js
  setManualCrop(crop) {
    this.manualCrop = {
      top: crop.top || 0,
      bottom: crop.bottom || 0,
      left: crop.left || 0,
      right: crop.right || 0,
    };
  }

  clearManualCrop() {
    this.manualCrop = null;
  }

  getCrop() {
    return this.manualCrop || this.detectedCrop;
  }
}
```

- [ ] **Step 6: Commit**

```bash
git add chrome/player/modules/analyzer/BlackBarDetector.mjs
git commit -m "feat: add BlackBarDetector module for detecting black bars in video frames"
```

---

## Task 2: Add Options and CSS Transform Integration

**Files:**
- Modify: `chrome/player/options/defaults/DefaultOptions.mjs` (add 2 new options)
- Modify: `chrome/player/utils/CSSFilterUtils.mjs` (add crop transform computation)
- Modify: `chrome/player/FastStreamClient.mjs` (add options, import, and detection trigger)

**Interfaces:**
- Consumes: `BlackBarDetector` from Task 1
- Produces: `options.removeBlackBars`, `options.blackBarCrop` fields; crop transform in `CSSFilterUtils.getTransformString()`

- [ ] **Step 1: Add new options to DefaultOptions.mjs**

```js
// Add after line 37 (videoZoom: 1,)
removeBlackBars: false,
blackBarCrop: null,
```

- [ ] **Step 2: Add crop transform to CSSFilterUtils.getTransformString**

```js
// In CSSFilterUtils.getTransformString(options), add at the beginning of the method:
  static getTransformString(options) {
    const transforms = [];

    // Black bar removal crop transform (applied first)
    if (options.removeBlackBars && options.blackBarCrop) {
      const crop = options.blackBarCrop;
      const scaleX = 1 / (1 - crop.left - crop.right);
      const scaleY = 1 / (1 - crop.top - crop.bottom);
      const translateX = (crop.left - crop.right) * scaleX;
      const translateY = (crop.top - crop.bottom) * scaleY;
      transforms.push(`translate(${translateX}px, ${translateY}px) scale(${scaleX}, ${scaleY})`);
    }

    if (options.videoFlip !== 0) {
      // ... existing flip/zoom code unchanged
```

- [ ] **Step 3: Add options and import to FastStreamClient.mjs**

```js
// Add import at top (after line 19):
import {BlackBarDetector} from './modules/analyzer/BlackBarDetector.mjs';

// Add to constructor after this.videoAnalyzer line:
this.blackBarDetector = new BlackBarDetector();

// Add options (after line 88, videoFlip: 0,):
removeBlackBars: false,
blackBarCrop: null,
```

- [ ] **Step 4: Add detection trigger on LOADEDMETADATA**

```js
// In the LOADEDMETADATA handler (around line 1398), add:
this.context.on(DefaultPlayerEvents.LOADEDMETADATA, (event) => {
  this.interfaceController.updateQualityLevels();

  // Black bar detection
  if (this.options.removeBlackBars && !this.options.blackBarCrop) {
    const video = this.player.getVideo();
    if (video) {
      const crop = this.blackBarDetector.detect(video);
      if (crop) {
        this.options.blackBarCrop = crop;
        this.updateCSSFilters();
      }
    }
  }
});
```

- [ ] **Step 5: Commit**

```bash
git add chrome/player/options/defaults/DefaultOptions.mjs chrome/player/utils/CSSFilterUtils.mjs chrome/player/FastStreamClient.mjs
git commit -m "feat: integrate black bar removal options and CSS transform"
```

---

## Task 3: Add Toggle Method and Session Persistence

**Files:**
- Modify: `chrome/player/FastStreamClient.mjs` (add toggle method, session storage handling)

**Interfaces:**
- Consumes: `BlackBarDetector` from Task 1, options from Task 2
- Produces: `toggleRemoveBlackBars()` method on FastStreamClient

- [ ] **Step 1: Add session storage loading for new options**

```js
// In FastStreamClient constructor, after line 330 (sessionStorage for disableVisualFilters):
if (sessionStorage.getItem('removeBlackBars') === 'true') {
  this.options.removeBlackBars = true;
}
const savedCrop = sessionStorage.getItem('blackBarCrop');
if (savedCrop) {
  try {
    this.options.blackBarCrop = JSON.parse(savedCrop);
  } catch (e) {
    // ignore
  }
}
```

- [ ] **Step 2: Add toggle method**

```js
// Add after updateCSSFilters() method:
toggleRemoveBlackBars() {
  this.options.removeBlackBars = !this.options.removeBlackBars;
  sessionStorage.setItem('removeBlackBars', this.options.removeBlackBars);

  if (this.options.removeBlackBars) {
    if (!this.options.blackBarCrop && this.player) {
      const video = this.player.getVideo();
      if (video) {
        const crop = this.blackBarDetector.detect(video);
        if (crop) {
          this.options.blackBarCrop = crop;
          sessionStorage.setItem('blackBarCrop', JSON.stringify(crop));
        }
      }
    }
  } else {
    this.options.blackBarCrop = null;
    this.blackBarDetector.clearManualCrop();
    sessionStorage.removeItem('blackBarCrop');
  }

  this.updateCSSFilters();
}
```

- [ ] **Step 3: Add method to set manual crop**

```js
// Add after toggleRemoveBlackBars:
setManualBlackBarCrop(crop) {
  this.blackBarDetector.setManualCrop(crop);
  this.options.blackBarCrop = crop;
  sessionStorage.setItem('blackBarCrop', JSON.stringify(crop));
  this.updateCSSFilters();
}

resetBlackBarCrop() {
  this.blackBarDetector.clearManualCrop();
  this.options.blackBarCrop = null;
  sessionStorage.removeItem('blackBarCrop');

  if (this.options.removeBlackBars && this.player) {
    const video = this.player.getVideo();
    if (video) {
      const crop = this.blackBarDetector.detect(video);
      if (crop) {
        this.options.blackBarCrop = crop;
        sessionStorage.setItem('blackBarCrop', JSON.stringify(crop));
      }
    }
  }

  this.updateCSSFilters();
}
```

- [ ] **Step 4: Commit**

```bash
git add chrome/player/FastStreamClient.mjs
git commit -m "feat: add black bar toggle, manual crop, and session persistence"
```

---

## Task 4: Add UI Button and Keybind

**Files:**
- Modify: `chrome/player/ui/DOMElements.mjs` (add button reference)
- Modify: `chrome/player/ui/InterfaceController.mjs` (add button setup and toggle handler)
- Modify: `chrome/player/ui/ToolManager.mjs` (add to tool visibility)
- Modify: `chrome/player/options/defaults/ToolSettings.mjs` (add tool config)
- Modify: `chrome/player/ui/KeybindManager.mjs` (add keybind handler)
- Modify: `chrome/player/options/defaults/DefaultKeybinds.mjs` (add default keybind)
- Modify: `chrome/player/index.html` (add button element)

**Interfaces:**
- Consumes: `toggleRemoveBlackBars()` from Task 3

- [ ] **Step 1: Add DOMElement reference**

```js
// In DOMElements.mjs, add after loopButton line:
removeBlackBarsButton: document.querySelector('.mainplayer .fluid_control_remove_black_bars'),
```

- [ ] **Step 2: Add button to HTML**

```html
<!-- In index.html, after the loop button div (around line 206), add: -->
<div role="button" data-i18n-label="player_remove_black_bars_label" class="fluid_button fluid_control_remove_black_bars">
    <svg>
        <use href="assets/fluidplayer/static/icons2.svg#crop"></use>
    </svg>
</div>
```

- [ ] **Step 3: Add SVG icon to icons2.svg**

```xml
<!-- Add inside <defs> section of icons2.svg, before closing </svg>: -->
<symbol id="crop" viewBox="0 0 24 24" stroke="currentColor" fill="none" stroke-width="2">
    <path d="M6 2v4H2v2h4v10h10v4h2v-4h4v-2H8V6h10v4h2V4h-4V2H6z" stroke-linejoin="round"/>
</symbol>

<!-- Add after the skip-backward use line: -->
<use transform="translate(144,0)" href="#crop" width="24" height="24" />
```

- [ ] **Step 4: Add tool settings configuration**

```js
// In DefaultToolSettings.mjs, add after the forward entry:
'removeblackbars': {
    'location': 'extra',
    'priority': 700,
},
```

- [ ] **Step 5: Add to ToolManager toolElements and visibility**

```js
// In ToolManager.mjs, add to toolElements object (around line 169):
removeblackbars: DOMElements.removeBlackBarsButton,

// Add visibility logic in updateToolVisibility method (after screenshot block):
if (this.client.player) {
    DOMElements.removeBlackBarsButton.classList.remove('hidden');
} else {
    DOMElements.removeBlackBarsButton.classList.add('hidden');
}
```

- [ ] **Step 6: Add toggle handler in InterfaceController**

```js
// In InterfaceController.mjs constructor, add event listener setup for the button:
// After the loop button setup or similar pattern:
DOMElements.removeBlackBarsButton.addEventListener('click', (e) => {
    e.stopPropagation();
    this.client.toggleRemoveBlackBars();
    this.updateRemoveBlackBarsIndicator();
});

// Add indicator update method:
updateRemoveBlackBarsIndicator() {
    if (this.client.options.removeBlackBars) {
        DOMElements.removeBlackBarsButton.classList.add('active');
    } else {
        DOMElements.removeBlackBarsButton.classList.remove('active');
    }
}
```

- [ ] **Step 7: Add keybind handler**

```js
// In KeybindManager.mjs, add handler (after the ZoomReset handler around line 211):
this.on('ToggleBlackBars', (e) => {
    this.client.toggleRemoveBlackBars();
    this.client.interfaceController.updateRemoveBlackBarsIndicator();
});
```

- [ ] **Step 8: Add default keybind**

```js
// In DefaultKeybinds.mjs, add:
'ToggleBlackBars': 'None',
```

- [ ] **Step 9: Add localization string**

```json
// In chrome/_locales/en/messages.json, add:
"player_remove_black_bars_label": {
    "message": "Remove black bars"
},
```

- [ ] **Step 10: Add CSS styling for active state**

```css
/* In fluidplayer.css or custom.css, add: */
.fluid_control_remove_black_bars.active {
    color: var(--player-accent-color, #5cb8ff);
}
```

- [ ] **Step 11: Commit**

```bash
git add chrome/player/ui/DOMElements.mjs chrome/player/ui/InterfaceController.mjs chrome/player/ui/ToolManager.mjs chrome/player/options/defaults/ToolSettings.mjs chrome/player/ui/KeybindManager.mjs chrome/player/options/defaults/DefaultKeybinds.mjs chrome/player/index.html chrome/player/assets/fluidplayer/static/icons2.svg chrome/_locales/en/messages.json chrome/player/assets/fluidplayer/css/fluidplayer.css
git commit -m "feat: add black bar removal UI button, keybind, and styling"
```

---

## Task 5: Reset Detection on Source Change

**Files:**
- Modify: `chrome/player/FastStreamClient.mjs` (reset crop on new source)

**Interfaces:**
- Consumes: Detection state from Task 2-3

- [ ] **Step 1: Reset black bar state when video source changes**

```js
// In FastStreamClient, find where the source changes and reset detection state.
// Look for where this.player is set or source changes, and add:
// Reset black bar detection for new video (but keep the feature enabled)
if (this.options.removeBlackBars) {
    this.blackBarDetector.detectedCrop = null;
    if (!this.blackBarDetector.manualCrop) {
        this.options.blackBarCrop = null;
    }
}
```

This ensures each new video gets fresh detection while preserving manual crop settings if the user set them.

- [ ] **Step 2: Commit**

```bash
git add chrome/player/FastStreamClient.mjs
git commit -m "feat: reset black bar detection on source change"
```
