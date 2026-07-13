/**
 * VidSrcCCExtractor — self-contained CommonJS JS for remote hot-update.
 * Hosted at: HaileyesusG/MasterStream-Extractors/extractors/VidSrcCCExtractor.js
 *
 * ⚠️ VidSrcCC is dead. This slot is now powered by LordFlix (lordflix.org).
 * Returns results under provider name "VidSrcCC" so no app update needed.
 *
 * Updated flow (from smy778/EncDecEndpoints/samples/lordflix.py):
 *  1. Build snowhouse URL (with title + year + imdb + tmdb + server)
 *  2. GET enc-dec.app/api/enc-lordflix?url=... → { url, sign }
 *  3. Solve SHA-256 proof-of-work challenge → base64 x-attest header
 *  4. GET enc_url with x-attest header → encrypted text
 *  5. POST enc-dec.app/api/dec-lordflix with { text } → sources + subtitles
 */
(function () {
  var TAG = '[VidSrcCCExtractor]';
  // -- Media type support � change here to enable/disable for movies or TV --
  var SUPPORTS_MOVIE = true;
  var SUPPORTS_TV    = true;

  var SNOWHOUSE = 'https://api.arigold.ru';
  var ENC_DEC = 'https://enc-dec.app/api';
  var USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36';

  var BASE_HEADERS = {
    'Accept': '*/*',
    'Origin': 'https://lordflix.su',
    'Referer': 'https://lordflix.su',
    'User-Agent': USER_AGENT,
  };

  // ── Pure-JS SHA-256 — all rotations inlined, >>> 0 for unsigned 32-bit ──
  function sha256hex(str) {
    // UTF-8 encode (handles non-ASCII correctly)
    var utf8 = unescape(encodeURIComponent(str));
    var msgLen = utf8.length;

    // Build byte array from UTF-8 string
    var msg = [];
    for (var i = 0; i < msgLen; i++) msg.push(utf8.charCodeAt(i) & 0xff);

    // Padding: append 0x80, zeros, then 64-bit big-endian bit length
    msg.push(0x80);
    while (msg.length % 64 !== 56) msg.push(0);
    var bits = msgLen * 8;
    msg.push(0, 0, 0, 0,
      (bits >>> 24) & 0xff, (bits >>> 16) & 0xff, (bits >>> 8) & 0xff, bits & 0xff);

    var K = [
      0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
      0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
      0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
      0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
      0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
      0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
      0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
      0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2
    ];

    var h0 = 0x6a09e667, h1 = 0xbb67ae85, h2 = 0x3c6ef372, h3 = 0xa54ff53a;
    var h4 = 0x510e527f, h5 = 0x9b05688c, h6 = 0x1f83d9ab, h7 = 0x5be0cd19;

    for (var o = 0; o < msg.length; o += 64) {
      var w = [];
      for (var t = 0; t < 16; t++) {
        w[t] = ((msg[o + t*4] << 24) | (msg[o + t*4+1] << 16) | (msg[o + t*4+2] << 8) | msg[o + t*4+3]) >>> 0;
      }
      for (var t = 16; t < 64; t++) {
        var v = w[t-15];
        var s0 = ((v >>> 7) | (v << 25)) ^ ((v >>> 18) | (v << 14)) ^ (v >>> 3);
        var v2 = w[t-2];
        var s1 = ((v2 >>> 17) | (v2 << 15)) ^ ((v2 >>> 19) | (v2 << 13)) ^ (v2 >>> 10);
        w[t] = (w[t-16] + s0 + w[t-7] + s1) >>> 0;
      }

      var a = h0, b = h1, c = h2, d = h3, e = h4, f = h5, g = h6, h = h7;

      for (var t = 0; t < 64; t++) {
        var S1  = ((e >>> 6) | (e << 26)) ^ ((e >>> 11) | (e << 21)) ^ ((e >>> 25) | (e << 7));
        var ch  = (e & f) ^ ((~e >>> 0) & g);
        var T1  = (h + S1 + ch + K[t] + w[t]) >>> 0;
        var S0  = ((a >>> 2) | (a << 30)) ^ ((a >>> 13) | (a << 19)) ^ ((a >>> 22) | (a << 10));
        var maj = (a & b) ^ (a & c) ^ (b & c);
        var T2  = (S0 + maj) >>> 0;

        h = g; g = f; f = e; e = (d + T1) >>> 0;
        d = c; c = b; b = a; a = (T1 + T2) >>> 0;
      }

      h0 = (h0 + a) >>> 0; h1 = (h1 + b) >>> 0; h2 = (h2 + c) >>> 0; h3 = (h3 + d) >>> 0;
      h4 = (h4 + e) >>> 0; h5 = (h5 + f) >>> 0; h6 = (h6 + g) >>> 0; h7 = (h7 + h) >>> 0;
    }

    function hex8(n) { return ('0000000' + (n >>> 0).toString(16)).slice(-8); }
    return hex8(h0) + hex8(h1) + hex8(h2) + hex8(h3) + hex8(h4) + hex8(h5) + hex8(h6) + hex8(h7);
  }

  // ── Solve SHA-256 proof-of-work challenge ────────────────────────────────
  // Returns base64-encoded JSON payload for the x-attest header
  async function solveChallenge() {
    try {
      var resp = await fetch(SNOWHOUSE + '/challenge', { headers: BASE_HEADERS });
      if (!resp.ok) { console.warn(TAG + ' ⚠️ Challenge fetch failed: ' + resp.status); return null; }
      var data = JSON.parse(await resp.text());

      var maxNumber = data.maxnumber;
      var challenge = data.challenge;
      var salt = data.salt;
      var number = -1;
      for (var n = 0; n <= maxNumber; n++) {
        if (sha256hex(salt + n) === challenge) { number = n; break; }
      }

      if (number === -1) { console.warn(TAG + ' ⚠️ Could not solve challenge (checked 0..' + maxNumber + ')'); return null; }

      var payload = {
        algorithm: data.algorithm,
        challenge: data.challenge,
        number: number,
        salt: data.salt,
        signature: data.signature,
      };

      // base64-encode the JSON payload
      var json = JSON.stringify(payload);
      var b64 = btoa(unescape(encodeURIComponent(json)));
      console.log(TAG + ' 🔐 Challenge solved: number=' + number);
      return b64;
    } catch (e) {
      console.warn(TAG + ' ⚠️ Challenge error: ' + e.message);
      return null;
    }
  }

  async function fetchGet(url, headers) {
    try {
      var response = await fetch(url, { headers: headers || BASE_HEADERS, redirect: 'follow' });
      if (!response.ok) { console.warn(TAG + ' ❌ HTTP ' + response.status + ' for ' + url); return null; }
      return await response.text();
    } catch (e) {
      console.warn(TAG + ' ❌ Network error: ' + e.message);
      return null;
    }
  }

  async function fetchPost(url, body, headers) {
    try {
      var response = await fetch(url, { method: 'POST', headers: headers, body: body, redirect: 'follow' });
      if (!response.ok) { console.warn(TAG + ' ❌ HTTP ' + response.status + ' for POST ' + url); return null; }
      return await response.text();
    } catch (e) {
      console.warn(TAG + ' ❌ Network error POST: ' + e.message);
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
          var resMatch = line.match(/RESOLUTION=(\d+)x(\d+)/);
          var quality = resMatch ? parseInt(resMatch[2], 10) : 1080;
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

  // ── HLS master playlist parser ─────────────────────────────────────────────
  // Fetches the master m3u8 and returns [{file, quality}] for each variant.
  // Falls back to [{file: url, quality: 1080}] on any error.
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
          // Resolve relative or absolute-path variant URLs
          var varUrl = nextLine;
          if (varUrl.indexOf('http') === 0) {
            // Already absolute — use as-is
          } else if (varUrl.charAt(0) === '/') {
            // Absolute path — use origin only (avoid double-slash)
            var originMatch = masterUrl.match(/^(https?:\/\/[^\/]+)/);
            varUrl = originMatch ? originMatch[1] + varUrl : masterUrl;
          } else {
            // Relative path
            var base = masterUrl.substring(0, masterUrl.lastIndexOf('/') + 1);
            varUrl = base + varUrl;
          }
          var quality = height ||
            (bwMatch ? Math.round(parseInt(bwMatch[1], 10) / 150000) * 100 : 1080);
          variants.push({ file: varUrl, quality: quality });
        }
      }
      return variants.length > 0 ? variants : [{ file: masterUrl, quality: 1080 }];
    } catch (_) {
      return [{ file: masterUrl, quality: 1080 }];
    }
  }

  async function extract(tmdbId, imdbId, arg2, arg3, arg4, arg5) {
    // Dual calling-convention support:
    //   Mobile app: extract(tmdbId, imdbId, isTv, season, episode)               — 5 params
    //   TV app:     extract(tmdbId, imdbId, title, isTv, season, episode, year)   — 7 params
    var isTv, season, episode;
    if (typeof arg2 === 'boolean') {
      isTv = arg2; season = arg3; episode = arg4; // mobile
    } else {
      isTv = arg3; season = arg4; episode = arg5; // TV app (arg2 = title, ignored)
    }
    try {
      if (isTv && !SUPPORTS_TV)    { console.log('[VidSrcCC] Skip TV'); return null; }
      if (!isTv && !SUPPORTS_MOVIE) { console.log('[VidSrcCC] Skip Movie'); return null; }

      // Step 0: Fetch server list dynamically (so we always use current servers)
      var servers = ['Solstice', 'Vienna', 'Lion', 'Phoenix', 'Luna']; // fallback
      try {
        var srvRaw = await fetchGet(SNOWHOUSE + '/servers', BASE_HEADERS);
        if (srvRaw) {
          var srvJson = JSON.parse(srvRaw);
          if (srvJson.servers && srvJson.servers.length > 0) {
            servers = srvJson.servers.map(function(s) { return s.name; });
            console.log(TAG + ' 📡 Got ' + servers.length + ' servers from API: ' + servers.join(', '));
          }
        }
      } catch (_) { console.warn(TAG + ' ⚠️ Could not fetch servers, using fallback'); }

      // Preferred server order — put reliable servers first to avoid wasting challenge solves
      // Solstice and Vienna are consistently returning 500 — deprioritize them
      var PREFERRED_SERVERS = ['Solstice', 'Vienna', 'Lion', 'Phoenix', 'Flower', 'Rio', 'Luna', 'Moscow', 'Sakura'];
      servers = servers.slice().sort(function(a, b) {
        var ai = PREFERRED_SERVERS.indexOf(a); if (ai === -1) ai = PREFERRED_SERVERS.length;
        var bi = PREFERRED_SERVERS.indexOf(b); if (bi === -1) bi = PREFERRED_SERVERS.length;
        return ai - bi;
      });
      console.log(TAG + ' 📋 Server order: ' + servers.join(', '));

      var mediaType = isTv ? 'series' : 'movie';

      for (var i = 0; i < servers.length; i++) {
        var server = servers[i];

        // Step 1: Build snowhouse URL — title/year omitted, server uses tmdbId as primary key
        var snowhouseUrl = SNOWHOUSE + '/?type=' + mediaType +
          '&imdb=' + (imdbId || '') +
          '&tmdb=' + tmdbId +
          '&server=' + server;
        if (isTv) snowhouseUrl += '&season=' + season + '&episode=' + episode;

        // Step 1b: Solve a FRESH challenge per server (challenge is single-use)
        var attest = await solveChallenge();
        if (!attest) { console.warn(TAG + ' ⚠️ [' + server + '] Challenge failed — skipping'); continue; }

        console.log(TAG + ' 🚀 Trying server: ' + server);

        // Step 2: enc-lordflix → get signed URL
        var encUrl = ENC_DEC + '/enc-lordflix?url=' + encodeURIComponent(snowhouseUrl);
        var encRaw = await fetchGet(encUrl, { 'Accept': 'application/json', 'User-Agent': USER_AGENT });
        if (!encRaw) { console.warn(TAG + ' ⚠️ [' + server + '] enc-lordflix returned null'); continue; }

        var encJson;
        try { encJson = JSON.parse(encRaw); } catch (_) { continue; }
        if (encJson.status !== 200) { console.warn(TAG + ' ⚠️ [' + server + '] enc status=' + encJson.status); continue; }

        var encResult = encJson.result;
        if (!encResult || !encResult.url) { console.warn(TAG + ' ⚠️ [' + server + '] Missing url in enc response'); continue; }

        // Step 3: Fetch encrypted payload using x-attest header
        console.log(TAG + ' 📥 [' + server + '] Fetching encrypted payload...');
        var fetchHeaders = Object.assign({}, BASE_HEADERS);
        if (attest) fetchHeaders['x-attest'] = attest;

        var encText = await fetchGet(encResult.url, fetchHeaders);
        if (!encText || encText.trim() === '') { console.warn(TAG + ' ⚠️ [' + server + '] Empty encrypted payload'); continue; }
        console.log(TAG + ' 🔑 [' + server + '] Got encrypted text (len=' + encText.length + ')');

        // Step 4: Decrypt — only {text}, no sign
        var decHeaders = {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
          'User-Agent': USER_AGENT,
          'Origin': 'https://lordflix.su',
          'Referer': 'https://lordflix.su/',
        };
        var decRaw = await fetchPost(ENC_DEC + '/dec-lordflix', JSON.stringify({ text: encText }), decHeaders);
        if (!decRaw) { console.warn(TAG + ' ⚠️ [' + server + '] dec-lordflix failed'); continue; }

        var decJson;
        try { decJson = JSON.parse(decRaw); } catch (_) { continue; }
        if (decJson.status !== 200) { console.warn(TAG + ' ⚠️ [' + server + '] dec status=' + decJson.status); continue; }

        var result = decJson.result;
        if (!result || result.error) { console.warn(TAG + ' ⚠️ [' + server + '] ' + (result && result.error || 'no result')); continue; }

        // Step 5: Parse sources
        var streamArr = result.stream;
        if (!Array.isArray(streamArr) || streamArr.length === 0) { console.warn(TAG + ' ⚠️ [' + server + '] No stream array'); continue; }

        var directQuality = [];
        var subtitlesList = [];

        for (var j = 0; j < streamArr.length; j++) {
          var streamItem = streamArr[j];
          if (streamItem.type === 'hls' && streamItem.playlist) {
            var masterUrl = streamItem.playlist;
            var hlsVariants = await parseHlsMaster(masterUrl, {
              'User-Agent': USER_AGENT,
              'Referer': 'https://lordflix.su/',
              'Origin': 'https://lordflix.su',
            });
            var maxQ = 1080;
            for (var v = 0; v < hlsVariants.length; v++) {
              if (hlsVariants[v].quality > maxQ || v === 0) maxQ = hlsVariants[v].quality;
            }
            console.log(TAG + ' 📺 [' + server + '] HLS variants: ' + hlsVariants.length);
            // Primary entry = original master URL (proxy, validates fine with 200/206)
            // hlsVariants stored for quality picker
            directQuality.push({ file: masterUrl, quality: maxQ, hlsVariants: hlsVariants });


          } else if (streamItem.type === 'file' && streamItem.qualities) {
            var qualKeys = Object.keys(streamItem.qualities);
            for (var q = 0; q < qualKeys.length; q++) {
              var qKey = qualKeys[q];
              var qObj = streamItem.qualities[qKey];
              var qUrl = qObj && (qObj.url || qObj.file || '');
              var qNum = parseInt(qKey, 10) || 1080;
              if (qUrl) directQuality.push({ file: qUrl, quality: qNum });
            }
          }
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

        if (directQuality.length === 0) { console.warn(TAG + ' ⚠️ [' + server + '] No quality URLs'); continue; }
        directQuality.sort(function (a, b) { return b.quality - a.quality; });

        // Build qualities for UI picker:
        // For HLS entries, use the parsed hlsVariants (all resolutions);
        // for direct-file entries use the directQuality list as-is.
        var qualitiesForPicker;
        var primary = directQuality[0];
        if (primary.hlsVariants && primary.hlsVariants.length > 1) {
          qualitiesForPicker = primary.hlsVariants
            .sort(function(a, b) { return b.quality - a.quality; })
            .map(function(q) { return { url: q.file, quality: q.quality + 'p' }; });
        } else {
          qualitiesForPicker = directQuality.map(function(q) { return { url: q.file, quality: q.quality + 'p' }; });
        }

        console.log(TAG + ' ✅ [' + server + '] Found ' + directQuality.length + ' sources + ' + subtitlesList.length + ' subtitles');

        return {
          url: primary.file,
          quality: primary.quality + 'p',
          qualities: qualitiesForPicker,
          provider: 'VidSrcCC',
          headers: {
            'User-Agent': USER_AGENT,
            'Referer': 'https://lordflix.su/',
            'Origin': 'https://lordflix.su',
          },
          subtitles: subtitlesList,
        };
      }

      console.warn(TAG + ' ❌ All LordFlix servers exhausted');
      return null;
    } catch (e) {
      console.error(TAG + ' 💥 Error during extraction', e);
      return null;
    }
  }

  module.exports = { extract: extract };
})();
