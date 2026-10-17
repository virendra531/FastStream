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
      if (pendingTimer !== null) {
        cancel(pendingTimer);
        pendingTimer = null;
        if (lastTapTime !== null && (now - lastTapTime) <= windowMs) {
          lastTapTime = null;
          onDouble(payload);
          return 'double';
        }
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
