# Mobile Fullscreen Tap Controls Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** On touch devices in fullscreen-like playback, replace mouse-driven controls with tap controls: tap the bottom bar to reveal, tap the video to hide/play-pause, double-tap the video to seek with visual feedback.

**Architecture:** A new pure-logic module (`TouchGestureLogic.mjs`) holds the testable decision helpers. A new controller (`TouchFullscreenControls.mjs`) owns the touch listeners, tap/drag detection, single/double-tap resolution, and seek feedback DOM; it is constructed by `InterfaceController` (the same pattern as `ProgressBar`/`VolumeControls`). `InterfaceController` gains small guards that disable its mouse-driven handlers while the controller is active.

**Tech Stack:** Vanilla JS (ES modules), no new dependencies. Tests use `node --test`.

## Global Constraints
- Do NOT add comments to any new or modified code.
- Behavior applies ONLY when `isTouchDevice()` is true AND `interfaceController.isFullscreenLike()` is true.
- Do not alter desktop or windowed (non-fullscreen) behavior.
- Seek amount is `seekStepSize * 5` (matches the existing skip buttons; default `2 * 5 = 10s`).
- Detection: `navigator.maxTouchPoints > 0 && (coarse pointer || EnvUtils.isMobile())`.
- Use exact selector convention `.mainplayer ...` for new CSS.
- Preserve existing commit style (`feat:` / `fix:`).

---

### Task 1: Pure gesture logic module

**Files:**
- Create: `chrome/player/ui/TouchGestureLogic.mjs`
- Test: `tests/touchGestureLogic.test.mjs`

**Interfaces:**
- Consumes: nothing.
- Produces (all named exports from `chrome/player/ui/TouchGestureLogic.mjs`):
  - `DRAG_THRESHOLD` (number, `10`)
  - `TAP_WINDOW_MS` (number, `300`)
  - `getTapZone(x, y, rect)` → `'controls' | 'video'` (bottom 15% of `rect` is `'controls'`)
  - `getSeekDirection(x, rect)` → `-1 | 1` (left half `-1`, right half `1`)
  - `getSeekAmount(seekStepSize)` → `number` (`seekStepSize * 5`)
  - `isTouchDevice(maxTouchPoints, coarsePointer, isMobile)` → `boolean`
  - `createTapResolver({onSingle, onDouble, window, schedule, cancel})` → `{tap(payload, time), reset()}`

- [ ] **Step 1: Write the failing tests**

Create `tests/touchGestureLogic.test.mjs`:

