import {DefaultPlayerEvents} from '../../enums/DefaultPlayerEvents.mjs';

const CANVAS_WIDTH = 160;
const CANVAS_HEIGHT = 90;
const BRIGHTNESS_THRESHOLD = 15;
const SAMPLE_POSITIONS = [0.1, 0.25, 0.5, 0.75, 0.9];
const META_LOAD_TIMEOUT = 15000;

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
    this._activePlayer = null;
  }

  async detect(client) {
    const player = client?.player;
    const source = player?.getSource();
    if (!client?.playerLoader || !source) {
      return null;
    }

    const id = ++this._activeDetectionId;
    this.destroyActivePlayer();

    let analyzerPlayer = null;
    try {
      analyzerPlayer = await this.loadAnalyzerPlayer(client, source);
      if (id !== this._activeDetectionId) {
        return null;
      }

      const video = analyzerPlayer.getVideo();
      if (!video || !Number.isFinite(video.duration) || video.duration <= 0) {
        return null;
      }
      if (video.videoWidth === 0 || video.videoHeight === 0) {
        return null;
      }

      const duration = video.duration;
      let maxTop = 0;
      let maxBottom = 0;
      let maxLeft = 0;
      let maxRight = 0;

      for (const position of SAMPLE_POSITIONS) {
        if (id !== this._activeDetectionId) {
          return null;
        }

        await this.detectFromFrame(video, duration * position);

        const data = this.extractData(video);
        if (!data) {
          continue;
        }

        maxTop = Math.max(maxTop, this.detectTopEdge(data));
        maxBottom = Math.max(maxBottom, this.detectBottomEdge(data));
        maxLeft = Math.max(maxLeft, this.detectLeftEdge(data));
        maxRight = Math.max(maxRight, this.detectRightEdge(data));
      }

      if (id !== this._activeDetectionId) {
        return null;
      }

      if (maxTop === 0 && maxBottom === 0 && maxLeft === 0 && maxRight === 0) {
        return null;
      }

      if (maxTop > 0.4 || maxBottom > 0.4 || maxLeft > 0.4 || maxRight > 0.4) {
        return null;
      }

      this.lastDetected = {top: maxTop, bottom: maxBottom, left: maxLeft, right: maxRight};
      return this.lastDetected;
    } finally {
      if (this._activePlayer === analyzerPlayer) {
        this._activePlayer = null;
      }
      analyzerPlayer?.destroy?.();
    }
  }

  async loadAnalyzerPlayer(client, source) {
    const player = await client.playerLoader.createPlayer(source.mode, client, {
      isAnalyzer: true,
    });
    this._activePlayer = player;

    await player.setup();

    player.volume = 0;
    player.muted = true;

    player.on(DefaultPlayerEvents.MANIFEST_PARSED, () => {
      player.setCurrentVideoLevelID?.(client.getCurrentVideoLevelID?.());
      player.setCurrentAudioLevelID?.(client.getCurrentAudioLevelID?.());
    });

    const meta = this.waitForMetadata(player);
    client.attachProcessorsToPlayer?.(player);

    await player.setSource(source);
    await meta;

    player.pause?.();

    return player;
  }

  waitForMetadata(player) {
    return new Promise((resolve) => {
      let settled = false;
      const finish = () => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(timer);
        player.off?.(DefaultPlayerEvents.LOADEDMETADATA, onMeta);
        player.off?.(DefaultPlayerEvents.ERROR, onFail);
        player.off?.(DefaultPlayerEvents.DESTROYED, onFail);
        resolve();
      };
      const onMeta = () => finish();
      const onFail = () => finish();
      const timer = setTimeout(finish, META_LOAD_TIMEOUT);
      player.on?.(DefaultPlayerEvents.LOADEDMETADATA, onMeta);
      player.on?.(DefaultPlayerEvents.ERROR, onFail);
      player.on?.(DefaultPlayerEvents.DESTROYED, onFail);
    });
  }

  destroyActivePlayer() {
    if (this._activePlayer) {
      this._activePlayer.destroy?.();
      this._activePlayer = null;
    }
  }

  cancel() {
    this._activeDetectionId++;
    this.destroyActivePlayer();
  }

  async detectFromFrame(video, time) {
    if (video.currentTime === time) {
      return;
    }
    video.currentTime = time;
    await new Promise((resolve) => {
      const onSeeked = () => {
        video.removeEventListener('seeked', onSeeked);
        resolve();
      };
      video.addEventListener('seeked', onSeeked);
    });
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
