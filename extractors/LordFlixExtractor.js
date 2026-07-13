(function () {
  'use strict';

  /**
   * LordFlixExtractor.js — powered by Peachify (peachify.top)
   *
   * Replaces broken LordFlix/VixSrc approach with the simpler Peachify flow
   * (no PoW challenge required).
   *
   * Flow (from smy778/EncDecEndpoints/samples/peachify.py):
   *   1. Pick server from hardcoded list: { label, path, api }
   *   2. GET {server.api}/{server.path}/movie/{tmdbId}
   *      or  {server.api}/{server.path}/tv/{tmdbId}/{season}/{episode}
   *      → JSON response with { data: "<encrypted_text>" }
   *   3. POST enc-dec.app/api/dec-peachify with { text: enc_data }
   *      → { status: 200, result: { stream: [...], ... } }
   *   4. Parse streams + subtitles and return best quality
   *
   * Remotely updatable from GitHub — no APK release needed.
   */

  var TAG = '[LordFlix/Peachify]';
  var ENC_DEC = 'https://enc-dec.app/api';
  var USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36';
  var ORIGIN = 'https://peachify.top';

  var BASE_HEADERS = {
    'User-Agent': USER_AGENT,
    'Origin': ORIGIN,
    'Referer': ORIGIN + '/',
    'Accept': '*/*',
  };

  // Static server list from peachify.py
  var SERVERS = [
    { label: 'Wolf',   path: 'air',      api: 'https://usa.eat-peach.sbs' },
    { label: 'Spider', path: 'holly',    api: 'https://usa.eat-peach.sbs' },
    { label: 'Iron',   path: 'moviebox', api: 'https://uwu.eat-peach.sbs' },
    { label: 'Multi',  path: 'multi',    api: 'https://usa.eat-peach.sbs' },
    { label: 'Dark',   path: 'net',      api: 'https://uwu.eat-peach.sbs' },
  ];

  // ── HTTP helpers ──────────────────────────────────────────────────────────

  async function fetchGet(url, headers) {
    try {
      var res = await fetch(url, { headers: headers || BASE_HEADERS, redirect: 'follow' });
      if (!res.ok) {
        console.warn(TAG + ' ❌ HTTP ' + res.status + ' for ' + url);
        return null;
      }
      return await res.text();
    } catch (e) {
      console.warn(TAG + ' ❌ Network error: ' + e.message);
      return null;
    }
  }

  async function fetchPost(url, body, headers) {
    try {
      var res = await fetch(url, { method: 'POST', headers: headers, body: body, redirect: 'follow' });
      if (!res.ok) {
        console.warn(TAG + ' ❌ HTTP ' + res.status + ' for POST ' + url);
        return null;
      }
      return await res.text();
    } catch (e) {
      console.warn(TAG + ' ❌ Network error POST: ' + e.message);
      return null;
    }
  }

  // ── HLS master playlist parser ────────────────────────────────────────────

  async function parseHlsMaster(masterUrl, fetchHeaders) {
    try {
      var body = await fetchGet(masterUrl, fetchHeaders);
      if (!body || !body.includes('#EXT-X-STREAM-INF')) {
        return [{ file: masterUrl, quality: 1080 }];
      }
      var variants = [];
      var lines = body.split('\n');
      for (var i = 0; i < lines.length; i++) {
        var line = lines[i].trim();
        if (line.indexOf('#EXT-X-STREAM-INF') === 0) {
          var resMatch = line.match(/RESOLUTION=(\d+)x(\d+)/);
          var bwMatch  = line.match(/BANDWIDTH=(\d+)/);
          var height   = resMatch ? parseInt(resMatch[2], 10) : null;
          var nextLine = (lines[i + 1] || '').trim();
          if (!nextLine || nextLine.charAt(0) === '#') continue;
          var varUrl = nextLine;
          if (varUrl.indexOf('http') !== 0) {
            if (varUrl.charAt(0) === '/') {
              var originMatch = masterUrl.match(/^(https?:\/\/[^\/]+)/);
              varUrl = originMatch ? originMatch[1] + varUrl : masterUrl;
            } else {
              var base = masterUrl.substring(0, masterUrl.lastIndexOf('/') + 1);
              varUrl = base + varUrl;
            }
          }
          var quality = height || (bwMatch ? Math.round(parseInt(bwMatch[1], 10) / 150000) * 100 : 1080);
          variants.push({ file: varUrl, quality: quality });
        }
      }
      return variants.length > 0 ? variants : [{ file: masterUrl, quality: 1080 }];
    } catch (_) {
      return [{ file: masterUrl, quality: 1080 }];
    }
  }

  // ── Main ──────────────────────────────────────────────────────────────────

  async function extract(tmdbId, arg1, arg2, arg3, arg4, arg5) {
    // Dual calling-convention:
    //   Mobile: extract(tmdbId, isTv, season, episode)
    //   TV app: extract(tmdbId, imdbId, title, isTv, season, episode, year)
    var isTv, season, episode;
    if (typeof arg1 === 'boolean') {
      isTv = arg1; season = arg2; episode = arg3;
    } else {
      isTv = arg3; season = arg4; episode = arg5;
    }

    try {
      var mediaType = isTv ? 'tv' : 'movie';

      for (var i = 0; i < SERVERS.length; i++) {
        var server = SERVERS[i];

        // Step 1: Build URL
        var url = isTv
          ? server.api + '/' + server.path + '/tv/' + tmdbId + '/' + (season || 1) + '/' + (episode || 1)
          : server.api + '/' + server.path + '/movie/' + tmdbId;

        console.log(TAG + ' 🚀 [' + server.label + '] GET ' + url);

        // Step 2: Fetch encrypted data
        var encRaw = await fetchGet(url, BASE_HEADERS);
        if (!encRaw) { console.warn(TAG + ' ⚠️ [' + server.label + '] No response'); continue; }

        var encJson;
        try { encJson = JSON.parse(encRaw); } catch (_) {
          console.warn(TAG + ' ⚠️ [' + server.label + '] Response not JSON');
          continue;
        }

        var encData = encJson && (encJson.data || encJson.encrypted || encJson.text);
        if (!encData || encData.trim() === '') {
          console.warn(TAG + ' ⚠️ [' + server.label + '] No encrypted data in response');
          continue;
        }
        console.log(TAG + ' 🔑 [' + server.label + '] Got encrypted data (len=' + encData.length + ')');

        // Step 3: Decrypt via enc-dec.app
        var decUrl = ENC_DEC + '/dec-peachify';
        var decHeaders = {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
          'User-Agent': USER_AGENT,
          'Origin': ORIGIN,
          'Referer': ORIGIN + '/',
        };
        var decRaw = await fetchPost(decUrl, JSON.stringify({ text: encData }), decHeaders);
        if (!decRaw) { console.warn(TAG + ' ⚠️ [' + server.label + '] dec-peachify failed'); continue; }

        var decJson;
        try { decJson = JSON.parse(decRaw); } catch (_) { continue; }
        if (decJson.status !== 200) {
          console.warn(TAG + ' ⚠️ [' + server.label + '] dec status=' + decJson.status + ' err=' + (decJson.error || ''));
          continue;
        }

        var result = decJson.result;
        if (!result || result.error) {
          console.warn(TAG + ' ⚠️ [' + server.label + '] ' + (result && result.error || 'no result'));
          continue;
        }

        // Step 4: Parse streams
        var streamArr = result.stream || result.sources || result.streams || [];
        if (!Array.isArray(streamArr) || streamArr.length === 0) {
          console.warn(TAG + ' ⚠️ [' + server.label + '] No stream array');
          continue;
        }

        var directQuality = [];
        var subtitlesList = [];

        for (var j = 0; j < streamArr.length; j++) {
          var item = streamArr[j];

          if (item.type === 'hls' && item.playlist) {
            var hlsHeaders = {
              'User-Agent': USER_AGENT,
              'Referer': ORIGIN + '/',
              'Origin': ORIGIN,
            };
            var hlsVariants = await parseHlsMaster(item.playlist, hlsHeaders);
            var maxQ = hlsVariants.reduce(function(m, v) { return v.quality > m ? v.quality : m; }, 0) || 1080;
            console.log(TAG + ' 📺 [' + server.label + '] HLS variants: ' + hlsVariants.length);
            directQuality.push({ file: item.playlist, quality: maxQ, hlsVariants: hlsVariants });

          } else if (item.type === 'file' && item.qualities) {
            var qualKeys = Object.keys(item.qualities);
            for (var q = 0; q < qualKeys.length; q++) {
              var qKey = qualKeys[q];
              var qObj = item.qualities[qKey];
              var qUrl = qObj && (qObj.url || qObj.file || '');
              var qNum = parseInt(qKey, 10) || 1080;
              if (qUrl) directQuality.push({ file: qUrl, quality: qNum });
            }
          }

          // Subtitles / captions
          var caps = item.captions || item.subtitles || item.tracks || [];
          if (Array.isArray(caps)) {
            for (var k = 0; k < caps.length; k++) {
              var cap = caps[k];
              var capUrl  = cap.url || cap.file || '';
              var capLang = cap.language || cap.label || cap.lang || 'Unknown';
              if (capUrl) subtitlesList.push({ url: capUrl, lang: capLang, label: capLang });
            }
          }
        }

        if (directQuality.length === 0) {
          console.warn(TAG + ' ⚠️ [' + server.label + '] No quality URLs');
          continue;
        }

        directQuality.sort(function(a, b) { return b.quality - a.quality; });
        var primary = directQuality[0];

        var qualitiesForPicker;
        if (primary.hlsVariants && primary.hlsVariants.length > 1) {
          qualitiesForPicker = primary.hlsVariants
            .sort(function(a, b) { return b.quality - a.quality; })
            .map(function(v) { return { url: v.file, quality: v.quality + 'p' }; });
        } else {
          qualitiesForPicker = directQuality.map(function(v) { return { url: v.file, quality: v.quality + 'p' }; });
        }

        console.log(TAG + ' ✅ [' + server.label + '] ' + directQuality.length + ' sources + ' + subtitlesList.length + ' subs');

        return {
          url: primary.file,
          quality: primary.quality + 'p',
          qualities: qualitiesForPicker,
          provider: 'LordFlix',
          headers: {
            'User-Agent': USER_AGENT,
            'Referer': ORIGIN + '/',
            'Origin': ORIGIN,
          },
          subtitles: subtitlesList,
        };
      }

      console.warn(TAG + ' ❌ All Peachify servers exhausted');
      return null;

    } catch (e) {
      console.error(TAG + ' 💥 Fatal: ' + e.message);
      return null;
    }
  }

  module.exports = { extract: extract };
})();
