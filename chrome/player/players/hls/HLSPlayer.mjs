import {DefaultPlayerEvents} from '../../enums/DefaultPlayerEvents.mjs';
import {DownloadStatus} from '../../enums/DownloadStatus.mjs';
import {ReferenceTypes} from '../../enums/ReferenceTypes.mjs';
import {AudioLevel, VideoLevel} from '../Levels.mjs';
import {EmitterRelay, EventEmitter} from '../../modules/eventemitter.mjs';
import {Hls} from '../../modules/hls.mjs';
import {Utils} from '../../utils/Utils.mjs';
import {VideoUtils} from '../../utils/VideoUtils.mjs';
import {HLSFragment} from './HLSFragment.mjs';
import {HLSFragmentRequester} from './HLSFragmentRequester.mjs';
import {HLSLoaderFactory} from './HLSLoader.mjs';


export default class HLSPlayer extends EventEmitter {
  constructor(client, config) {
    super();
    this.client = client;
    this.isPreview = config?.isPreview || false;
    this.isAudioOnly = config?.isAudioOnly || false;
    this.defaultQuality = client.options.defaultQuality || 'Auto';
    this.source = null;
    this.activeRequests = [];
    this.fragmentRequester = new HLSFragmentRequester(this);
    this.video = document.createElement(this.isAudioOnly ? 'audio' : 'video');
    if (!Hls.isSupported()) {
      throw new Error('HLS Not supported');
    }

    const workerLocation = 'modules/hls.worker.js';
    const split = import.meta.url.split('/');
    const basePath = split.slice(0, split.length - 3).join('/');
    const workerPath = `${basePath}/${workerLocation}`;

    /**
     * @type {Hls}
     */
    this.hls = new Hls({
      autoStartLoad: false,
      startPosition: -1,
      debug: false,
      capLevelOnFPSDrop: false,
      capLevelToPlayerSize: true,
      defaultAudioCodec: undefined,
      initialLiveManifestSize: 1,
      maxBufferLength: 10,
      maxMaxBufferLength: 10,
      backBufferLength: 10,
      maxBufferSize: 10 * 1000 * 1000,
      maxBufferHole: 0.5,
      highBufferWatchdogPeriod: 2,
      nudgeOffset: 0.1,
      nudgeMaxRetry: 3,
      maxFragLookUpTolerance: 0.25,
      liveSyncDurationCount: 3,
      liveMaxLatencyDurationCount: Infinity,
      liveDurationInfinity: false,
      enableWorker: true,
      workerPath: workerPath,
      enableSoftwareAES: true,
      startFragPrefetch: false,
      testBandwidth: false,
      progressive: false,
      lowLatencyMode: false,
      fpsDroppedMonitoringPeriod: 5000,
      fpsDroppedMonitoringThreshold: 0.2,
      appendErrorMaxRetry: 3,
      // eslint-disable-next-line new-cap
      loader: HLSLoaderFactory(this),
      fragLoadPolicy: {
        default: {
          // Some CDNs and same-origin relays serve media with a slow first
          // byte (5-10s TTFB that sometimes spikes). The default 10s
          // first-byte budget sat right at that edge and repeatedly aborted
          // healthy fragments before they started; keep it tolerant so a slow
          // start does not surface as a spurious "fragment failure". The total
          // load budget is generous because large (e.g. 4K) fragments on a slow
          // or constrained connection can take a while to transfer in full.
          maxTimeToFirstByteMs: 30000,
          maxLoadTimeMs: 240000,
          timeoutRetry: {
            maxNumRetry: 4,
            retryDelayMs: 0,
            maxRetryDelayMs: 0,
          },
          errorRetry: {
            maxNumRetry: 3,
            retryDelayMs: 500,
            maxRetryDelayMs: 2000,
          },
        },
      },
      enableDateRangeMetadataCues: true,
      enableEmsgMetadataCues: true,
      enableID3MetadataCues: true,
      enableWebVTT: true,
      enableIMSC1: true,
      enableCEA708Captions: true,
      stretchShortVideoTrack: false,
      maxAudioFramesDrift: 1,
      forceKeyFrameOnDiscontinuity: true,
      abrEwmaFastLive: 3.0,
      abrEwmaSlowLive: 9.0,
      abrEwmaFastVoD: 3.0,
      abrEwmaSlowVoD: 9.0,
      abrEwmaDefaultEstimate: 5000000,
      abrBandWidthFactor: 0.95,
      abrBandWidthUpFactor: 0.7,
      abrMaxWithRealBitrate: false,
      maxStarvationDelay: 4,
      maxLoadingDelay: 4,
      minAutoBitrate: 0,
      emeEnabled: false,
      licenseXhrSetup: undefined,
      drmSystems: {},
      drmSystemOptions: {},
      // requestMediaKeySystemAccessFunc: requestMediaKeySystemAccess,
      cmcd: undefined,
    });
  }

