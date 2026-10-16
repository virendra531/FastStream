# Mobile Fullscreen Tap Controls Design

## Overview
On touch devices while the player is in fullscreen, replace the desktop mouse-driven control-bar behavior with tap-based controls:

- Tapping the bottom control-bar area reveals the controls.
- Controls hide only when the user taps the video area (outside the control bar) — there is no auto-hide timer.
- Tapping the video (outside the control bar) toggles play/pause when controls are hidden, and hides the controls when they are visible.
- Double-tapping the video seeks: right half forward, left half backward. A side indicator and a tap-point ripple provide feedback.

This builds on the already-implemented fullscreen behavior: filling the screen, locking landscape orientation on entry (best-effort), and rotating only when the device allows it.

## Scope
- **Applies only when both are true:**
  - The device is a touch/coarse-pointer device.
  - The player is fullscreen-like (`interfaceController.isFullscreenLike()`), covering native fullscreen, iOS native fullscreen, and `.pseudo_fullscreen`.
- **Platform caveat:** On iPhone Safari there is no Fullscreen API, so fullscreen hands off to Apple's native video player; our HTML controls (and therefore this tap system) are not rendered there. The behaviors apply wherever our own controls are shown in fullscreen: Android Chrome, iPad, and the CSS pseudo-fullscreen fallback. On iPhone native fullscreen, Apple's built-in gestures apply instead.
- **Unchanged:** Desktop, and touch devices in windowed (non-fullscreen) playback. The existing configurable single/double/triple click actions, hold-to-speed-up, and windowed auto-hide remain exactly as today.

## Requirements

### R1 — Reveal controls
Tapping the bottom 15% of the player height reveals the controls (`showControlBar()`). This region never triggers play/pause and never seeks.

### R2 — Hide only on outside tap
While touch-fullscreen is active, controls have no auto-hide timer. They hide only when the user taps the video area (outside the control bar) while the controls are visible.

### R3 — Single tap on video
A single tap on the video area:
- If the big play button is visible → play (and hide the button).
- Else if controls are visible → hide the controls; do **not** toggle play/pause.
- Else → toggle play/pause. When this pauses, the controls stay hidden.

### R4 — Double tap seeks
A double tap on the video area seeks by `seekStepSize * 5` (default 10s): left half backward, right half forward. Seeking works regardless of control-bar visibility and does not change control-bar visibility. Rapid repeated double taps each seek the same amount (no accumulation counter).

### R5 — Seek feedback
Each double-tap seek shows two `pointer-events: none` cues:
- A side indicator: chevrons + `10s` (actual amount) on the side that was tapped (left = `« 10s`, right = `10s »`), animated in/out.
- A ripple expanding from the touch coordinates.
Both auto-remove after ~600ms. Text is white with the same black-outline treatment used for the control icons.

### R6 — Existing handlers bypassed while active
While touch-fullscreen is active:
- The `videoContainer` click handler (`singleClickAction` / `doubleClickAction` / `tripleClickAction`) is bypassed.
- The hold-to-speed-up `mousedown` handler is bypassed.
- `queueControlsHide()` does nothing.
- `onControlsMouseLeave()` does nothing.
- `pause()` does not call `showControlBar()`.

### R7 — Non-interference
Progress-bar and volume drags, control-bar button clicks, and scroll behavior are unchanged. The tap handler only reacts to clean taps, determined by coordinate and target checks; it never calls `preventDefault`.

## Architecture

### New component: `TouchFullscreenControls` (`chrome/player/ui/TouchFullscreenControls.mjs`)
A controller extending `EventEmitter`, constructed in `InterfaceController` alongside `ProgressBar` / `VolumeControls`, following the existing `setupUI()` convention.

Responsibilities:
- Own the touch listeners, tap-vs-drag detection, single/double-tap disambiguation, and the bottom-15% reveal zone.
- Own the seek feedback DOM (side indicator + ripple) and its timers.
- Track activation state and toggle a `touch_fullscreen` class on `playerContainer`.