```javascript
import {test} from 'node:test';
import assert from 'node:assert';

import {
  getTapZone,
  getSeekDirection,
  getSeekAmount,
  isTouchDevice,
  createTapResolver,
} from '../chrome/player/ui/TouchGestureLogic.mjs';

test('getTapZone reports controls in the bottom 15%', () => {
  const rect = {top: 0, height: 1000};
  assert.strictEqual(getTapZone(100, 900, rect), 'controls');
  assert.strictEqual(getTapZone(100, 849, rect), 'video');
  assert.strictEqual(getTapZone(100, 850, rect), 'controls');
});

test('getTapZone handles a rect offset from the viewport top', () => {
  const rect = {top: 100, height: 1000};
  assert.strictEqual(getTapZone(50, 950, rect), 'controls');
  assert.strictEqual(getTapZone(50, 949, rect), 'video');
});

test('getTapZone defaults to video for a degenerate rect', () => {
  assert.strictEqual(getTapZone(10, 10, {top: 0, height: 0}), 'video');
  assert.strictEqual(getTapZone(10, 10, null), 'video');
});

test('getSeekDirection is backward on the left half and forward on the right', () => {
  const rect = {left: 0, width: 1000};
  assert.strictEqual(getSeekDirection(100, rect), -1);
  assert.strictEqual(getSeekDirection(900, rect), 1);
  assert.strictEqual(getSeekDirection(500, rect), 1);
});

test('getSeekDirection is forward for a degenerate rect', () => {
  assert.strictEqual(getSeekDirection(10, {left: 0, width: 0}), 1);
  assert.strictEqual(getSeekDirection(10, null), 1);
});

test('getSeekAmount multiplies the step size by five', () => {
  assert.strictEqual(getSeekAmount(2), 10);
  assert.strictEqual(getSeekAmount(0.5), 2.5);
});

test('isTouchDevice requires touch points and a coarse or mobile pointer', () => {
  assert.strictEqual(isTouchDevice(5, true, false), true);
  assert.strictEqual(isTouchDevice(5, false, true), true);
  assert.strictEqual(isTouchDevice(0, true, true), false);
  assert.strictEqual(isTouchDevice(5, false, false), false);
});

function makeFakeScheduler() {
  let nextId = 1;
  const tasks = new Map();
  return {
    schedule: (fn) => {
      const id = nextId++;
      tasks.set(id, fn);
      return id;
    },
    cancel: (id) => {
      tasks.delete(id);
    },
    runAll: () => {
      for (const [id, fn] of [...tasks]) {
        tasks.delete(id);
        fn();
      }
    },
    get size() {
      return tasks.size;
    },
  };
}

test('a lone tap resolves as single after the window elapses', () => {
  const single = [];
  const double = [];
  const clock = makeFakeScheduler();
  const resolver = createTapResolver({
    onSingle: (p) => single.push(p),
    onDouble: (p) => double.push(p),
    schedule: clock.schedule,
    cancel: clock.cancel,
    window: 300,
  });

  assert.strictEqual(resolver.tap('a', 0), 'single');
  assert.strictEqual(clock.size, 1);
  clock.runAll();
  assert.deepStrictEqual(single, ['a']);
  assert.deepStrictEqual(double, []);
});

test('a second tap within the window resolves as double and cancels the single', () => {
  const single = [];
  const double = [];
  const clock = makeFakeScheduler();
  const resolver = createTapResolver({
    onSingle: (p) => single.push(p),
    onDouble: (p) => double.push(p),
    schedule: clock.schedule,
    cancel: clock.cancel,
    window: 300,
  });

  resolver.tap('a', 0);
  assert.strictEqual(resolver.tap('b', 200), 'double');
  assert.strictEqual(clock.size, 0);
  clock.runAll();
  assert.deepStrictEqual(single, []);
  assert.deepStrictEqual(double, ['b']);
});

test('a tap after the window has elapsed starts a fresh pair', () => {
  const single = [];
  const double = [];
  const clock = makeFakeScheduler();
  const resolver = createTapResolver({
    onSingle: (p) => single.push(p),
    onDouble: (p) => double.push(p),
    schedule: clock.schedule,
    cancel: clock.cancel,
    window: 300,
  });

  resolver.tap('a', 0);
  clock.runAll();
  assert.strictEqual(resolver.tap('b', 400), 'single');
  assert.strictEqual(resolver.tap('c', 500), 'double');
  assert.deepStrictEqual(single, ['a']);
  assert.deepStrictEqual(double, ['c']);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test tests/touchGestureLogic.test.mjs`
Expected: FAIL — `Cannot find module '../chrome/player/ui/TouchGestureLogic.mjs'` (or `ERR_MODULE_NOT_FOUND`).

- [ ] **Step 3: Implement the module**

Create `chrome/player/ui/TouchGestureLogic.mjs`:

```javascript
export const DRAG_THRESHOLD = 10;
export const TAP_WINDOW_MS = 300;
export const CONTROLS_ZONE_RATIO = 0.15;

export function getTapZone(x, y, rect) {
  if (!rect || rect.height <= 0) {
    return 'video';
  }
  const relativeY = y - rect.top;
  if (relativeY >= rect.height * (1 - CONTROLS_ZONE_RATIO)) {
    return 'controls';
  }
  return 'video';
}

export function getSeekDirection(x, rect) {
  if (!rect || rect.width <= 0) {
    return 1;
  }
  return (x - rect.left) < rect.width / 2 ? -1 : 1;
}

export function getSeekAmount(seekStepSize) {
  return seekStepSize * 5;
}

export function isTouchDevice(maxTouchPoints, coarsePointer, isMobile) {
  return maxTouchPoints > 0 && (coarsePointer || isMobile);
}

export function createTapResolver(options = {}) {
  const windowMs = options.window !== undefined ? options.window : TAP_WINDOW_MS;
  const schedule = options.schedule || setTimeout;
  const cancel = options.cancel || clearTimeout;
  const onSingle = options.onSingle || (() => {});
  const onDouble = options.onDouble || (() => {});

  let pendingTimer = null;
  let lastTapTime = null;

  return {
    tap(payload, time) {
      const now = time !== undefined ? time : Date.now();
      if (pendingTimer !== null && lastTapTime !== null && (now - lastTapTime) <= windowMs) {
        cancel(pendingTimer);
        pendingTimer = null;
        lastTapTime = null;
        onDouble(payload);
        return 'double';
      }
      lastTapTime = now;
      pendingTimer = schedule(() => {
        pendingTimer = null;
        lastTapTime = null;
        onSingle(payload);
      }, windowMs);
      return 'single';
    },
    reset() {
      if (pendingTimer !== null) {
        cancel(pendingTimer);
        pendingTimer = null;
      }
      lastTapTime = null;
    },
  };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test tests/touchGestureLogic.test.mjs`
