/**
 * VidukiExtractor — replaces dead VidSrcCC slot.
 * Hosted at: HaileyesusG/MasterStream-Extractors/extractors/VidSrcCCExtractor.js
 *
 * Delegates to the MasterStream backend's native Viduki WASM extractor.
 * The backend handles:
 *   1. Altcha SHA-256 Proof-of-Work
 *   2. Session Bootstrap (nonce)
 *   3. Pepper Key exchange
 *   4. WebAssembly envelope decryption (makima.wasm)
 *   5. Multi-server failover (13 servers: Leon, Ada, Claire, Jill…)
 *
 * To update: edit this file, run Update-Manifest.ps1, commit and push.
 * The app will pick it up within 1 hour (or on next cold start).
 */
(function () {
  var TAG = '[VidukiExtractor]';
  var BACKEND_URL = 'https://backendmasterstream.onrender.com';

  async function extract(tmdbId, imdbId, title, isTv, season, episode, year) {
    try {
      var params = new URLSearchParams({ tmdbId: String(tmdbId), type: isTv ? 'tv' : 'movie' });
      if (imdbId) params.set('imdbId', imdbId);
      if (isTv) {
        params.set('season', String(season || 1));
        params.set('episode', String(episode || 1));
      }

      var url = BACKEND_URL + '/api/cinejoy/viduki?' + params.toString();
      console.log(TAG + ' \uD83D\uDE80 ' + url);

      var response = await fetch(url, { headers: { Accept: 'application/json' } });
      if (!response.ok) {
        console.warn(TAG + ' \u274C HTTP ' + response.status);
        return null;
      }

      var data = await response.json();
      if (!data || !data.ok || !data.url) {
        console.warn(TAG + ' \u274C No stream: ' + JSON.stringify(data));
        return null;
      }

      console.log(TAG + ' \u2705 [' + (data.server || '?') + '] ' + data.url.substring(0, 70) + '...');

      return {
        url: data.url,
        quality: data.quality || '1080p',
        provider: 'Viduki',
        headers: data.headers || {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          Referer: 'https://www.viduki.net/',
          Origin: 'https://www.viduki.net',
        },
        subtitles: data.subtitles || [],
      };
    } catch (err) {
      console.error(TAG + ' \uD83D\uDCA5 ' + (err && err.message ? err.message : String(err)));
      return null;
    }
  }

  module.exports = { extract: extract };
})();
