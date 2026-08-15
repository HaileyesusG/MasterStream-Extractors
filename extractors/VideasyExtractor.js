/**
 * LordFlixExtractor — self-contained CommonJS JS for remote hot-update.
 * Hosted at: HaileyesusG/MasterStream-Extractors/extractors/LordFlixExtractor.js
 *
 * ⛔ DISABLED — vixsrc.to streams contain non-standard HLS tags (e.g. LANGUAGE="ita-forced")
 * and encrypted segment keys that cause ExoPlayer / Media3 to throw Source Error (Code 3003).
 * Returning null allows reliable fast providers (CineJoy, VidFast, VidVault) to win the race.
 */
(function () {
  var TAG = '[VideasyExtractor]';

  async function extract(tmdbId, imdbId, title, isTv, season, episode, year) {
    console.log(TAG + ' \u26D4 Temporarily disabled — returning null to allow CineJoy/VidFast to win');
    return null;
  }

  module.exports = { extract: extract };
})();