Expected: PASS — 10 tests, 0 failures.

- [ ] **Step 5: Lint the new files**

Run: `npx eslint chrome/player/ui/TouchGestureLogic.mjs tests/touchGestureLogic.test.mjs`
Expected: no output (exit 0).

- [ ] **Step 6: Commit**

```bash
git add chrome/player/ui/TouchGestureLogic.mjs tests/touchGestureLogic.test.mjs
git commit -m "feat: add pure touch gesture logic helpers"
```

---

### Task 2: Seek feedback CSS

**Files:**
- Modify: `chrome/player/assets/fluidplayer/css/fluidplayer.css` (append at end of file)

**Interfaces:**
- Consumes: nothing.
- Produces: CSS classes `.touch_seek_indicator` (with `.left`, `.right`, `.visible`) and `.touch_seek_ripple` (with `.animate`) that Task 3's controller toggles.

- [ ] **Step 1: Append the styles**

Append this block to the end of `chrome/player/assets/fluidplayer/css/fluidplayer.css`:

```css
.mainplayer .touch_seek_indicator {
    position: absolute;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    color: #fff;
    font-size: 28px;
    font-weight: 700;
    opacity: 0;
    pointer-events: none;
    z-index: 1000;
    transition: opacity 0.2s ease;
    text-shadow: 0 0 4px #000, 0 0 4px #000, 0 0 4px #000;
}

.mainplayer .touch_seek_indicator.left {
    left: 25%;
}

.mainplayer .touch_seek_indicator.right {
    left: 75%;
}

.mainplayer .touch_seek_indicator.visible {
    opacity: 1;
}

.mainplayer .touch_seek_ripple {
    position: absolute;
    width: 40px;
    height: 40px;
    margin: -20px 0 0 -20px;
    border-radius: 50%;
    background: rgba(255, 255, 255, 0.35);
    opacity: 0;
    pointer-events: none;
    z-index: 1000;
}

.mainplayer .touch_seek_ripple.animate {
    animation: touch_seek_ripple 0.4s ease-out;
}

@keyframes touch_seek_ripple {
    from {
        opacity: 0.6;
        transform: scale(0.5);
    }
    to {
        opacity: 0;
        transform: scale(3);
    }
}
```

- [ ] **Step 2: Verify the stylesheet still parses in the build**

Run: `node build.mjs`
Expected: exits 0 and produces bundles under `built/`.

- [ ] **Step 3: Commit**

```bash
git add chrome/player/assets/fluidplayer/css/fluidplayer.css
git commit -m "feat: add touch seek feedback styles"
```

---

### Task 3: TouchFullscreenControls controller

**Files:**
- Create: `chrome/player/ui/TouchFullscreenControls.mjs`

**Interfaces:**
- Consumes (from Task 1): `DRAG_THRESHOLD`, `getTapZone`, `getSeekDirection`, `getSeekAmount`, `isTouchDevice`, `createTapResolver`.
- Consumes (from `InterfaceController`, Task 4): `isFullscreenLike()`, `isControlsVisible()`, `showControlBar()`, `hideControlBar()`, `playPauseToggle()`.
- Consumes: `DOMElements.playerContainer`, `client.options.seekStepSize`, `client.setSeekSave()`, `client.currentTime`.
- Produces: class `TouchFullscreenControls extends EventEmitter` with:
  - `constructor(client, interfaceController)`
  - `setupUI()`
  - `isActive()` → `boolean`
  - `updateActiveState()` → `void`
  - `reset()` → `void`

- [ ] **Step 1: Create the controller**

Create `chrome/player/ui/TouchFullscreenControls.mjs`:

