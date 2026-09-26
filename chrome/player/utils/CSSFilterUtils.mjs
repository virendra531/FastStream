import {SVGDaltonizer} from '../modules/SVGDaltonizer.mjs';
import {DaltonizerTypes} from '../options/defaults/DaltonizerTypes.mjs';

const DaltonizerTypeMap = new Map();
DaltonizerTypeMap.set(DaltonizerTypes.NONE, -1);
DaltonizerTypeMap.set(DaltonizerTypes.PROTANOMALY, 0);
DaltonizerTypeMap.set(DaltonizerTypes.DEUTERANOMALY, 1);
DaltonizerTypeMap.set(DaltonizerTypes.TRITANOMALY, 2);

/**
 * Trims floating point noise (0.1 + 0.2 - 0.3 style) out of a CSS value so the
 * generated transform string stays readable.
 * @param {number} value
 * @return {number}
 */
function round(value) {
  return Math.round(value * 1e9) / 1e9;
}

/**
 * Utility functions for generating CSS filter strings for video effects.
 */
export class CSSFilterUtils {
  /**
   * Generates a CSS filter string based on video options.
   * @param {Object} options - Video filter options.
   * @return {string} The CSS filter string.
   */
  static getFilterString(options) {
    const filters = [];
    if (!options.disableVisualFilters) {
      if (options.videoDaltonizerType !== DaltonizerTypes.NONE && options.videoDaltonizerStrength > 0) {
        filters.push(`url(#daltonizer-${options.videoDaltonizerType}-${options.videoDaltonizerStrength})`);
      }

      if (options.videoBrightness !== 1) {
        filters.push(`brightness(${options.videoBrightness})`);
      }

      if (options.videoContrast !== 1) {
        filters.push(`contrast(${options.videoContrast})`);
      }

      if (options.videoSaturation !== 1) {
        filters.push(`saturate(${options.videoSaturation})`);
      }

      if (options.videoGrayscale !== 0) {
        filters.push(`grayscale(${options.videoGrayscale})`);
      }

      if (options.videoSepia !== 0) {
        filters.push(`sepia(${options.videoSepia})`);
      }

      if (options.videoInvert !== 0) {
        filters.push(`invert(${options.videoInvert})`);
      }

      if (options.videoHueRotate !== 0) {
        filters.push(`hue-rotate(${options.videoHueRotate}deg)`);
      }

      if (options.videoGamma !== 1) {
        filters.push(`url(#video-gamma-${options.videoGamma})`);
      }
    }

    return filters.join(' ');
  }

  /**
   * Creates an SVG daltonizer filter for color blindness simulation/correction.
   * @param {string} type - Daltonizer type.
   * @param {number} strength - Filter strength.
   * @return {string} SVG filter string.
   */
  static makeLMSDaltonizerFilter(type, strength) {
    return SVGDaltonizer.makeLMSDaltonizerFilter(DaltonizerTypeMap.get(type), strength, true);
  }

  /**
   * Creates an SVG gamma correction filter.
   * @param {number} gamma - Gamma value (1 = neutral, >1 brightens, <1 darkens).
   * @return {{svg: SVGElement, filter: SVGFilterElement}} The SVG and filter elements.
   */
  static makeGammaFilter(gamma) {
    return SVGDaltonizer.makeGammaFilter(gamma);
  }

  /**
   * Generates a CSS transform string based on video options.
   * @param {Object} options - Video transform options.
   * @return {string} The CSS transform string.
   */
  static getTransformString(options) {
    const transforms = [];

    if (options.removeBlackBars && options.blackBarCrop) {
      const crop = options.blackBarCrop;
      const contentHeight = 1 - crop.top - crop.bottom;
      // Vertical only: side bars are detected but deliberately left alone, so the
      // horizontal axis is never scaled or shifted and no edges get cropped.
      if (contentHeight > 0) {
        const scaleY = 1 / contentHeight;
        // transform-origin is the element centre, so the content rect has to be
        // shifted back onto it: half the overflow, minus the crop's own offset.
        const overflowY = (scaleY - 1) / 2;
        const translateY = (overflowY - crop.top * scaleY) * 100;
        transforms.push(`translate(0%, ${round(translateY)}%) scale(1, ${scaleY})`);
      }
    }

    if (options.videoFlip !== 0) {
      transforms.push(`scaleX(${options.videoFlip % 2 === 0 ? options.videoZoom : -options.videoZoom}) scaleY(${options.videoFlip > 1 ? -options.videoZoom : options.videoZoom})`);
    } else if (options.videoZoom !== 1) {
      transforms.push(`scale(${options.videoZoom})`);
    }

    if (options.videoRotate !== 0) {
      transforms.push(`rotate(${options.videoRotate * 90}deg)`);
    }

    return transforms.join(' ');
  }
}
