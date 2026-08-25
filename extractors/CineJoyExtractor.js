/**
 * CineJoyExtractor v5.2.0 — Zero-Backend Remote Extractor for MasterStream.
 * Hosted at: HaileyesusG/MasterStream-Extractors/extractors/CineJoyExtractor.js
 * Works out-of-the-box on Mobile App (React Native Hermes) and Native TV App (Android WebView).
 *
 * Architecture (100% Client-Side / Zero Render Bandwidth):
 * 1. Queries https://api.shegu.st/servers for available server list
 * 2. Prioritizes: Lisbon (#1) > Nebula (#2) > Solara > Athens > Joy > Castle > Sakura > Canaias
 * 3. Encrypts request via enc-dec.app Lumen Gate v2: /api/enc-cinejoy
 * 4. Passes binary payload to https://api.shegu.st/g
 * 5. Decrypts response via enc-dec.app: /api/dec-cinejoy
 * 6. Validates stream URL live in JS (<100ms range ping) before returning to player
 *    — If dead link is returned, automatically cascades to next server in sequence!
 */
(function () {
  'use strict';

  var TAG = '[CineJoyExtractor]';
  var API = 'https://enc-dec.app/api';
  var SUBS_BASE = 'https://subtitles.shegu.st';
  var USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36';

  var FETCH_HEADERS = {
    'Accept': '*/*',
    'Origin': 'https://cinejoy.to',
    'Referer': 'https://cinejoy.to/',
    'User-Agent': USER_AGENT,
  };

  var SERVER_PRIORITY = ['Lisbon', 'Nebula', 'Solara', 'Athens', 'Joy', 'Castle', 'Sakura', 'Canaias'];

  // ─── Base64URL Helpers (Hermes & pure JS safe) ──────────────────────────────
  function base64url_decode(str) {
    var b64 = str.replace(/-/g, '+').replace(/_/g, '/');
    while (b64.length % 4) b64 += '=';
    if (typeof atob !== 'undefined') {
      var bin = atob(b64);
      var bytes = new Uint8Array(bin.length);
      for (var i = 0; i < bin.length; i++) {
        bytes[i] = bin.charCodeAt(i);
      }
      return bytes;
    }
    if (typeof Buffer !== 'undefined') {
      return Buffer.from(b64, 'base64');
    }
    return new Uint8Array(0);
  }

  function base64url_encode(bytes) {
    var b64 = '';
    if (typeof btoa !== 'undefined') {
      var bin = '';
      var len = bytes.byteLength !== undefined ? bytes.byteLength : bytes.length;
      var u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
      for (var i = 0; i < len; i++) {
        bin += String.fromCharCode(u8[i]);
      }
      b64 = btoa(bin);
    } else if (typeof Buffer !== 'undefined') {
      b64 = Buffer.from(bytes).toString('base64');
    }
    return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }

  // ─── Network Helpers ────────────────────────────────────────────────────────
  async function fetchJson(url, options) {
    try {
      var res = await fetch(url, options || { headers: FETCH_HEADERS });
      if (!res.ok) return null;
      return await res.json();
    } catch (e) {
      return null;
    }
  }

  async function fetchBinary(url, buffer) {
    try {
      var res = await fetch(url, {
        method: 'POST',
        headers: Object.assign({}, FETCH_HEADERS, { 'Content-Type': 'text/plain;charset=UTF-8' }),
        body: buffer,
      });
      if (!res.ok) return null;
      var ab = await res.arrayBuffer();
      return new Uint8Array(ab);
    } catch (e) {
      return null;
    }
  }

  // ─── Stream Validation (client-side ping, zero backend) ──────────────────────
  async function validateStreamUrl(url) {
    try {
      var controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
      var timeoutId = controller ? setTimeout(function () { controller.abort(); }, 3500) : null;
      var res = await fetch(url, {
        method: 'GET',
        headers: Object.assign({}, FETCH_HEADERS, { Range: 'bytes=0-1024' }),
        redirect: 'follow',
        signal: controller ? controller.signal : undefined,
      });
      if (timeoutId) clearTimeout(timeoutId);
      if (!res.ok) return false;
      var text = await res.text();
      if (text.indexOf('Invalid token') !== -1 || text.indexOf('404 Not Found') !== -1) {
        return false;
      }
      return text.indexOf('#EXTM3U') !== -1 || text.length > 0;
    } catch (e) {
      return false;
    }
  }

  // ─── Server Prioritization ──────────────────────────────────────────────────
  function sortServers(rawServers) {
    var named = (rawServers || []).map(function (s) {
      return typeof s === 'string' ? s : (s && s.name ? s.name : '');
    }).filter(Boolean);

    var sorted = [];
    for (var i = 0; i < SERVER_PRIORITY.length; i++) {
      if (named.indexOf(SERVER_PRIORITY[i]) !== -1) {
        sorted.push(SERVER_PRIORITY[i]);
      }
    }
    for (var j = 0; j < named.length; j++) {
      if (sorted.indexOf(named[j]) === -1) {
        sorted.push(named[j]);
      }
    }
    return sorted.length > 0 ? sorted : SERVER_PRIORITY;
  }

  // ─── Primary Extract Function ─────────────────────────────────────────────────
  async function extract(tmdbId, imdbId, title, isTv, season, episode, year) {
    try {
      // 1. Fetch live server list
      var serversRes = await fetchJson('https://api.shegu.st/servers');
      var rawServers = serversRes && serversRes.servers ? serversRes.servers : [];
      var servers = sortServers(rawServers);

      console.log(TAG + ' Extraction sequence: [' + servers.join(', ') + ']');

      // 2. Cascade through servers in order
      for (var i = 0; i < servers.length; i++) {
        var server = servers[i];
        console.log(TAG + ' [' + server + '] Trying...');

        var paramsObj = {
          title: title || '',
          type: isTv ? 'series' : 'movie',
          year: year ? String(year) : '',
          imdb: imdbId || '',
          tmdb: String(tmdbId),
          server: server,
        };
        if (isTv && season != null && episode != null) {
          paramsObj.season = String(season);
          paramsObj.episode = String(episode);
        }

        var params = new URLSearchParams(paramsObj);
        var sourceUrl = 'https://api.shegu.st/?' + params.toString();

        // Step A: Request encrypted token & state from enc-dec.app
        var encUrl = API + '/enc-cinejoy?url=' + encodeURIComponent(sourceUrl);
        var encJson = await fetchJson(encUrl);
        if (!encJson || encJson.status !== 200 || !encJson.result || !encJson.result.data) {
          console.warn(TAG + ' [' + server + '] enc-cinejoy failed');
          continue;
        }

        var encData = encJson.result.data;
        var state = encJson.result.state;

        // Step B: Post binary payload to https://api.shegu.st/g
        var binaryPayload = base64url_decode(encData);
        var encryptedBytes = await fetchBinary('https://api.shegu.st/g', binaryPayload);
        if (!encryptedBytes || encryptedBytes.length === 0) {
          console.warn(TAG + ' [' + server + '] shegu /g returned no data');
          continue;
        }

        // Step C: Decrypt stream metadata via enc-dec.app
        var decUrl = API + '/dec-cinejoy';
        var decPayload = {
          text: base64url_encode(encryptedBytes),
          state: state,
        };
        var decJson = await fetchJson(decUrl, {
          method: 'POST',
          headers: Object.assign({}, FETCH_HEADERS, { 'Content-Type': 'application/json' }),
          body: JSON.stringify(decPayload),
        });

        if (!decJson || decJson.status !== 200 || !decJson.result) {
          console.warn(TAG + ' [' + server + '] dec-cinejoy failed');
          continue;
        }

        // Step D: Extract playable stream URL and subtitles
        var streamData = decJson.result.data || decJson.result;
        var streams = Array.isArray(streamData.stream) ? streamData.stream :
                      Array.isArray(streamData.streams) ? streamData.streams :
                      Array.isArray(streamData.sources) ? streamData.sources : [];

        var streamUrl = '';
        var captions = [];

        if (streams.length > 0) {
          var best = streams.find(function (s) {
            return s.type === 'hls' || (s.playlist && s.playlist.indexOf('.m3u8') !== -1);
          }) || streams[0];
          streamUrl = best.playlist || best.url || best.file || best.src || '';
          captions = best.captions || streamData.captions || streamData.subtitles || [];
        } else if (streamData.url) {
          streamUrl = streamData.url;
          captions = streamData.captions || streamData.subtitles || [];
        }

        if (!streamUrl) {
          console.warn(TAG + ' [' + server + '] No stream URL found in result');
          continue;
        }

        // Step E: Client-side validation (<100ms)
        console.log(TAG + ' [' + server + '] Validating stream: ' + streamUrl.slice(0, 60) + '...');
        var isValid = await validateStreamUrl(streamUrl);
        if (!isValid) {
          console.warn(TAG + ' [' + server + '] ⚠️ Stream is dead/unplayable, cascading to next server...');
          continue;
        }

        // Step F: Format subtitles
        var subtitles = [];
        for (var k = 0; k < captions.length; k++) {
          var cap = captions[k];
          if (!cap) continue;
          var capUrl = cap.url || cap.file || '';
          if (capUrl && capUrl.indexOf('http') !== 0) {
            capUrl = SUBS_BASE + (capUrl.indexOf('/') === 0 ? '' : '/') + capUrl;
          }
          if (capUrl) {
            var label = cap.label || cap.language || cap.lang || ('Subtitle ' + (k + 1));
            var lang = cap.language || cap.lang || label;
            subtitles.push({ url: capUrl, lang: lang, label: label });
          }
        }

        console.log(TAG + ' [' + server + '] ✅ Verified playable stream found: ' + streamUrl.slice(0, 60) + '... (' + subtitles.length + ' subs)');

        return {
          url: streamUrl,
          quality: 'Auto',
          qualities: [{ quality: 'Auto', url: streamUrl }],
          provider: 'CineJoy (' + server + ')',
          headers: {
            'Referer': 'https://cinejoy.to/',
            'Origin': 'https://cinejoy.to',
            'User-Agent': USER_AGENT,
          },
          subtitles: subtitles,
        };
      }

      console.warn(TAG + ' No valid playable stream found from any server');
      return null;
    } catch (e) {
      console.error(TAG + ' Extraction error: ' + (e.message || e));
      return null;
    }
  }

  // ─── Module Export ────────────────────────────────────────────────────────────
  var extractor = { extract: extract };
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = extractor;
  }
  var gObj = typeof globalThis !== 'undefined' ? globalThis
    : typeof window !== 'undefined' ? window
    : typeof global !== 'undefined' ? global : this;
  if (gObj) {
    gObj.CineJoyExtractor = extractor;
  }
})();