It depends on a small set of callbacks/handles provided by `InterfaceController`:
- `isFullscreenLike()`
- `showControlBar()` / `hideControlBar()` / `isControlsVisible()`
- `playPauseToggle()` / `isBigPlayButtonVisible()`
- `seekBy(seconds)`
- touch-capability check

The pure decision logic is factored into exported helper functions so it can be unit tested without a DOM:
- `getTapZone(x, y, rect)` → `'controls'` (bottom 15%) or `'video'`
- `getSeekDirection(x, rect)` → `-1` (left half) or `+1` (right half)
- `getSeekAmount(seekStepSize)` → `seekStepSize * 5`
- a tap-resolver state machine (single vs double disambiguation with an injectable clock)
- `isTouchDevice()` given `maxTouchPoints` / `matchMedia`

## Data Flow

1. Touch device enters fullscreen-like state → controller activates, adds `touch_fullscreen`, ensures controls start hidden.
2. `touchstart` records start `(x, y)`, timestamp, target. Multi-touch aborts.
3. `touchmove` beyond ~10px, or a touch starting on the progress/volume bar, marks a drag → abort.
4. `touchend` without drag classifies the tap:
   - Target inside the big play circle, or a control-bar control while visible → ignored (native handling).
   - Bottom 15% → reveal controls.
   - Video area → single/double-tap resolution.
5. Single tap → big-play / hide-controls / play-pause per R3.
6. Double tap → seek by direction and amount; show feedback per R5.
7. Exiting fullscreen (or losing touch capability) → controller deactivates: clears pending tap/feedback timers, removes the `touch_fullscreen` class, resets feedback elements.

## Error Handling & Edge Cases
- **Orientation/fullscreen:** no interaction with the existing orientation lock helpers.
- **Deactivation cleanup:** pending 300ms single-tap timer and feedback timers cleared; feedback elements hidden.
- **Repeated activation:** listeners wired once; state toggled via the `touch_fullscreen` class and an internal flag.
- **iPad / Android / pseudo-fullscreen:** supported. **iPhone native fullscreen:** unsupported by nature (native player), documented above.
- **Windowed/desktop:** all gates scoped to `isActive()`, so behavior is unchanged.

## Testing

### Unit tests (new `tests/touchFullscreenControls.test.mjs`, run with `node --test`)
- `getTapZone`: bottom 15% → `'controls'`; above → `'video'`; boundary handling.
- `getSeekDirection`: left half → `-1`; right half → `+1`; center/boundary.
- `getSeekAmount`: returns `seekStepSize * 5`.
- Tap resolver: single tap resolves after the timeout; a second tap within the window resolves as a double and cancels the pending single action (injectable clock).
- `isTouchDevice()`: true for `maxTouchPoints > 0` + coarse pointer; false otherwise.

### Manual verification checklist
Documented for Android Chrome, iPad, and the pseudo-fullscreen fallback:
- Enter fullscreen → controls hidden, landscape locked.
- Tap bottom 15% → controls appear; control-bar buttons work.
- Tap video with controls visible → controls hide, no play/pause.
- Tap video with controls hidden → play/pause; pausing leaves controls hidden.
- Double-tap left/right → −10s / +10s with side indicator + ripple.
- Progress/volume drags still work; windowed/desktop unchanged.

### Regression
- Existing 30 tests continue to pass.
- `npx eslint` introduces no new errors in the changed files.

## Affected Files (expected)
- `chrome/player/ui/TouchFullscreenControls.mjs` (new)
- `chrome/player/ui/InterfaceController.mjs` (wire controller; gate click/hold/auto-hide/pause behavior; expose handles)
- `chrome/player/assets/fluidplayer/css/fluidplayer.css` (feedback indicator + ripple styles)
- `tests/touchFullscreenControls.test.mjs` (new)
