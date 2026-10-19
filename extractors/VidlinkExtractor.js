/**
 * VidlinkExtractor — self-contained CommonJS JS for remote hot-update.
 * Hosted at: HaileyesusG/MasterStream-Extractors/extractors/VidlinkExtractor.js
 *
 * To update: edit this file, run Update-Manifest.ps1, commit and push.
 * The app will pick it up within 1 hour (no app release needed).
 */
(function () {
  'use strict';

  var TAG = '[VidlinkExtractor2]';
  var BASE_URL = 'https://vidlink.pro';
  var ENC_API = 'https://enc-dec.app/api/enc-vidlink';
  var USER_AGENT =
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

  // ── Media type support — enabled for both movies and TV ──
  var SUPPORTS_MOVIE = true;
  var SUPPORTS_TV = true;

  async function extract(tmdbId, arg1, arg2, arg3, arg4, arg5, arg6) {
    var isTv, season, episode, title, imdbId, year;

    // Detect calling convention:
    // Mobile 4-param: (tmdbId, isTv, season, episode)
    // Mobile 5-param: (tmdbId, imdbId, isTv, season, episode)
    // TV / Full 7-param: (tmdbId, imdbId, title, isTv, season, episode, year)
    if (typeof arg1 === 'boolean') {
      isTv = arg1;
      season = arg2;
      episode = arg3;
      imdbId = null;
      title = null;
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
      if (isTv && !SUPPORTS_TV) {
        console.log(TAG + ' ⏭️ Skipping — TV series not supported');
        return null;
      }
      if (!isTv && !SUPPORTS_MOVIE) {
        console.log(TAG + ' ⏭️ Skipping — Movies not supported');
        return null;
      }
      console.log(TAG + ' 🚀 Extracting via API for TMDB ID: ' + tmdbId + (isTv ? ' (S' + (season || 1) + 'E' + (episode || 1) + ')' : ''));

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
        console.warn(TAG + ' ❌ No stream object in response. Keys: ' + Object.keys(data || {}).join(', '));
        return null;
      }

      // Vidlink API returns stream.qualities = { "480": {type, url}, "720": {type, url}, ... }
      var qualities = stream.qualities;
      if (!qualities || typeof qualities !== 'object') {
        console.warn(TAG + ' ❌ No qualities in stream. Keys: ' + Object.keys(stream).join(', '));
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
      console.log(TAG + ' ✅ Found ' + parsedQualities.length + ' quality variants, best: ' + qualityKeys[0] + 'p');

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

      console.log(TAG + ' ✅ Successfully extracted stream URL (' + subtitles.length + ' subs)');

      // NOTE: Do NOT send Referer or desktop Chrome User-Agent to the video CDN stream.
      // The video CDN (bcdn.hakunaymatata.com) blocks requests with Referer: vidlink.pro/
      // or browser UAs with HTTP 429 Too Many Requests.
      // Leaving stream headers empty allows mobile ExoPlayer / okhttp to play and validate cleanly.
      return {
        url: bestUrl,
        quality: parsedQualities[0].quality,
        qualities: parsedQualities,
        provider: 'Vidlink',
        headers: {},
        subtitles: subtitles,
      };
    } catch (e) {
      console.error(TAG + ' 💥 Error during API extraction: ' + (e.message || e));
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
    gObj.VidlinkExtractor = extractorObj;
  }
})();
