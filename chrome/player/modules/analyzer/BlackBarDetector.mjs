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
    this.lastDetected = null;
  }

  async detectFromFrame(video, time) {
    return new Promise((resolve) => {
      video.currentTime = time;
      const onSeeked = () => {
        video.removeEventListener('seeked', onSeeked);
        resolve();
      };
      video.addEventListener('seeked', onSeeked);
    });
  }

  async detect(video) {
    const duration = video.duration;
    if (!duration || duration <= 0) return null;
    if (video.readyState < 2) return null;

    let maxTop = 0;
    let maxBottom = 0;
    let maxLeft = 0;
    let maxRight = 0;

    for (const position of SAMPLE_POSITIONS) {
      await this.detectFromFrame(video, duration * position);

      const data = this.extractData(video);
      if (!data) continue;

      const top = this.detectTopEdge(data);
      const bottom = this.detectBottomEdge(data);
      const left = this.detectLeftEdge(data);
      const right = this.detectRightEdge(data);

      if (top > maxTop) maxTop = top;
      if (bottom > maxBottom) maxBottom = bottom;
      if (left > maxLeft) maxLeft = left;
      if (right > maxRight) maxRight = right;
    }

    if (maxTop === 0 && maxBottom === 0 && maxLeft === 0 && maxRight === 0) {
      return null;
    }

    if (maxTop > 0.4 || maxBottom > 0.4 || maxLeft > 0.4 || maxRight > 0.4) {
      return null;
    }

    this.lastDetected = {top: maxTop, bottom: maxBottom, left: maxLeft, right: maxRight};
    return this.lastDetected;
  }

  extractData(video) {
    try {
      this.ctx.drawImage(video, 0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
      return this.ctx.getImageData(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
    } catch (e) {
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
