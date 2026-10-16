# Fullscreen Controls Hover-Only Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make controls appear only when mouse is over the control bar in fullscreen-like states; hide immediately on leaving controls.

**Architecture:** Minimal logic changes in `InterfaceController.mjs` to detect fullscreen-like state, adjust mouse handlers, and avoid disabling controls in fullscreen.

**Tech Stack:** Vanilla JS (ES modules), no new deps.

## Global Constraints
- Preserve existing behavior in windowed (non-fullscreen) mode.
- Do not change unrelated functionality.
- Follow existing code style in the file.
- No new dependencies.

---

### Task 1: Add isFullscreenLike helper and adjust mouse handlers in InterfaceController

**Files:**
- Modify: `chrome/player/ui/InterfaceController.mjs`

**Interfaces:**
- Consumes: `this.state.fullscreen`, `this.state.windowedFullscreen`, `DOMElements.playerContainer`
- Produces: `isFullscreenLike()` method (instance method)

- [ ] **Step 1: Add isFullscreenLike method**

In `chrome/player/ui/InterfaceController.mjs`, add the method. Place it near other state helper methods (e.g. after `isBigPlayButtonVisible()` or near similar helpers). Add:

```js
isFullscreenLike() {
  return this.state.fullscreen ||
         this.state.windowedFullscreen ||
         DOMElements.playerContainer?.classList.contains('pseudo_fullscreen');
}
```

- [ ] **Step 2: Modify onPlayerMouseMove**

Replace `onPlayerMouseMove()` method (around line 1005-1011) with:

```js
onPlayerMouseMove() {
  if (Date.now() < this.mouseActivityCooldown) {
    return;
  }
  if (this.isFullscreenLike()) {
    return;
  }
  this.showControlBar();
  this.queueControlsHide();
}
```

- [ ] **Step 3: Modify onControlsMouseLeave**

Replace `onControlsMouseLeave()` method (around line 1000-1004) with:

```js
onControlsMouseLeave() {
  this.mouseOverControls = false;
  if (document.activeElement && DOMElements.controlsContainer.contains(document.activeElement)) {
    document.activeElement.blur();
  }
  if (this.isFullscreenLike()) {
    this.hideControlBar();
  } else {
    this.queueControlsHide();
  }
}
```

- [ ] **Step 4: Verify syntax is valid**

Run: `node --check chrome/player/ui/InterfaceController.mjs`
Expected: exits with code 0 (no output)

- [ ] **Step 5: Commit**

```bash
git add chrome/player/ui/InterfaceController.mjs
git commit -m "feat: add fullscreen-like detection and adjust mouse handlers"
```

### Task 2: Stop disabling controls in fullscreen and handle pseudo-fullscreen entry

**Files:**
- Modify: `chrome/player/ui/InterfaceController.mjs`

**Interfaces:**
- Consumes: fullscreen state changes
- Produces: behavior change (controls remain hoverable in fullscreen)

- [ ] **Step 1: Modify setFullscreenStatus**

Replace `setFullscreenStatus(status)` (around line 1186-1205) to not add/remove `disabled` class. Keep button state and state tracking:

```js
setFullscreenStatus(status) {
  const fullScreenButton = DOMElements.fullscreen;
  const video = DOMElements.videoContainer?.querySelector('video');
  if (status) {
    fullScreenButton.classList.add('out');
    this.state.fullscreen = true;
  } else {
    fullScreenButton.classList.remove('out');
    if (this.state.fullscreen) {
      this.state.fullscreen = false;
      this.fullscreenToggle(false);
    }
  }

  if (video && video.videoHeight > video.videoWidth) {
    video.classList.add("portrait");
    video.classList.remove("landscape");
  } else if (video && video.videoHeight < video.videoWidth) {
    video.classList.add("landscape");
    video.classList.remove("portrait");
  } else if (video) {
    video.classList.remove("portrait");
    video.classList.remove("landscape");
  }
}
```

(Keep the portrait/landscape logic exactly as it was; only remove the disabled class manipulation.)

- [ ] **Step 2: Ensure controls hidden when entering pseudo-fullscreen**

In `toggleWindowedFullscreen(force)`, when entering (non-extension path), hide controls so they only appear on controls-bar hover:

```js
toggleWindowedFullscreen(force) {
  if (!EnvUtils.isExtension()) {
    const newValue = force === undefined ? !this.state.windowedFullscreen : force;
    DOMElements.playerContainer.classList.toggle('pseudo_fullscreen', newValue);
    this.state.windowedFullscreen = newValue;
    if (this.state.windowedFullscreen) {
      this.hideControlBar();
    }
    return;
  }
  chrome.runtime.sendMessage({
    type: MessageTypes.REQUEST_WINDOWED_FULLSCREEN,
    force,
  }, (response) => {
    this.state.windowedFullscreen = response === 'enter';
    if (this.state.windowedFullscreen) {
      this.hideControlBar();
    }
  });
}
```

- [ ] **Step 3: Verify syntax is valid**

Run: `node --check chrome/player/ui/InterfaceController.mjs`
Expected: exits with code 0 (no output)

- [ ] **Step 4: Commit**

```bash
git add chrome/player/ui/InterfaceController.mjs
git commit -m "fix: don't disable controls in fullscreen; hide on pseudo-fullscreen entry"
```

### Task 3: Manual verification

**Files:**
- None (verification only)

**Interfaces:**
- N/A

- [ ] **Step 1: Load in browser context (build first)**

Run build if needed:
```bash
node build.mjs
```
Or just ensure files are correct. The extension loads from `chrome/` directly in dev; built outputs go to `built/`.

- [ ] **Step 2: Test cases**

Verify:
1. Normal windowed: mousemove over video shows controls, hides after ~2s.
2. Enter native fullscreen: move mouse over video area - controls must NOT appear. Move mouse over controls bar - controls appear. Move mouse off controls bar - controls hide immediately.
3. Exit fullscreen: returns to normal behavior (step 1).
4. Toggle windowedFullscreen (pseudo-fullscreen): same as native fullscreen - only show on controls hover, hide immediately on leave.
5. Tab focus on controls still works (focusin keeps visible, focusout hides appropriately).


### Task 4: Quick smoke test with existing tests

**Files:**
- Run existing tests

**Interfaces:**
- N/A

- [ ] **Step 1: Run tests**

```bash
node --test tests/fillScreenStyle.test.mjs tests/cssFilterUtils.test.mjs tests/blackBarDetector.test.mjs tests/fsBlob.test.mjs
```

Expected: all existing tests still pass.

