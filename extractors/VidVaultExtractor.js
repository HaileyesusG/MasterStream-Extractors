/**
 * VidVault Remote Extractor (Powered by Vidlink Direct MP4 Engine)
 *
 * Replaces offline VidVault endpoints with Vidlink's fast direct-MP4 engine
 * for reliable video downloading in DownloadOptionsModal.
 * Original VidVault source is backed up in VidVaultExtractor.bak.js.
 *
 * Flow:
 * 1. Obtains token from enc-dec.app API for TMDB ID
 * 2. Fetches multi-quality MP4 video sources from vidlink.pro API
 * 3. Returns clean headers ({}) so CDNs (bcdn.hakunaymatata.com) do not reject with 429
 * 4. Supplies qualities list [1080p, 720p, 480p, 360p] for download modal
 *
 * To hot-update: run Update-Manifest.ps1, commit and push.
 */
(function () {
  'use strict';

  var TAG = '[VidVaultExtractor]';
  var BASE_URL = 'https://vidlink.pro';
  var ENC_API = 'https://enc-dec.app/api/enc-vidlink';
  var USER_AGENT =
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

  async function extract(tmdbId, arg1, arg2, arg3, arg4, arg5, arg6) {
    var isTv, season, episode, title, imdbId, year;

    // Detect calling convention:
    // Mobile 4-param: (tmdbId, isTv, season, episode)
    // Mobile 5-param: (tmdbId, isTv, season, episode, title)
    // Mobile 5-param alt: (tmdbId, imdbId, isTv, season, episode)
    // TV / Full 7-param: (tmdbId, imdbId, title, isTv, season, episode, year)
    if (typeof arg1 === 'boolean') {
      isTv = arg1;
      season = arg2;
      episode = arg3;
      title = arg4;
      imdbId = null;
      year = null;
    } else if (typeof arg2 === 'boolean') {
      imdbId = arg1;
      isTv = arg2;
      season = arg3;
      episode = arg4;
      title = null;
      year = null;
    } else {
      imdbId = arg1;
      title = typeof arg2 === 'string' ? arg2 : null;
      isTv = arg3;
      season = arg4;
      episode = arg5;
      year = arg6;
    }

    try {
      console.log(TAG + ' 🚀 Extracting download sources for TMDB ID: ' + tmdbId + (isTv ? ' (S' + (season || 1) + 'E' + (episode || 1) + ')' : ''));

      // 1. Get encrypted token for TMDB ID
      var encRes = await fetch(ENC_API + '?text=' + tmdbId);
      if (!encRes.ok) {
        console.warn(TAG + ' ❌ Failed to get token from enc-dec.app');
        return null;
      }
      var encJson = await encRes.json();
      var token = encJson.result;

      if (!token) {
        console.warn(TAG + ' ❌ No token returned from enc-dec.app');
        return null;
      }

      console.log(TAG + ' 🔑 Got token (len=' + token.length + ')');

      // 2. Call Vidlink API to get sources
      var apiUrl = isTv
        ? BASE_URL + '/api/b/tv/' + token + '/' + (season || 1) + '/' + (episode || 1)
        : BASE_URL + '/api/b/movie/' + token;

      console.log(TAG + ' 📡 Fetching sources from: ' + apiUrl);

      var apiHeaders = {
        'User-Agent': USER_AGENT,
        'Referer': BASE_URL + '/',
        'Origin': BASE_URL,
        'Accept': 'application/json, text/plain, */*',
      };

      var apiRes = await fetch(apiUrl, { headers: apiHeaders });
      if (!apiRes.ok) {
        console.warn(TAG + ' ❌ Vidlink API returned ' + apiRes.status);
        return null;
      }

      var raw = await apiRes.text();
      console.log(TAG + ' 📦 API response (len=' + raw.length + ')');

      var data;
      try {
        data = JSON.parse(raw);
      } catch (_) {
        console.warn(TAG + ' ❌ Invalid JSON from Vidlink API');
        return null;
      }

      var stream = data && data.stream;

      if (!stream) {
        console.warn(TAG + ' ❌ No stream object in response');
        return null;
      }

      var qualities = stream.qualities;
      if (!qualities || typeof qualities !== 'object') {
        console.warn(TAG + ' ❌ No qualities in stream');
        return null;
      }

      // Sort quality keys numerically descending (1080 > 720 > 480 etc.)
      var qualityKeys = Object.keys(qualities).sort(function (a, b) {
        return parseInt(b, 10) - parseInt(a, 10);
      });

      if (qualityKeys.length === 0) {
        console.warn(TAG + ' ❌ qualities object is empty');
        return null;
      }

      var parsedQualities = [];
      for (var i = 0; i < qualityKeys.length; i++) {
        var q = qualityKeys[i];
        var entry = qualities[q];
        var qUrl = entry && (entry.url || entry.file || '');
        if (qUrl) parsedQualities.push({ url: qUrl, quality: q + 'p' });
      }

      if (parsedQualities.length === 0) {
        console.warn(TAG + ' ❌ No valid URLs in qualities');
        return null;
      }

      var bestUrl = parsedQualities[0].url;
      console.log(TAG + ' ✅ Found ' + parsedQualities.length + ' quality variants for download, best: ' + qualityKeys[0] + 'p');

      // 3. Parse subtitles
      var subtitles = [];
      if (Array.isArray(stream.captions)) {
        for (var k = 0; k < stream.captions.length; k++) {
          var cap = stream.captions[k];
          if (cap.id && cap.label) {
            subtitles.push({ url: cap.id, lang: cap.label, label: cap.label });
          }
        }
      }

      console.log(TAG + ' ✅ Successfully extracted direct MP4 download URLs (' + subtitles.length + ' subs)');

      // Important: Return provider: 'VidVault' so DownloadOptionsModal and DownloadService
      // identify it as VidVault, and empty headers so CDN allows direct download without 429.
      return {
        url: bestUrl,
        quality: parsedQualities[0].quality,
        qualities: parsedQualities,
        provider: 'VidVault',
        headers: {},
        subtitles: subtitles,
      };
    } catch (e) {
      console.error(TAG + ' 💥 Error during download extraction: ' + (e.message || e));
      return null;
    }
  }

  var extractorObj = { extract: extract };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = extractorObj;
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
    gObj.VidVaultExtractor = extractorObj;
  }
})();
