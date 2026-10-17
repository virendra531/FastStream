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
    this.revealGuardTimeout = null;
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
    clearTimeout(this.revealGuardTimeout);
    DOMElements.controlsContainer.classList.remove('reveal_guard');
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
      this.armRevealGuard();
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

  armRevealGuard() {
    DOMElements.controlsContainer.classList.add('reveal_guard');
    clearTimeout(this.revealGuardTimeout);
    this.revealGuardTimeout = setTimeout(() => {
      DOMElements.controlsContainer.classList.remove('reveal_guard');
    }, 400);
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
