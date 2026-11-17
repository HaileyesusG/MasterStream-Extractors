/**
 * VidlinkSnifferExtractor — remote hot-update stub
 * Domain: https://vidlink.pro
 *
 * ⛔ Disabled remote stub:
 * Vidlink sniffer streams on surge.flooderrr.store return HTTP 403 (blocked)
 * and autoplay loud audio in hidden WebViews before ExoPlayer starts.
 *
 * Returning null immediately prevents NativeModules.StreamSniffer from
 * launching background WebViews.
 */
(function () {
  'use strict';

  var TAG = '[VidlinkSnifferExtractor]';

  async function extract(tmdbId, isTv, season, episode) {
    console.log(TAG + ' ⛔ Remote JS disabled — background WebView sniffing prevented.');
    return null;
  }

  var extractor = { extract: extract };
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = extractor;
  }
  var gObj =
    typeof globalThis !== 'undefined'
      ? globalThis
      : typeof window !== 'undefined'
      ? window
      : typeof global !== 'undefined'
      ? global
      : this;
  if (gObj) {
    gObj.VidlinkSnifferExtractor = extractor;
  }
})();
