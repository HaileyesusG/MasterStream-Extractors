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

  // Static server list — Spider first (fastest, peachify.top default)
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

        // Debug: log result structure so we can see the format
        var resultPreview = JSON.stringify(result).substring(0, 400);
        console.log(TAG + ' 📦 [' + server.label + '] Result: ' + resultPreview);

        // Step 4: Parse streams — try multiple formats
        var directQuality = [];
        var subtitlesList = [];

        // Format A: { stream: [{type, playlist/qualities}] }  — LordFlix style
        var streamArr = result.stream;

        // Format B: { sources: [{file, type}] }  — JWPlayer style
        var sourcesArr = result.sources || result.source;

        // Format C: direct { url: "...", quality: "..." }
        var directUrl = result.url || result.file || result.hls || result.m3u8;

        if (Array.isArray(streamArr) && streamArr.length > 0) {
          for (var j = 0; j < streamArr.length; j++) {
            var item = streamArr[j];
            var itemUrl = item.playlist || item.url || item.file || item.hls || item.m3u8 || '';
            if (item.type === 'hls' && itemUrl) {
              var hlsHeaders = { 'User-Agent': USER_AGENT, 'Referer': ORIGIN + '/', 'Origin': ORIGIN };
              var hlsVariants = await parseHlsMaster(itemUrl, hlsHeaders);
              var maxQ = hlsVariants.reduce(function(m, v) { return v.quality > m ? v.quality : m; }, 0) || 1080;
              directQuality.push({ file: itemUrl, quality: maxQ, hlsVariants: hlsVariants });
            } else if (item.type === 'file' && item.qualities) {
              var qualKeys = Object.keys(item.qualities);
              for (var q = 0; q < qualKeys.length; q++) {
                var qObj = item.qualities[qualKeys[q]];
                var qUrl = qObj && (qObj.url || qObj.file || '');
                var qNum = parseInt(qualKeys[q], 10) || 1080;
                if (qUrl) directQuality.push({ file: qUrl, quality: qNum });
              }
            } else if (itemUrl) {
              // Generic stream item with a URL
              var q2 = item.quality || item.res || item.label || 1080;
              var qNum2 = parseInt(q2, 10) || 1080;
              directQuality.push({ file: itemUrl, quality: qNum2 });
            }
            var caps = item.captions || item.subtitles || item.tracks || [];
            if (Array.isArray(caps)) {
              for (var k = 0; k < caps.length; k++) {
                var cap = caps[k];
                if (cap.kind && cap.kind !== 'captions' && cap.kind !== 'subtitles') continue;
                var capUrl = cap.url || cap.file || '';
                var capLang = cap.language || cap.label || cap.lang || 'Unknown';
                if (capUrl) subtitlesList.push({ url: capUrl, lang: capLang, label: capLang });
              }
            }
          }
        } else if (Array.isArray(sourcesArr) && sourcesArr.length > 0) {
          // JWPlayer / Shaka format: sources array
          for (var s = 0; s < sourcesArr.length; s++) {
            var src = sourcesArr[s];
            var srcUrl = src.file || src.url || src.src || '';
            if (!srcUrl) continue;
            var srcType = src.type || src.kind || '';
            var isHls = srcType.indexOf('hls') !== -1 || srcUrl.indexOf('.m3u8') !== -1;
            var srcQ = parseInt(src.label || src.quality || src.res || '0', 10) || 1080;
            if (isHls) {
              var hlsH = { 'User-Agent': USER_AGENT, 'Referer': ORIGIN + '/', 'Origin': ORIGIN };
              var hlsV = await parseHlsMaster(srcUrl, hlsH);
              var mQ = hlsV.reduce(function(m, v) { return v.quality > m ? v.quality : m; }, 0) || srcQ;
              directQuality.push({ file: srcUrl, quality: mQ, hlsVariants: hlsV });
            } else {
              directQuality.push({ file: srcUrl, quality: srcQ });
            }
          }
          // JWPlayer tracks for subtitles
          var tracks = result.tracks || [];
          if (Array.isArray(tracks)) {
            for (var t = 0; t < tracks.length; t++) {
              var tr = tracks[t];
              if (tr.kind && tr.kind !== 'captions' && tr.kind !== 'subtitles') continue;
              var trUrl = tr.file || tr.url || '';
              var trLang = tr.label || tr.language || tr.lang || 'Unknown';
              if (trUrl) subtitlesList.push({ url: trUrl, lang: trLang, label: trLang });
            }
          }
        } else if (directUrl) {
          // Simplest format: just a URL
          var isHls2 = directUrl.indexOf('.m3u8') !== -1;
          if (isHls2) {
            var hlsH2 = { 'User-Agent': USER_AGENT, 'Referer': ORIGIN + '/', 'Origin': ORIGIN };
            var hlsV2 = await parseHlsMaster(directUrl, hlsH2);
            var mQ2 = hlsV2.reduce(function(m, v) { return v.quality > m ? v.quality : m; }, 0) || 1080;
            directQuality.push({ file: directUrl, quality: mQ2, hlsVariants: hlsV2 });
          } else {
            directQuality.push({ file: directUrl, quality: 1080 });
          }
          // Subtitles at result level
          var resSubs = result.subtitles || result.captions || result.tracks || [];
          if (Array.isArray(resSubs)) {
            for (var rs = 0; rs < resSubs.length; rs++) {
              var sub = resSubs[rs];
              var subUrl = sub.url || sub.file || '';
              var subLang = sub.language || sub.label || sub.lang || 'Unknown';
              if (subUrl) subtitlesList.push({ url: subUrl, lang: subLang, label: subLang });
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
