/**
 * VidSrcCCExtractor — self-contained CommonJS JS for remote hot-update.
 * Hosted at: HaileyesusG/MasterStream-Extractors/extractors/VidSrcCCExtractor.js
 *
 * ⚠️ VidSrcCC is dead. This slot is now powered by LordFlix (lordflix.org).
 * It returns results under provider name "VidSrcCC" so the app doesn't need updating.
 *
 * Flow:
 *  1. Build snowhouse.lordflix.club URL for movie/TV
 *  2. GET enc-dec.app/api/enc-lordflix?url=... → { text, sign }
 *  3. POST enc-dec.app/api/dec-lordflix with { text, sign } → sources + subtitles
 *
 * Servers (from https://snowhouse.lordflix.club/servers):
 *   Solstice, Vienna, Lion, Phoenix, Luna  (English)
 *   Rio (Portuguese), Moscow (Russian) — skipped
 *
 * To update server order: edit the `servers` array below and push to GitHub.
 */
(function () {
  var TAG = '[VidSrcCCExtractor]';
  var SNOWHOUSE = 'https://snowhouse.lordflix.club';
  var ENC_DEC = 'https://enc-dec.app/api';
  var USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36';

  var HEADERS = {
    'Accept': '*/*',
    'Origin': 'https://lordflix.org',
    'Referer': 'https://lordflix.org/',
    'User-Agent': USER_AGENT,
  };

  async function fetchGet(url, headers) {
    try {
      var response = await fetch(url, { headers: headers || HEADERS, redirect: 'follow' });
      if (!response.ok) {
        console.warn(TAG + ' \u274c HTTP ' + response.status + ' for ' + url);
        return null;
      }
      return await response.text();
    } catch (e) {
      console.warn(TAG + ' \u274c Network error: ' + e.message);
      return null;
    }
  }

  async function fetchPost(url, body, headers) {
    try {
      var response = await fetch(url, {
        method: 'POST',
        headers: headers,
        body: body,
        redirect: 'follow',
      });
      if (!response.ok) {
        console.warn(TAG + ' \u274c HTTP ' + response.status + ' for POST ' + url);
        return null;
      }
      return await response.text();
    } catch (e) {
      console.warn(TAG + ' \u274c Network error POST: ' + e.message);
      return null;
    }
  }

  // Parse an HLS master playlist and return [{file, quality}] sorted desc
  async function parseM3u8Qualities(playlistUrl, reqHeaders) {
    try {
      var m3u8 = await fetchGet(playlistUrl, reqHeaders);
      if (!m3u8) return [{ file: playlistUrl, quality: 1080 }];

      var lines = m3u8.split('\n');
      var results = [];
      var baseUrl = playlistUrl.substring(0, playlistUrl.lastIndexOf('/') + 1);

      for (var i = 0; i < lines.length; i++) {
        var line = lines[i].trim();
        if (line.indexOf('#EXT-X-STREAM-INF') === 0) {
          // Extract RESOLUTION=WxH
          var resMatch = line.match(/RESOLUTION=(\d+)x(\d+)/);
          var quality = resMatch ? parseInt(resMatch[2], 10) : 1080;
          // Next non-empty line is the URL
          var nextLine = '';
          for (var j = i + 1; j < lines.length; j++) {
            nextLine = lines[j].trim();
            if (nextLine && nextLine.indexOf('#') !== 0) break;
          }
          if (nextLine) {
            var segUrl = (nextLine.indexOf('http') === 0) ? nextLine : baseUrl + nextLine;
            results.push({ file: segUrl, quality: quality });
          }
        }
      }

      if (results.length === 0) return [{ file: playlistUrl, quality: 1080 }];
      results.sort(function (a, b) { return b.quality - a.quality; });
      return results;
    } catch (e) {
      return [{ file: playlistUrl, quality: 1080 }];
    }
  }

  async function extract(tmdbId, imdbId, isTv, season, episode) {
    try {
      // English servers only (Solstice, Vienna, Lion are most reliable)
      var servers = ['Solstice', 'Vienna', 'Lion', 'Phoenix', 'Luna'];

      for (var i = 0; i < servers.length; i++) {
        var server = servers[i];

        // Step 1: Build snowhouse URL
        var snowhouseUrl;
        if (isTv) {
          snowhouseUrl = SNOWHOUSE + '/?type=series' +
            '&imdb=' + (imdbId || '') +
            '&tmdb=' + tmdbId +
            '&server=' + server +
            '&season=' + season +
            '&episode=' + episode;
        } else {
          snowhouseUrl = SNOWHOUSE + '/?type=movie' +
            '&imdb=' + (imdbId || '') +
            '&tmdb=' + tmdbId +
            '&server=' + server;
        }

        console.log(TAG + ' \ud83d\ude80 Trying server: ' + server);

        // Step 2: Encrypt (get text + sign from enc-dec.app)
        var encUrl = ENC_DEC + '/enc-lordflix?url=' + encodeURIComponent(snowhouseUrl);
        var encRaw = await fetchGet(encUrl, {
          'Accept': 'application/json',
          'User-Agent': USER_AGENT,
        });

        if (!encRaw) {
          console.warn(TAG + ' \u26a0\ufe0f [' + server + '] enc-lordflix returned null — trying next server');
          continue;
        }

        var encJson;
        try { encJson = JSON.parse(encRaw); } catch (_) {
          console.warn(TAG + ' \u26a0\ufe0f [' + server + '] Failed to parse enc response — trying next server');
          continue;
        }

        if (encJson.status !== 200) {
          console.warn(TAG + ' \u26a0\ufe0f [' + server + '] enc-lordflix status=' + encJson.status + ' — trying next server');
          continue;
        }

        var encResult = encJson.result;
        if (!encResult || !encResult.url || !encResult.sign) {
          console.warn(TAG + ' \u26a0\ufe0f [' + server + '] Missing url/sign in enc response — trying next server');
          continue;
        }

        // Step 2b: Fetch the encrypted script URL to get the actual encrypted text
        console.log(TAG + ' \ud83d\udce5 [' + server + '] Fetching encrypted script...');
        var encText = await fetchGet(encResult.url, { 'User-Agent': USER_AGENT, 'Referer': 'https://lordflix.org/', 'Origin': 'https://lordflix.org' });
        if (!encText || encText.trim() === '') {
          console.warn(TAG + ' \u26a0\ufe0f [' + server + '] Empty encrypted script — trying next server');
          continue;
        }

        console.log(TAG + ' \ud83d\udd11 [' + server + '] Got encrypted text (len=' + encText.length + ') + sign');

        // Step 3: Decrypt
        var decBody = JSON.stringify({ text: encText, sign: encResult.sign });
        var decHeaders = {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
          'User-Agent': USER_AGENT,
          'Origin': 'https://lordflix.org',
          'Referer': 'https://lordflix.org/',
        };

        var decRaw = await fetchPost(ENC_DEC + '/dec-lordflix', decBody, decHeaders);
        if (!decRaw) {
          console.warn(TAG + ' \u26a0\ufe0f [' + server + '] dec-lordflix failed — trying next server');
          continue;
        }

        var decJson;
        try { decJson = JSON.parse(decRaw); } catch (_) {
          console.warn(TAG + ' \u26a0\ufe0f [' + server + '] Failed to parse dec response — trying next server');
          continue;
        }

        if (decJson.status !== 200) {
          console.warn(TAG + ' \u26a0\ufe0f [' + server + '] dec-lordflix status=' + decJson.status + ': ' + (decJson.error || '') + ' — trying next server');
          continue;
        }

        var result = decJson.result;
        if (!result || result.error) {
          console.warn(TAG + ' \u26a0\ufe0f [' + server + '] Server error: ' + (result && result.error ? result.error : 'no result') + ' — trying next server');
          continue;
        }

        // LordFlix returns: { stream: [{ id, type, playlist?, qualities?, captions? }] }
        var streamArr = result.stream;
        if (!Array.isArray(streamArr) || streamArr.length === 0) {
          console.warn(TAG + ' \u26a0\ufe0f [' + server + '] No stream array in result — trying next server');
          continue;
        }

        var directQuality = [];
        var subtitlesList = [];

        for (var j = 0; j < streamArr.length; j++) {
          var streamItem = streamArr[j];

          if (streamItem.type === 'hls' && streamItem.playlist) {
            // HLS stream — parse m3u8 to extract per-quality URLs
            var hlsQualities = await parseM3u8Qualities(streamItem.playlist, { 'User-Agent': USER_AGENT, 'Referer': 'https://lordflix.org/', 'Origin': 'https://lordflix.org' });
            for (var h = 0; h < hlsQualities.length; h++) {
              directQuality.push(hlsQualities[h]);
            }

          } else if (streamItem.type === 'file' && streamItem.qualities) {
            // File stream — multiple qualities as object: { "480": {url}, "1080": {url} }
            var qualKeys = Object.keys(streamItem.qualities);
            for (var q = 0; q < qualKeys.length; q++) {
              var qKey = qualKeys[q];
              var qObj = streamItem.qualities[qKey];
              var qUrl = qObj && (qObj.url || qObj.file || '');
              var qNum = parseInt(qKey, 10) || 1080;
              if (qUrl) directQuality.push({ file: qUrl, quality: qNum });
            }
          }

          // Parse captions from each stream item
          var caps = streamItem.captions || streamItem.subtitles || [];
          if (Array.isArray(caps)) {
            for (var k = 0; k < caps.length; k++) {
              var cap = caps[k];
              var capUrl = cap.url || cap.file || '';
              var capLang = cap.language || cap.label || cap.lang || 'Unknown';
              if (capUrl) subtitlesList.push({ url: capUrl, lang: capLang, label: capLang });
            }
          }
        }

        if (directQuality.length === 0) {
          console.warn(TAG + ' \u26a0\ufe0f [' + server + '] No valid quality URLs — trying next server');
          continue;
        }

        directQuality.sort(function (a, b) { return b.quality - a.quality; });

        console.log(TAG + ' \u2705 [' + server + '] Found ' + directQuality.length + ' sources + ' + subtitlesList.length + ' subtitles');

        return {
          url: directQuality[0].file,
          quality: directQuality[0].quality + 'p',
          qualities: directQuality.map(function (q) { return { url: q.file, quality: q.quality + 'p' }; }),
          provider: 'VidSrcCC',
          headers: {
            'User-Agent': USER_AGENT,
            'Referer': 'https://lordflix.org/',
            'Origin': 'https://lordflix.org',
          },
          subtitles: subtitlesList,
        };
      }

      console.warn(TAG + ' \u274c All LordFlix servers exhausted');
      return null;
    } catch (e) {
      console.error(TAG + ' \ud83d\udca5 Error during extraction', e);
      return null;
    }
  }

  module.exports = { extract: extract };
})();