  canSave() {
    const frags = this.client.getFragments(this.getCurrentVideoLevelID());
    if (!frags) {
      return {
        canSave: false,
        isComplete: false,
      };
    }
    let incomplete = false;
    for (let i = 0; i < frags.length; i++) {
      if (frags[i] && frags[i].status !== DownloadStatus.DOWNLOAD_COMPLETE) {
        incomplete = true;
        break;
      }
    }

    return {
      canSave: true,
      isComplete: !incomplete,
    };
  }

  async saveVideo(options) {
    const fragments = this.client.getFragments(this.getCurrentVideoLevelID()) || [];
    const audioFragments = this.client.getFragments(this.getCurrentAudioLevelID()) || [];

    let zippedFragments = Utils.zipTimedFragments([fragments, audioFragments]);

    if (options.partialSave) {
      zippedFragments = zippedFragments.filter((data) => {
        return data.fragment.status === DownloadStatus.DOWNLOAD_COMPLETE;
      });
    }

    zippedFragments.forEach((data) => {
      data.fragment.addReference(ReferenceTypes.SAVER);
      data.getEntry = async () => {
        if (data.fragment.status !== DownloadStatus.DOWNLOAD_COMPLETE) {
          while (true) {
            try {
              await this.downloadFragment(data.fragment, -1);
              break;
            } catch (e) {
              if (e.message !== 'Aborted download') {
                throw e;
              }
            }
          }
        }
        data.fragment.removeReference(ReferenceTypes.SAVER);
        return this.client.downloadManager.getEntry(data.fragment.getContext());
      };
    });

    const level = this.hls.levels[this.getIndexes(this.getCurrentVideoLevelID()).levelID];
    const audioLevel = this.hls.audioTracks[this.hls.audioTrack];

    let levelInitData = null;
    let audioLevelInitData = null;

    if (fragments[-1]) {
      levelInitData = new Uint8Array(await this.client.downloadManager.getEntry(fragments[-1].getContext()).getDataFromBlob());
    }

    if (audioFragments[-1]) {
      audioLevelInitData = new Uint8Array(await this.client.downloadManager.getEntry(audioFragments[-1].getContext()).getDataFromBlob());
    }

    try {
      if (levelInitData && audioLevelInitData) {
        const {MP4Merger} = await import('../../modules/dash2mp4/mp4merger.mjs');

        const mp4merger = new MP4Merger(options.registerCancel);

        mp4merger.on('progress', (progress) => {
          if (options?.onProgress) {
            options.onProgress(progress);
          }
        });

        const blob = await mp4merger.convert(level.details.totalduration, levelInitData.buffer, audioLevel.details.totalduration, audioLevelInitData.buffer, zippedFragments);

        return {
          extension: 'mp4',
          blob: blob,
        };
      } else {
        if (levelInitData || audioLevelInitData) {
          console.warn('Unexpected init data');
        }
        const {HLS2MP4} = await import('../../modules/hls2mp4/hls2mp4.mjs');
        const hls2mp4 = new HLS2MP4(options.registerCancel);

        hls2mp4.on('progress', (progress) => {
          if (options?.onProgress) {
            options.onProgress(progress);
          }
        });
        const blob = await hls2mp4.convert(level, levelInitData, audioLevel, audioLevelInitData, zippedFragments);

        return {
          extension: 'mp4',
          blob: blob,
        };
      }
    } catch (e) {
      zippedFragments.forEach((data) => {
        data.fragment.removeReference(ReferenceTypes.SAVER);
      });
      throw e;
    }
  }

