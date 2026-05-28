/**
 * utils.js — Pure utility functions
 *
 * Rules:
 *   - No DOM access
 *   - No state access
 *   - No side effects
 */

window.App = window.App || {};

App.utils = {

  /**
   * Clamp a number between min and max.
   */
  clamp(value, min, max) {
    return Math.min(Math.max(value, min), max);
  },

  /**
   * Generate a random ID string.
   */
  randomId(length = 8) {
    return Math.random().toString(36).substring(2, 2 + length);
  },

  /**
   * Format seconds as m:ss.mmm (for editor precision).
   */
  formatTimePrecise(seconds) {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return m + ':' + s.toFixed(3).padStart(6, '0');
  },

  /**
   * Format seconds as m:ss (for display).
   */
  formatTimeShort(seconds) {
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return m + ':' + s.toString().padStart(2, '0');
  },

  /**
   * Linear interpolation between two values.
   */
  lerp(a, b, t) {
    return a + (b - a) * t;
  },

  /**
   * Interpolate a bounding box from keyframes at a given time.
   * Returns { x1, y1, x2, y2 } or null if outside keyframe range.
   */
  interpolateBox(keyframes, time) {
    if (!keyframes || !keyframes.length) return null;

    // Outside keyframe range → not visible
    if (time < keyframes[0].time) return null;
    if (time > keyframes[keyframes.length - 1].time) return null;

    // Find surrounding keyframes
    for (let i = 0; i < keyframes.length - 1; i++) {
      const a = keyframes[i];
      const b = keyframes[i + 1];

      if (time >= a.time && time <= b.time) {
        // Hide = "from this keyframe onward, disappear until next non-hidden keyframe"
        if (a.hide) return null;

        // Jump = no interpolation; hold A's box, then snap to B at B's time
        if (b.jump) {
          return time >= b.time
            ? { x1: b.box.x1, y1: b.box.y1, x2: b.box.x2, y2: b.box.y2 }
            : { x1: a.box.x1, y1: a.box.y1, x2: a.box.x2, y2: a.box.y2 };
        }

        // Default: smooth linear interpolation between a and b
        const duration = b.time - a.time;
        const t = duration > 0 ? (time - a.time) / duration : 0;
        return {
          x1: App.utils.lerp(a.box.x1, b.box.x1, t),
          y1: App.utils.lerp(a.box.y1, b.box.y1, t),
          x2: App.utils.lerp(a.box.x2, b.box.x2, t),
          y2: App.utils.lerp(a.box.y2, b.box.y2, t),
        };
      }
    }

    // Exactly at last keyframe
    const last = keyframes[keyframes.length - 1];
    if (last.hide) return null;
    return { x1: last.box.x1, y1: last.box.y1, x2: last.box.x2, y2: last.box.y2 };
  },

  /**
   * Get the rendered video rect within its container.
   * Reads the element's object-fit to handle both contain and cover.
   * For cover, x/y may be negative (video extends beyond container).
   */
  getVideoRect(videoEl, containerEl) {
    const containerRect = containerEl.getBoundingClientRect();
    const videoAspect = videoEl.videoWidth / videoEl.videoHeight || 16 / 9;
    const containerAspect = containerRect.width / containerRect.height;
    // Use cover on portrait screens, contain on landscape
    const fit = containerAspect <= 1 ? 'cover' : 'contain';

    let w, h, x, y;

    if (fit === 'cover') {
      // Cover: fill container, overflow is cropped
      if (containerAspect > videoAspect) {
        w = containerRect.width;
        h = w / videoAspect;
        x = 0;
        y = (containerRect.height - h) / 2;
      } else {
        h = containerRect.height;
        w = h * videoAspect;
        x = (containerRect.width - w) / 2;
        y = 0;
      }
    } else {
      // Contain (default): fit inside, may have black bars
      if (containerAspect > videoAspect) {
        h = containerRect.height;
        w = h * videoAspect;
        x = (containerRect.width - w) / 2;
        y = 0;
      } else {
        w = containerRect.width;
        h = w / videoAspect;
        x = 0;
        y = (containerRect.height - h) / 2;
      }
    }

    return { x, y, width: w, height: h };
  },

  /**
   * Convert a mouse/touch event to video-relative percentages (0–1).
   */
  eventToVideoPercent(e, videoEl, containerEl) {
    const vRect = App.utils.getVideoRect(videoEl, containerEl);
    const cRect = containerEl.getBoundingClientRect();
    const clientX = e.touches ? e.touches[0].clientX : e.clientX;
    const clientY = e.touches ? e.touches[0].clientY : e.clientY;
    const px = (clientX - cRect.left - vRect.x) / vRect.width;
    const py = (clientY - cRect.top - vRect.y) / vRect.height;
    return {
      x: App.utils.clamp(px, 0, 1),
      y: App.utils.clamp(py, 0, 1)
    };
  },

  /**
   * Convert hex color to rgb components.
   */
  hexToRgb(hex) {
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    return { r, g, b };
  }

};
