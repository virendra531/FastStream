# Fullscreen Controls Hover-Only Design

## Overview
Change fullscreen behavior so controls only appear when the mouse is over the control bar. In fullscreen-like states, mouse movement over the bare video area no longer reveals controls. When leaving the control bar, controls hide immediately.

## Scope
Applies to fullscreen-like states: native fullscreen (`state.fullscreen`) and windowed/pseudo fullscreen (`state.windowedFullscreen` or `playerContainer` has `pseudo_fullscreen` class). Windowed (non-fullscreen) behavior is unchanged.

## Requirements
- In fullscreen-like: mousemove on video area does not show controls. Only hovering the control bar shows controls.
- In fullscreen-like: when mouse leaves the control bar, controls hide immediately (no 2s delay).
- Controls remain hoverable in fullscreen-like (do not set `disabled` which uses `display:none`).
- Windowed mode unchanged (show on mousemove over video, hide after ~2s on inactivity).

## Implementation

### InterfaceController (`chrome/player/ui/InterfaceController.mjs`)
1. Add `isFullscreenLike()` helper:
```js
isFullscreenLike() {
  return this.state.fullscreen ||
         this.state.windowedFullscreen ||
         DOMElements.playerContainer?.classList.contains('pseudo_fullscreen');
}
```

2. `onPlayerMouseMove()`: skip showing controls in fullscreen-like.
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

3. `onControlsMouseLeave()`: hide immediately in fullscreen-like.
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

4. `setFullscreenStatus(status)`: in native fullscreen, do not disable controls. Still manage button state and `state.fullscreen`. Remove the `controlsContainer.classList.add('disabled')` / `remove('disabled')` behavior tied to fullscreen state (or only apply disabled for other cases? Looking at current: when entering fullscreen it adds disabled; when exiting removes). Remove that. Keep the rest (button class, state tracking).
```js
setFullscreenStatus(status) {
  const fullScreenButton = DOMElements.fullscreen;
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
  // ... portrait/landscape video classes unchanged
}
```
Note: iOS native fullscreen path also calls setFullscreenStatus; behavior remains consistent.

5. `toggleWindowedFullscreen(force)`: when entering, ensure controls start hidden. Current toggles class; controls will be hidden until mouse enters controls bar.
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
  // extension path unchanged; response sets state
}
```
Extension path sets `this.state.windowedFullscreen = response === 'enter'`; consider hiding controls when entering - but state updates async. Not critical; controls bar hover will show/hide correctly.

## Notes
- CSS `.fluid_controls_container.disabled { display:none; }` remains (used elsewhere?), but we no longer set it on fullscreen. That’s fine.
- Focus behavior preserved (`focusingControls` prevents hiding; focusout still hides appropriately).