  load() {
    if (!this.hls.levels || !this.hls.levels.length) {
      // A manifest that parsed to zero usable variants (dead CDN edge, WAF
      // challenge HTML served as an m3u8, fully-incompatible codecs, ...) makes
      // hls.js die in set-level ("level is undefined") synchronously inside
      // startLoad while inside the MANIFEST_PARSED XHR callback — an uncaught
      // TypeError that leaves the player silently dead. Surface it so the host
      // page can flag the source as broken.
      this.emit(DefaultPlayerEvents.ERROR, 'hls load failed: no playable variants');
      return;
    }
    try {
      this.hls.startLoad();
    } catch (e) {
      // hls.js can throw synchronously inside startLoad (e.g. the 'set level'
      // crash on a manifest with no usable variants). That is a JS exception,
      // not an hls ERROR event — surface it so failedToLoad fires instead of
      // leaving the player silently dead.
      this.emit(DefaultPlayerEvents.ERROR, e?.message || 'hls start failed');
    }
  }

  getClient() {
    return this.client;
  }


  async setup() {
    this.hls.attachMedia(this.video);

    await new Promise((resolve, reject) => {
      this.hls.on(Hls.Events.MEDIA_ATTACHED, function() {
        resolve();
      });
    });

    const preEvents = new EventEmitter();
    const emitterRelay = new EmitterRelay([preEvents, this]);
    VideoUtils.addPassthroughEventListenersToVideo(this.video, emitterRelay);


    this.hls.on(Hls.Events.MANIFEST_PARSED, (event, data) => {
      this.emit(DefaultPlayerEvents.MANIFEST_PARSED);

      const levels = this.getVideoLevels();
      const chosenLevel = this.client.getLevelManager().pickVideoLevel(Array.from(levels.values()));
      if (chosenLevel) {
        this.setCurrentVideoLevelID(chosenLevel.id);
      }

      const audioLevels = this.getAudioLevels();
      const chosenAudioLevel = this.client.getLevelManager().pickAudioLevel(Array.from(audioLevels.values()));
      if (chosenAudioLevel) {
        this.setCurrentAudioLevelID(chosenAudioLevel.id);
      }

      this.hls.subtitleDisplay = false;
      this.hls.subtitleTrack = -1;
      if (levels && levels.size === 0) {
        // The same zero-variant manifest guard as load(), evaluated from the
        // levels the MANIFEST_PARSED handler already enumerated.
        this.emit(DefaultPlayerEvents.ERROR, 'hls load failed: no playable variants');
        return;
      }
      this.load();
    });

    this.hls.on(Hls.Events.LEVEL_UPDATED, (a, data) => {
      this.trackUpdated(data.details, 0);
    });


    this.hls.on(Hls.Events.AUDIO_TRACK_UPDATED, (a, data) => {
      this.trackUpdated(data.details, 1);
    });
    // Relay hls.js errors (dead manifest, unreachable segments, undemuxable
    // content, etc.) so failedToLoad fires — without this, dead HLS sources
    // fail silently into a black screen.
    this.hls.on(Hls.Events.ERROR, (event, data) => {
      if (data?.fatal) {
        this.emit(DefaultPlayerEvents.ERROR, data?.details || 'hls load failed');
        return;
      }
      // Demux/parse failures ("Found no media in fragment", codec mismatch)
      // mean the source's bytes can't be turned into video at all — usually a
      // CDN served non-media content. These must not be forgiven just because
      // the video element has a nonzero currentTime (a black / stuck frame),
      // or an otherwise-dead source would keep the player on a black screen
      // forever without ever signalling the embedding page.
      const details = data?.details || '';
      const demuxFailure = /FRAG_PARSING_ERROR|BUFFER_APPEND_ERROR|BUFFER_INCOMPATIBLE_CODECS_ERROR|MANIFEST_INCOMPATIBLE_CODECS_ERROR/.test(details);
      if (!demuxFailure && this.video && this.video.currentTime > 0) {
        this.consecutiveLoadErrors = 0;
        return;
      }
      this.consecutiveLoadErrors = (this.consecutiveLoadErrors || 0) + 1;
      if (this.consecutiveLoadErrors >= 3) {
        this.consecutiveLoadErrors = 0;
        this.emit(DefaultPlayerEvents.ERROR, data?.details || 'hls load failed');
      }
    });
    this.hls.on(Hls.Events.FRAG_BUFFERED, () => {
      this.consecutiveLoadErrors = 0;
      this.clearLoadWatchdog();
    });
  }