```javascript
import {EventEmitter} from '../modules/eventemitter.mjs';
import {EnvUtils} from '../utils/EnvUtils.mjs';
import {DOMElements} from './DOMElements.mjs';
import {
  DRAG_THRESHOLD,
  createTapResolver,
  getSeekAmount,
  getSeekDirection,
  getTapZone,
  isTouchDevice,
} from './TouchGestureLogic.mjs';

export class TouchFullscreenControls extends EventEmitter {
  constructor(client, interfaceController) {
    super();
    this.client = client;
    this.interfaceController = interfaceController;
    this.touchDevice = false;
    this.active = false;
    this.feedbackTimeout = null;
    this.touchStart = null;
    this.dragging = false;
  }

  setupUI() {
    this.touchDevice = isTouchDevice(
        navigator.maxTouchPoints,
        typeof window.matchMedia === 'function' && window.matchMedia('(pointer: coarse)').matches,
        EnvUtils.isMobile(),
    );

    this.sideIndicator = document.createElement('div');
    this.sideIndicator.className = 'touch_seek_indicator';
    this.ripple = document.createElement('div');
    this.ripple.className = 'touch_seek_ripple';
    DOMElements.playerContainer.appendChild(this.sideIndicator);
    DOMElements.playerContainer.appendChild(this.ripple);

    this.tapResolver = createTapResolver({
      onSingle: (tap) => this.onSingleTap(tap),
      onDouble: (tap) => this.onDoubleTap(tap),
    });

    DOMElements.playerContainer.addEventListener('touchstart', this.onTouchStart.bind(this), {passive: true});
    DOMElements.playerContainer.addEventListener('touchmove', this.onTouchMove.bind(this), {passive: true});
    DOMElements.playerContainer.addEventListener('touchend', this.onTouchEnd.bind(this));
    DOMElements.playerContainer.addEventListener('touchcancel', this.onTouchCancel.bind(this));

    document.addEventListener('fullscreenchange', this.updateActiveState.bind(this));
    document.addEventListener('webkitfullscreenchange', this.updateActiveState.bind(this));

    this.updateActiveState();
  }

  isActive() {
    return this.touchDevice && this.interfaceController.isFullscreenLike();
  }

  updateActiveState() {
    const active = this.isActive();
    if (active === this.active) {
      return;
    }
    this.active = active;
    if (active) {
      DOMElements.playerContainer.classList.add('touch_fullscreen');
      this.interfaceController.hideControlBar();
    } else {
      DOMElements.playerContainer.classList.remove('touch_fullscreen');
      this.reset();
    }
  }

  reset() {
    if (this.tapResolver) {
      this.tapResolver.reset();
    }
    clearTimeout(this.feedbackTimeout);
    this.sideIndicator.classList.remove('visible');
    this.ripple.classList.remove('animate');
    this.touchStart = null;
    this.dragging = false;
  }

  onTouchStart(e) {
    if (!this.isActive() || e.touches.length !== 1) {
      this.touchStart = null;
      this.dragging = true;
      return;
    }
    const touch = e.touches[0];
    this.touchStart = {x: touch.clientX, y: touch.clientY, target: e.target};
    this.dragging = false;
  }

  onTouchMove(e) {
    if (!this.touchStart || this.dragging) {
      return;
    }
    const touch = e.touches[0];
    if (!touch) {
      return;
    }
    const dx = touch.clientX - this.touchStart.x;
    const dy = touch.clientY - this.touchStart.y;
    if (Math.hypot(dx, dy) > DRAG_THRESHOLD) {
      this.dragging = true;
    }
  }

  onTouchCancel() {
    this.touchStart = null;
    this.dragging = false;
  }

  onTouchEnd() {
    if (!this.isActive() || !this.touchStart || this.dragging) {
      this.touchStart = null;
      this.dragging = false;
      return;
    }
    const start = this.touchStart;
    this.touchStart = null;

    if (this.isInteractiveTarget(start.target)) {
      return;
    }

    const rect = DOMElements.playerContainer.getBoundingClientRect();
    if (getTapZone(start.x, start.y, rect) === 'controls') {
      this.interfaceController.showControlBar();
      return;
    }

    this.tapResolver.tap({x: start.x, y: start.y});
  }

  isInteractiveTarget(target) {
    if (DOMElements.playPauseButtonBigCircle.contains(target)) {
      return true;
    }
    if (this.interfaceController.isControlsVisible() && DOMElements.controlsContainer.contains(target)) {
      return true;
    }
    return false;
  }

  onSingleTap(tap) {
    if (this.interfaceController.isBigPlayButtonVisible()) {
      this.interfaceController.playPauseToggle();
      return;
    }
    if (this.interfaceController.isControlsVisible()) {
      this.interfaceController.hideControlBar();
    } else {
      this.interfaceController.playPauseToggle();
    }
  }

  onDoubleTap(tap) {
    const direction = getSeekDirection(tap.x, DOMElements.playerContainer.getBoundingClientRect());
    const amount = getSeekAmount(this.client.options.seekStepSize);
    this.client.setSeekSave(false);
    this.client.currentTime += direction * amount;
    this.client.setSeekSave(true);
    this.showSeekFeedback(direction, amount, tap.x, tap.y);
  }

  showSeekFeedback(direction, amount, x, y) {
    const rect = DOMElements.playerContainer.getBoundingClientRect();
    this.sideIndicator.textContent = direction < 0 ? '« ' + amount + 's' : amount + 's »';
    this.sideIndicator.classList.toggle('left', direction < 0);
    this.sideIndicator.classList.toggle('right', direction > 0);
    this.sideIndicator.classList.add('visible');

    this.ripple.style.left = (x - rect.left) + 'px';
    this.ripple.style.top = (y - rect.top) + 'px';
    this.ripple.classList.remove('animate');
    requestAnimationFrame(() => {
      this.ripple.classList.add('animate');
    });

    clearTimeout(this.feedbackTimeout);
    this.feedbackTimeout = setTimeout(() => {
      this.sideIndicator.classList.remove('visible');
      this.ripple.classList.remove('animate');
    }, 600);
  }
}
```

