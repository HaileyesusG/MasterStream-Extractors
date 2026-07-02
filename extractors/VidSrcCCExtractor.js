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
        if (!result) {
          console.warn(TAG + ' \u26a0\ufe0f [' + server + '] No result in dec response — trying next server');
          continue;
        }

        // DEBUG: log the result keys + first 400 chars to identify structure
        console.log(TAG + ' \ud83d\udd0d [' + server + '] dec result keys: ' + Object.keys(result).join(', '));
        console.log(TAG + ' \ud83d\udd0d [' + server + '] dec result preview: ' + JSON.stringify(result).substring(0, 400));

        // Parse sources
        var sources = result.sources || result.streams || result.data || result.videos || result.files || [];
        if (!Array.isArray(sources) || sources.length === 0) {
          console.warn(TAG + ' \u26a0\ufe0f [' + server + '] No sources in result — trying next server');
          continue;
        }

        var directQuality = [];
        for (var j = 0; j < sources.length; j++) {
          var src = sources[j];
          var srcUrl = src.url || src.file || src.stream || '';
          var qualityStr = src.quality || src.label || '1080';
          var qualityMatch = qualityStr.toString().match(/(\d+)/);
          var quality = qualityMatch ? parseInt(qualityMatch[1], 10) : 1080;
          if (srcUrl) directQuality.push({ file: srcUrl, quality: quality });
        }

        if (directQuality.length === 0) {
          console.warn(TAG + ' \u26a0\ufe0f [' + server + '] No valid source URLs — trying next server');
          continue;
        }

        directQuality.sort(function (a, b) { return b.quality - a.quality; });

        // Parse subtitles
        var subtitlesList = [];
        var subs = result.subtitles || result.captions || [];
        if (Array.isArray(subs)) {
          for (var k = 0; k < subs.length; k++) {
            var sub = subs[k];
            var subUrl = sub.url || sub.file || '';
            var lang = sub.language || sub.label || sub.lang || 'Unknown';
            if (subUrl) subtitlesList.push({ url: subUrl, lang: lang, label: lang });
          }
        }

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