  trackUpdated(levelDetails, trackID) {
    levelDetails.trackID = trackID;
    let time = 0;
    levelDetails.fragments.forEach((fragment, i) => {
      const identifier = this.getIdentifier(levelDetails.trackID, fragment.level);
      if (fragment.initSegment && i === 0) {
        fragment.initSegment.trackID = levelDetails.trackID;
        if (!this.client.getFragment(identifier, -1)) {
          this.client.makeFragment(identifier, -1, new HLSFragment(fragment.initSegment, 0, 0));
        }
      }
      if (fragment.encrypted) {
        if (fragment.decryptdata && fragment.levelkeys) {
          fragment.fs_oldcryptdata = fragment.decryptdata;
          fragment.fs_oldlevelKeys = fragment.levelkeys;
        } else {
          this.emit(DefaultPlayerEvents.NEED_KEY);
          // console.log(fragment);
          // console.error('SAMPLE-AES not supported!');
          // throw new Error('SAMPLE-AES not supported!');
        }

        fragment.levelkeys = null;
        fragment._decryptdata = null;

        void fragment.decryptdata;
      }
      const start = time;
      time += fragment.duration;
      const end = time;
      fragment.levelIdentifier = identifier;
      fragment.trackID = levelDetails.trackID;
      if (!this.client.getFragment(identifier, fragment.sn)) {
        this.client.makeFragment(identifier, fragment.sn, new HLSFragment(fragment, start, end));
      }
    });
  }
  getVideo() {
    return this.video;
  }

  getIdentifier(trackID, levelID) {
    return `${trackID}:${levelID}`;
  }

  getIndexes(identifier) {
    const parts = identifier.split(':');
    return {
      trackID: parseInt(parts[0]),
      levelID: parseInt(parts[1]),
    };
  }

  async setSource(source) {
    this.source = source;
    this.consecutiveLoadErrors = 0;
    this.startLoadWatchdog();
    this.hls.loadSource(source.url);
  }
  // Fail sources that never produce any media data (silent stalls the hls.js
  // error event never reports): if nothing buffers within 60s, give up. The
  // budget is generous because large (e.g. 4K) fragments on a slow or
  // constrained connection can take 20-30s+ for the FIRST fragment alone; a 20s
  // deadline wire-failed healthy sources before their first media byte arrived
  // while smaller fragments squeaked under it. Once any data buffers the
  // single-shot timer becomes a no-op.
  startLoadWatchdog() {
    this.clearLoadWatchdog();
    this.loadWatchdog = setTimeout(() => {
      const video = this.video;
      const hasData = video && (video.readyState >= 2 || video.buffered.length > 0);
      if (!hasData) {
        this.emit(DefaultPlayerEvents.ERROR, 'source_load_timeout');
      }
    }, 60000);
  }
  clearLoadWatchdog() {
    if (this.loadWatchdog) {
      clearTimeout(this.loadWatchdog);
      this.loadWatchdog = null;
    }
  }