- [ ] **Step 4: Verify syntax is valid**

Run: `node --check chrome/player/ui/TouchFullscreenControls.mjs`
Expected: exits with code 0 (no output).

- [ ] **Step 5: Lint the new file**

Run: `npx eslint chrome/player/ui/TouchFullscreenControls.mjs`
Expected: no output (exit 0).

- [ ] **Step 7: Commit**

```bash
git add chrome/player/ui/TouchFullscreenControls.mjs
git commit -m "feat: add touch fullscreen controls controller"
```

---

### Task 4: Wire the controller into InterfaceController

**Files:**
- Modify: `chrome/player/ui/InterfaceController.mjs`

**Interfaces:**
- Consumes: `TouchFullscreenControls` from Task 3.
- Produces: `interfaceController.touchFullscreenControls` (instance), `interfaceController.isControlsVisible()` (method); guards so mouse handlers no-op while `touchFullscreenControls.isActive()`.

- [ ] **Step 1: Import the controller**

In `chrome/player/ui/InterfaceController.mjs`, add this import between the `SubtitlesManager` and `ToolManager` imports:

```javascript
import {TouchFullscreenControls} from './TouchFullscreenControls.mjs';
```

- [ ] **Step 2: Construct and set up the controller**

In the constructor, immediately after `this.volumeControls.setupUI();`, add:

```javascript
    this.touchFullscreenControls = new TouchFullscreenControls(this.client, this);
    this.touchFullscreenControls.setupUI();
```

- [ ] **Step 3: Add the isControlsVisible helper**

Immediately after the `isFullscreenLike()` method, add:

```javascript
  isControlsVisible() {
    return this.controlsVisible;
  }
```

- [ ] **Step 4: Guard the video click handler**

In the `DOMElements.videoContainer.addEventListener('click', ...)` handler, add the guard directly after `clearTimeout(holdTimeout);`:

```javascript
      if (this.touchFullscreenControls?.isActive()) {
        return;
      }
```

- [ ] **Step 5: Guard the hold-to-speed-up handler**

In the `DOMElements.videoContainer.addEventListener('mousedown', ...)` handler, add the guard as the first statement:

```javascript
      if (this.touchFullscreenControls?.isActive()) {
        return;
      }
```

- [ ] **Step 6: Guard onControlsMouseLeave**

At the top of `onControlsMouseLeave()`, add:

```javascript
    if (this.touchFullscreenControls?.isActive()) {
      return;
    }
```

- [ ] **Step 7: Guard queueControlsHide**

At the top of `queueControlsHide(time)`, add:

```javascript
    if (this.touchFullscreenControls?.isActive()) {
      return;
    }
```

- [ ] **Step 8: Guard pause() control reveal**

In `pause()`, wrap the `showControlBar()` call:

```javascript
    if (!this.touchFullscreenControls?.isActive()) {
      this.showControlBar();
    }
```

- [ ] **Step 9: Refresh activation on pseudo-fullscreen change**

In `toggleWindowedFullscreen(force)`, add `this.touchFullscreenControls?.updateActiveState();` immediately after the `if (...) { ... } else { ... }` block in BOTH paths (the non-extension path returns right after it; the extension callback path adds it after its `if/else`):

