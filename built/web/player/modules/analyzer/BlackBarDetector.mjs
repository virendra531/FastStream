const CANVAS_WIDTH = 160;
const CANVAS_HEIGHT = 90;
const BRIGHTNESS_THRESHOLD = 15;
const MAX_CROP_RATIO = 0.4;
const SAMPLE_INTERVAL = 150;
const SAMPLE_WINDOW = 1200;
const MIN_SAMPLES = 3;
const LOG_PREFIX = '[blackBarDetector]';
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
export class BlackBarDetector {
  constructor() {
    this.canvas = document.createElement('canvas');
    this.canvas.width = CANVAS_WIDTH;
    this.canvas.height = CANVAS_HEIGHT;
    this.ctx = this.canvas.getContext('2d', {
      willReadFrequently: true,
    });
    this.manualCrop = null;
    this.lastDetected = null;
    this._activeDetectionId = 0;
  }
  /**
   * Reads black bars off the live video element. Baked-in bars appear in every
   * frame, so no seek is needed: reading the frame the player is already
   * showing avoids both visible seeking and a second player contending for the
   * same fragments.
   */
  async detect(client) {
    const id = ++this._activeDetectionId;
    if (this.manualCrop) {
      return {...this.manualCrop};
    }
    const video = client?.player?.getVideo?.();
    if (!video || !video.videoWidth || !video.videoHeight) {
      console.log(`${LOG_PREFIX} live video has no frame size yet`, {
        videoWidth: video?.videoWidth,
        videoHeight: video?.videoHeight,
        readyState: video?.readyState,
      });
      return null;
    }
    const crops = [];
    const deadline = Date.now() + SAMPLE_WINDOW;
    while (Date.now() < deadline) {
      if (id !== this._activeDetectionId) {
        return null;
      }
      // HAVE_CURRENT_DATA: a frame exists at the current position to read.
      if (video.readyState >= 2) {
        const data = this.extractData(video);
        if (data) {
          crops.push(this.measureCrop(data));
        }
      }
      // Keep sampling past the first hit so a single misread frame cannot win:
      // the aggregate is a median, and one outlier cannot move it.
      if (crops.length >= MIN_SAMPLES && crops.some((c) => this.isPlausibleCrop(c))) {
        break;
      }
      await delay(SAMPLE_INTERVAL);
      if (id !== this._activeDetectionId) {
        return null;
      }
    }
    if (crops.length === 0) {
      console.log(`${LOG_PREFIX} no frame could be sampled from the live video`);
      return null;
    }
    const aggregated = this.aggregateCrops(crops);
    console.log(`${LOG_PREFIX} aggregated crop`, aggregated);
    if (!this.hasAnyBar(aggregated)) {
      console.log(`${LOG_PREFIX} no black bars found`);
      return null;
    }
    if (!this.isPlausibleCrop(aggregated)) {
      console.log(`${LOG_PREFIX} crop too large, ignoring`);
      return null;
    }
    this.lastDetected = aggregated;
    return this.lastDetected;
  }
  measureCrop(data) {
    return {
      top: this.detectTopEdge(data),
      bottom: this.detectBottomEdge(data),
      left: this.detectLeftEdge(data),
      right: this.detectRightEdge(data),
    };
  }
  isPlausibleCrop(crop) {
    return crop.top <= MAX_CROP_RATIO && crop.bottom <= MAX_CROP_RATIO &&
      crop.left <= MAX_CROP_RATIO && crop.right <= MAX_CROP_RATIO;
  }
  hasAnyBar(crop) {
    return crop.top > 0 || crop.bottom > 0 || crop.left > 0 || crop.right > 0;
  }
  cancel() {
    this._activeDetectionId++;
  }
  extractData(video) {
    try {
      this.ctx.drawImage(video, 0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
      return this.ctx.getImageData(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
    } catch (e) {
      console.warn(`${LOG_PREFIX} could not read pixels from the live video`, e);
      return null;
    }
  }
  isRowContent(data, y) {
    const width = data.width;
    const offset = y * width * 4;
    let totalBrightness = 0;
    for (let x = 0; x < width; x++) {
      const idx = offset + x * 4;
      totalBrightness += (data.data[idx] + data.data[idx + 1] + data.data[idx + 2]) / 3;
    }
    return (totalBrightness / width) > BRIGHTNESS_THRESHOLD;
  }
  isColumnContent(data, x) {
    const width = data.width;
    const height = data.height;
    let totalBrightness = 0;
    for (let y = 0; y < height; y++) {
      const idx = (y * width + x) * 4;
      totalBrightness += (data.data[idx] + data.data[idx + 1] + data.data[idx + 2]) / 3;
    }
    return (totalBrightness / height) > BRIGHTNESS_THRESHOLD;
  }
  detectTopEdge(data) {
    const height = data.height;
    for (let y = 0; y < height; y++) {
      if (this.isRowContent(data, y)) {
        return y / height;
      }
    }
    return 1;
  }
  detectBottomEdge(data) {
    const height = data.height;
    for (let y = height - 1; y >= 0; y--) {
      if (this.isRowContent(data, y)) {
        return (height - 1 - y) / height;
      }
    }
    return 1;
  }
  detectLeftEdge(data) {
    const width = data.width;
    for (let x = 0; x < width; x++) {
      if (this.isColumnContent(data, x)) {
        return x / width;
      }
    }
    return 1;
  }
  detectRightEdge(data) {
    const width = data.width;
    for (let x = width - 1; x >= 0; x--) {
      if (this.isColumnContent(data, x)) {
        return (width - 1 - x) / width;
      }
    }
    return 1;
  }
  aggregateCrops(crops) {
    if (crops.length === 0) {
      return {top: 0, bottom: 0, left: 0, right: 0};
    }
    const getMedian = (values) => {
      const sorted = [...values].sort((a, b) => a - b);
      const mid = Math.floor(sorted.length / 2);
      if (sorted.length % 2 === 0) {
        return (sorted[mid - 1] + sorted[mid]) / 2;
      }
      return sorted[mid];
    };
    const top = getMedian(crops.map((c) => c.top));
    const bottom = getMedian(crops.map((c) => c.bottom));
    const left = getMedian(crops.map((c) => c.left));
    const right = getMedian(crops.map((c) => c.right));
    return {top, bottom, left, right};
  }
  setManualCrop(crop) {
    this.manualCrop = {...crop};
  }
  clearManualCrop() {
    this.manualCrop = null;
  }
  getCrop() {
    const crop = this.manualCrop || this.lastDetected || null;
    return crop ? {...crop} : null;
  }
}