  getSource() {
    return this.source;
  }

  downloadFragment(fragment, priority) {
    return new Promise((resolve, reject) => {
      this.fragmentRequester.requestFragment(fragment, {
        skipProcess: true,
        onProgress: (e) => {

        },
        onSuccess: (e) => {
          resolve();
        },
        onFail: (e) => {
          reject(new Error('Failed to download fragment'));
        },
        onAbort: (e) => {
          reject(new Error('Aborted download'));
        },
      }, null, priority);
    });
  }

  get buffered() {
    return this.video.buffered;
  }

  async play() {
    return this.video.play();
  }

  async pause() {
    return this.video.pause();
  }

  destroy() {
    // Stop the load watchdog before tearing down hls.js.
    this.clearLoadWatchdog();
    this.fragmentRequester.destroy();
    this.hls.destroy();

    VideoUtils.destroyVideo(this.video);
    this.video = null;

    this.emit(DefaultPlayerEvents.DESTROYED);
  }

  set currentTime(value) {
    if (this.isPreview && this.activeRequests.length > 0 && !VideoUtils.isBuffered(this.video.buffered, value)) {
      this.activeRequests.forEach((loader) => {
        loader.abort();
      });
      this.activeRequests.length = 0;
    }

    this.video.currentTime = value;
  }

  get currentTime() {
    return this.video.currentTime;
  }

  get readyState() {
    return this.video.readyState;
  }

  get paused() {
    return this.video.paused;
  }

  getVideoLevels() {
    const result = new Map();
    this.hls.levels.forEach((level, index) => {
      const identifier = this.getIdentifier(0, index);
      result.set(identifier, new VideoLevel({
        id: identifier,
        width: level.width,
        height: level.height,
        bitrate: level.bitrate,
        mimeType: null,
        language: null,
        videoCodec: level.videoCodec || null,
        audioCodec: level.audioCodec || null,
      }));
    });
    return result;
  }

  getAudioLevels() {
    const result = new Map();
    this.hls.audioTracks.forEach((track, index) => {
      const identifier = this.getIdentifier(1, index);
      result.set(identifier, new AudioLevel({
        id: identifier,
        bitrate: track.bitrate,
        mimeType: null,
        language: track.lang,
        audioCodec: track.audioCodec ? `audio/mp4; codecs="${track.audioCodec}"` : null,
      }));
    });
    return result;
  }

  getCurrentVideoLevelID() {
    let level = this.hls.currentLevel === -1 ? this.hls.loadLevel : this.hls.currentLevel;
    if (level === -1) {
      level = null;
    }
    return this.getIdentifier(0, level);
  }

  setCurrentVideoLevelID(value) {
    if (value === null) return;
    this.hls.currentLevel = this.getIndexes(value).levelID;
  }

  get duration() {
    return this.video.duration;
  }

  get currentFragment() {
    if (!this.hls.streamController.currentFrag) return null;
    return this.client.getFragment(this.getIdentifier(0, this.hls.streamController.currentFrag.level), this.hls.streamController.currentFrag.sn);
  }

  getCurrentAudioLevelID() {
    return this.hls.audioTrack === -1 ? null : this.getIdentifier(1, this.hls.audioTrack);
  }

  setCurrentAudioLevelID(value) {
    if (value === null) return;
    this.hls.audioTrack = this.getIndexes(value).levelID;
  }

  get currentAudioFragment() {
    const frags = this.client.getFragments(this.getCurrentAudioLevelID());
    if (!frags) return null;

    const time = this.currentTime;
    return frags.find((frag) => {
      if (!frag) return false;
      return time >= frag.start && time < frag.end;
    });
  }

  get volume() {
    return this.video.volume;
  }

  set volume(value) {
    this.video.volume = value;
    if (value === 0) this.video.muted = true;
    else this.video.muted = false;
  }

  get playbackRate() {
    return this.video.playbackRate;
  }

  set playbackRate(value) {
    this.video.playbackRate = value;
  }
}
