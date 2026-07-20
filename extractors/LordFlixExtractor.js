/**
 * VideasyExtractor — self-contained CommonJS JS for remote hot-update.
 * Hosted at: HaileyesusG/MasterStream-Extractors/extractors/VideasyExtractor.js
 *
 * To update: edit this file, run Update-Manifest.ps1, commit and push.
 * The app will pick it up within 1 hour (or on next cold start).
 *
 * ⛔ TEMPORARILY DISABLED — Videasy is intentionally returning null
 * so VidFast wins the race. Re-enable by restoring the full extract() logic.
 * To re-enable: restore the servers loop below.
 */
(function () {
  var TAG = '[LordFlixExtractor]';

  async function extract(tmdbId, imdbId, title, isTv, season, episode, year) {
    console.log(TAG + ' \u26d4 Temporarily disabled — skipping to let VidFast win');
    return null;
  }

  module.exports = { extract: extract };
})();
