/**
 * VidlinkExtractor — self-contained CommonJS JS for remote hot-update.
 * Hosted at: HaileyesusG/MasterStream-Extractors/extractors/VidlinkExtractor.js
 *
 * To update: edit this file, run Update-Manifest.ps1, commit and push.
 * The app will pick it up within 1 hour (no app release needed).
 */
(function () {
  var TAG = '[VidlinkExtractor2]';
  var BASE_URL = 'https://vidlink.pro';
  var ENC_API = 'https://enc-dec.app/api/enc-vidlink';
  var USER_AGENT =
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

  async function extract(tmdbId, isTv, season, episode) {
    try {
      console.log(TAG + ' 🚀 Extracting via API for TMDB ID: ' + tmdbId);

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

      // 2. Call Vidlink API to get sources
      var apiUrl = isTv
        ? BASE_URL + '/api/b/tv/' + token + '/' + season + '/' + episode
        : BASE_URL + '/api/b/movie/' + token;

      console.log(TAG + ' 📡 Fetching sources from: ' + apiUrl);

      var headers = {
        'User-Agent': USER_AGENT,
        'Referer': BASE_URL + '/',
        'Origin': BASE_URL,
        'Accept': 'application/json, text/plain, */*',
      };

      var apiRes = await fetch(apiUrl, { headers: headers });
      if (!apiRes.ok) {
        console.warn(TAG + ' ❌ Vidlink API returned ' + apiRes.status);
        return null;
      }

      var data = await apiRes.json();
      var stream = data && data.stream;

      if (!stream || !stream.playlist) {
        console.warn(TAG + ' ❌ No playlist found in API response');
        return null;
      }

      // 3. Parse subtitles
      var subtitles = [];
      if (Array.isArray(stream.captions)) {
        stream.captions.forEach(function (cap) {
          if (cap.id && cap.label) {
            subtitles.push({ url: cap.id, lang: cap.label, label: cap.label });
          }
        });
      }

      console.log(TAG + ' ✅ Successfully extracted stream URL');

      return {
        url: stream.playlist,
        quality: 'Auto',
        provider: 'Vidlink',
        headers: {
          'User-Agent': USER_AGENT,
          'Referer': BASE_URL + '/',
          'Origin': BASE_URL,
        },
        subtitles: subtitles,
      };
    } catch (e) {
      console.error(TAG + ' 💥 Error during API extraction: ' + e.message);
      return null;
    }
  }

  module.exports = { extract: extract };
})();
