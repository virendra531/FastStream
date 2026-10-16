# Black Bar Removal - Design Spec

## Overview

Add automatic detection and removal of black bars (letterboxing/pillarboxing) encoded into video files during playback. Uses canvas-based frame analysis to detect bar boundaries, then applies CSS transforms to zoom the content region to fill the player container. Supports both auto-detection and manual crop override.

## Requirements

- Detect black bars from video frames automatically
- Apply crop during playback only (no re-encoding)
- Detect once at video start (not continuously)
- Support manual crop override with per-edge sliders
- Toggle on/off via player controls and keybind
- Work with existing CSS filter/transform pipeline (zoom, flip, rotate)

## Components

### 1. BlackBarDetector Module

**File:** `chrome/player/modules/analyzer/BlackBarDetector.mjs`

**Detection algorithm:**
1. Create an offscreen canvas (160x90 pixels for speed)
2. Sample 5 frames at 10%, 25%, 50%, 75%, 90% of video duration
3. For each frame, draw to canvas and get pixel data via `getImageData()`
4. Scan from each edge inward (top, bottom, left, right):
   - For top/bottom: compute average brightness per row of pixels
   - For left/right: compute average brightness per column of pixels
   - A row/column is "content" if its average brightness exceeds a threshold (default: 15/255)
5. Record the first content row/column on each edge for each sampled frame
6. Use the **tightest** crop across all sampled frames (most conservative - ensures bars are always removed)
7. Return crop rect as `{top, bottom, left, right}` in 0-1 range (percentage of frame dimensions)

**Manual override:** Accept explicit `{top, bottom, left, right}` values, bypassing detection entirely.

**API:**
```js
class BlackBarDetector {
  detect(video) // returns {top, bottom, left, right} or null
  setManualCrop(crop) // set manual override {top, bottom, left, right}
  clearManualCrop() // switch back to auto-detect
  getCrop() // returns current crop values or null
}
```

### 2. CSS Transform Integration

**Modify:** `CSSFilterUtils.getTransformString(options)` in `chrome/player/utils/CSSFilterUtils.mjs`

When `removeBlackBars` is enabled and a crop is detected:
- Compute scale factors: `scaleX = 1 / (1 - crop.left - crop.right)`, `scaleY = 1 / (1 - crop.top - crop.bottom)`
- Compute translate offsets to center the content region
- Prepend these to the existing transform chain (crop first, then zoom/flip/rotate)

**Modify:** `FastStreamClient.updateCSSFilters()` in `chrome/player/FastStreamClient.mjs`

- After computing filter/transform strings, apply them to the video element as before
- Also apply to `previewPlayer` video element if present

**New options fields** in `DefaultOptions.mjs`:
- `removeBlackBars: false` (boolean)
- `blackBarCrop: null` (object `{top, bottom, left, right}` or null for auto)

### 3. Detection Trigger

**Modify:** `FastStreamClient.mjs`

- When `LOADEDMETADATA` fires and `removeBlackBars` is enabled:
  - If `blackBarCrop` is set (manual), use it directly
  - Otherwise, run `BlackBarDetector.detect(video)` asynchronously
  - Store result in `options.blackBarCrop`
  - Call `updateCSSFilters()` to apply

### 4. UI Controls

**Modify:** `InterfaceController.mjs`

Add a "Remove Black Bars" toggle button in the player tools area (near existing flip/rotate controls).

When toggled ON:
- Enable `options.removeBlackBars`
- If no manual crop set, trigger auto-detection
- Apply CSS transform

When toggled OFF:
- Disable `options.removeBlackBars`
- Clear the black bar transform from video element

**Sub-menu (on long-press or secondary click):**
- "Auto Detect" button - re-runs detection
- Manual sliders for top, bottom, left, right (0-100%)
- "Reset" button to clear manual values

**Keybind:** Add a keybind for toggling black bar removal on/off.

### 5. Persistence

- Store `removeBlackBars` and `blackBarCrop` in session storage (like `disableVisualFilters`)
- Per-session only (not persisted across page loads)

## Files to Create/Modify

| File | Action | Purpose |
|------|--------|---------|
| `chrome/player/modules/analyzer/BlackBarDetector.mjs` | **Create** | Detection module |
| `chrome/player/utils/CSSFilterUtils.mjs` | Modify | Add crop transform computation |
| `chrome/player/FastStreamClient.mjs` | Modify | Detection trigger, option handling |
| `chrome/player/options/defaults/DefaultOptions.mjs` | Modify | Add new options |
| `chrome/player/ui/InterfaceController.mjs` | Modify | Add UI controls |

## Testing

1. Play a letterboxed video (e.g., 16:9 content in 4:3 container) - bars should be auto-detected and removed
2. Play a pillarboxed video (e.g., 4:3 content in 16:9 container) - bars should be removed
3. Toggle black bar removal off - video should return to original framing
4. Use manual crop override - should apply custom crop values
5. Combine with existing zoom/flip/rotate - transforms should compose correctly
6. Play a video with no black bars - detection should return near-zero crop values, minimal visual change