Non-extension path:
```javascript
      if (this.state.windowedFullscreen) {
        this.lockLandscapeOrientation();
        this.hideControlBar();
      } else {
        this.unlockOrientationIfIdle();
      }
      this.touchFullscreenControls?.updateActiveState();
      return;
```

Extension callback path:
```javascript
      if (this.state.windowedFullscreen) {
        this.lockLandscapeOrientation();
        this.hideControlBar();
      } else {
        this.unlockOrientationIfIdle();
      }
      this.touchFullscreenControls?.updateActiveState();
    });
```

- [ ] **Step 10: Verify syntax**

Run: `node --check chrome/player/ui/InterfaceController.mjs`
Expected: exits with code 0 (no output).

- [ ] **Step 11: Lint (only the new lines matter; pre-existing errors allowed)**

Run: `npx eslint chrome/player/ui/InterfaceController.mjs`
Expected: only the pre-existing errors (double quotes and brace-style/curly already present in the file). No new errors referencing `touchFullscreenControls`, `isControlsVisible`, or the `toggleWindowedFullscreen` edits.

- [ ] **Step 12: Commit**

```bash
git add chrome/player/ui/InterfaceController.mjs
git commit -m "feat: wire touch fullscreen controls into the player"
```

---

### Task 5: Build and full verification

**Files:**
- None (verification only).

**Interfaces:**
- N/A.

- [ ] **Step 1: Run the whole test suite**

Run: `node --test`
Expected: PASS — 40 tests, 0 failures (30 pre-existing + 10 new).

- [ ] **Step 2: Build the extension**

Run: `node build.mjs`
Expected: exits 0 and writes bundles under `built/`.

- [ ] **Step 3: Manual verification checklist**

Load the built/unpacked extension (or `chrome/`) on Android Chrome, an iPad, and the pseudo-fullscreen fallback and confirm:
1. Enter fullscreen → controls hidden, landscape locked.
2. Tap the bottom ~15% → controls appear; tapping control-bar buttons works normally.
3. Tap the video while controls are visible → controls hide; playback is unchanged.
4. Tap the video while controls are hidden → play/pause toggles; pausing leaves controls hidden.
5. Double-tap the left half → seeks backward ~10s with a `« 10s` indicator and a ripple.
6. Double-tap the right half → seeks forward ~10s with a `10s »` indicator and a ripple.
7. Drag the progress and volume bars → still work (taps are not mistaken for drags).
8. Exit fullscreen → desktop/windowed behavior is unchanged (auto-hide after ~2s, click actions, hold-to-speed).

- [ ] **Step 4: Confirm no stray changes**

Run: `git status`
Expected: clean working tree (all changes committed).

---

## Self-Review

**Spec coverage:**
- R1 reveal bottom 15% → Task 1 `getTapZone` + Task 3 `onTouchEnd`.
- R2 hide only on outside tap → Task 3 `onSingleTap` + Task 4 `queueControlsHide`/`onControlsMouseLeave` guards.
- R3 single tap (big play / hide / play-pause) → Task 3 `onSingleTap`.
- R4 double tap seek, direction, amount → Task 1 `getSeekDirection`/`getSeekAmount` + Task 3 `onDoubleTap`.
- R5 feedback (indicator + ripple) → Task 2 CSS + Task 3 `showSeekFeedback`.
- R6 bypass click/hold/auto-hide/hover/pause → Task 4 guards.
- R7 non-interference (drag threshold, no preventDefault, ignore interactive targets) → Task 1 `DRAG_THRESHOLD` + Task 3 `onTouchMove`/`isInteractiveTarget`.
- Platform scope (touch + fullscreen-like only) → Task 3 `isActive()`.
- Testing → Task 1 unit tests, Task 5 suite + manual checklist.

**Placeholder scan:** none.

**Type consistency:** `isControlsVisible()`, `hideControlBar()`, `showControlBar()`, `playPauseToggle()`, `isBigPlayButtonVisible()`, `isFullscreenLike()` all exist on `InterfaceController`; `createTapResolver({onSingle, onDouble, schedule, cancel, window})`, `getTapZone(x, y, rect)`, `getSeekDirection(x, rect)`, `getSeekAmount(seekStepSize)`, `isTouchDevice(maxTouchPoints, coarsePointer, isMobile)`, `DRAG_THRESHOLD` are defined in Task 1 and consumed unchanged in Task 3.
