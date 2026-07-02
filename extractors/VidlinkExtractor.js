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

  async function extract(tmdbId, imdbId, title, isTv, season, episode, year) {
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

      console.log(TAG + ' 🔑 Got token (len=' + token.length + ')');

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

      var raw = await apiRes.text();
      console.log(TAG + ' 📦 API response (len=' + raw.length + ')');

      var data;
      try { data = JSON.parse(raw); } catch (_) {
        console.warn(TAG + ' ❌ Invalid JSON from Vidlink API');
        return null;
      }

      var stream = data && data.stream;

      if (!stream) {
        console.warn(TAG + ' ❌ No stream object in response. Keys: ' + Object.keys(data || {}).join(', '));
        return null;
      }

      // Log stream structure so we can see what fields exist
      console.log(TAG + ' 🔍 Stream keys: ' + Object.keys(stream).join(', '));

      // Try all known field names for the playlist/stream URL
      var playlistUrl = stream.playlist || stream.url || stream.file || stream.m3u8 || stream.hls || '';

      // Some Vidlink responses use stream.sources = [{file, label}]
      if (!playlistUrl && Array.isArray(stream.sources) && stream.sources.length > 0) {
        playlistUrl = stream.sources[0].file || stream.sources[0].url || '';
        console.log(TAG + ' 📋 Using stream.sources[0]: ' + playlistUrl.substring(0, 60));
      }

      if (!playlistUrl) {
        console.warn(TAG + ' ❌ No playlist URL found. Stream: ' + JSON.stringify(stream).substring(0, 200));
        return null;
      }

      // 3. Parse subtitles
      var subtitles = [];
      if (Array.isArray(stream.captions)) {
        for (var i = 0; i < stream.captions.length; i++) {
          var cap = stream.captions[i];
          if (cap.id && cap.label) {
            subtitles.push({ url: cap.id, lang: cap.label, label: cap.label });
          }
        }
      }

      console.log(TAG + ' ✅ Successfully extracted stream URL (' + subtitles.length + ' subs)');

      return {
        url: playlistUrl,
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
