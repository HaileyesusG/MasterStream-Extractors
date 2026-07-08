(function () {
  'use strict';

  /**
   * LordFlixExtractor.js — vixsrc.to API (hacker-verified, no encryption)
   *
   * Flow:
   *   1. GET /api/movie/{tmdbId}  or  /api/tv/{tmdbId}?s=&e=
   *      → { src: "/embed/{id}?token=...&expires=...&t=..." }
   *   2. GET /{src}  with Referer: vixsrc.to/
   *      → HTML with inline <script> blocks
   *   3. scripts[4] sets: window.masterPlaylist = { url: "...", params: {...} }
   *   4. Unescape URL + merge params + append h=1&lang=en → final HLS URL
   */

  var TAG = '[LordFlix/VixSrc]';
  var DOMAIN = 'https://vixsrc.to';
  var USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36';

  // ── Helpers ───────────────────────────────────────────────────────────────

  async function fetchGet(url, headers) {
    try {
      var res = await fetch(url, { headers: headers, redirect: 'follow' });
      if (!res.ok) {
        console.warn(TAG + ' ❌ HTTP ' + res.status + ' for ' + url);
        return null;
      }
      return res;
    } catch (e) {
      console.warn(TAG + ' ❌ Network error: ' + e.message);
      return null;
    }
  }

  /**
   * Unescape a JS/JSON string value that may contain:
   *   \/ → /
   *   \u0026 → &
   *   \u003d → =
   *   \\ → \
   */
  function unescapeString(s) {
    if (!s) return s;
    try {
      // Wrap in quotes and JSON.parse — handles all standard JSON escapes
      return JSON.parse('"' + s.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\\\\\//g, '\\/') + '"');
    } catch (e) {
      // Manual fallback for common cases
      return s
        .replace(/\\\//g, '/')
        .replace(/\\u0026/gi, '&')
        .replace(/\\u003d/gi, '=')
        .replace(/\\u003c/gi, '<')
        .replace(/\\u003e/gi, '>')
        .replace(/\\u0027/gi, "'")
        .replace(/\\\\/g, '\\');
    }
  }

  // ── Parse masterPlaylist from HTML scripts ────────────────────────────────

  function parseMasterPlaylist(html) {
    var allScripts = [];
    var re = /<script\b[^>]*>([\s\S]*?)<\/script>/gi;
    var m;
    while ((m = re.exec(html)) !== null) {
      allScripts.push(m[1].trim());
    }

    // Try scripts[4] first (hacker's finding), then all
    var candidates = [];
    if (allScripts.length > 4) candidates.push(allScripts[4]);
    for (var i = 0; i < allScripts.length; i++) candidates.push(allScripts[i]);

    for (var j = 0; j < candidates.length; j++) {
      var script = candidates[j];
      if (!script.includes('masterPlaylist')) continue;

      // Extract url value (may be JSON-escaped with \/ and \u0026)
      var urlMatch =
        script.match(/\burl\s*:\s*"((?:[^"\\]|\\[\s\S])*)"/) ||
        script.match(/\burl\s*:\s*'((?:[^'\\]|\\[\s\S])*)'/) ||
        script.match(/"url"\s*:\s*"((?:[^"\\]|\\[\s\S])*)"/);

      if (!urlMatch) continue;
      var rawUrl = urlMatch[1];
      var playlistUrl = unescapeString(rawUrl);
      console.log(TAG + ' 🔗 Raw url: ' + rawUrl);
      console.log(TAG + ' 🔗 Unescaped url: ' + playlistUrl);

      // Extract params object — extract each key-value pair individually
      // (avoids JSON.parse issues with single-quoted strings and variable references)
      var params = {};
      var paramsBlockMatch = script.match(/\bparams\s*:\s*(\{[\s\S]*?\})/);
      if (paramsBlockMatch) {
        var paramsText = paramsBlockMatch[1];
        var kvRegex = /\b(\w+)\s*:\s*(?:'([^']*)'|"([^"]*)"|(-?\d+(?:\.\d+)?|true|false|null))/g;
        var kv;
        while ((kv = kvRegex.exec(paramsText)) !== null) {
          var key = kv[1];
          var val = kv[2] !== undefined ? kv[2]   // single-quoted string
                  : kv[3] !== undefined ? kv[3]   // double-quoted string
                  : kv[4];                         // number / bool / null
          if (key && val !== undefined && val !== null && val !== 'null' && val !== 'false') {
            params[key] = val;
          }
        }
        var paramKeys = Object.keys(params);
        if (paramKeys.length > 0) {
          console.log(TAG + ' ✅ Parsed params (' + paramKeys.length + ' keys): ' + paramKeys.join(', '));
        } else {
          console.warn(TAG + ' ⚠️ params block found but no key-value pairs extracted — will use embed URL params');
        }
      }

      return { url: playlistUrl, params: params };
    }

    return null;
  }

  // ── Build final HLS URL ──────────────────────────────────────────────────

  function buildFinalUrl(playlistUrl, params, embedUrl) {
    // Make absolute
    if (!playlistUrl.startsWith('http')) {
      playlistUrl = DOMAIN + (playlistUrl.startsWith('/') ? '' : '/') + playlistUrl;
    }
    try {
      var u = new URL(playlistUrl);

      // Merge params object (from masterPlaylist.params)
      if (params) {
        for (var key in params) {
          if (Object.prototype.hasOwnProperty.call(params, key)) {
            var val = params[key];
            if (val !== null && val !== undefined && val !== false && val !== '') {
              u.searchParams.set(key, val);
            }
          }
        }
      }

      // If critical auth params are missing, inject ALL params from embed URL as fallback
      // (token, expires, t, ub, b, and any other auth params the server requires)
      var hasToken = u.searchParams.has('token') || u.searchParams.has('expires');
      if (!hasToken && embedUrl) {
        try {
          var embedU = new URL(embedUrl);
          embedU.searchParams.forEach(function(v, k) {
            // Don't overwrite params already on the playlist URL
            if (!u.searchParams.has(k)) u.searchParams.set(k, v);
          });
          console.log(TAG + ' 🔑 Injected all params from embed URL');
        } catch (e) {
          console.warn(TAG + ' ⚠️ Could not parse embed URL for fallback params');
        }
      }

      u.searchParams.set('h', '1');
      u.searchParams.set('lang', 'en');
      return u.toString();
    } catch (e) {
      console.warn(TAG + ' ⚠️ URL build error: ' + e.message);
      return playlistUrl + '?h=1&lang=en';
    }
  }

  // ── Main ─────────────────────────────────────────────────────────────────

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
      var baseHeaders = {
        'User-Agent': USER_AGENT,
        'Accept-Language': 'en-US,en;q=0.9',
        'cache-control': 'no-cache',
        'pragma': 'no-cache',
        'sec-ch-ua': '"Google Chrome";v="149", "Chromium";v="149", "Not)A;Brand";v="24"',
        'sec-ch-ua-mobile': '?0',
        'sec-ch-ua-platform': '"Windows"'
      };

      // Step 1 — API: get embed src
      var apiUrl = isTv
        ? DOMAIN + '/api/tv/' + tmdbId + '?s=' + (season || 1) + '&e=' + (episode || 1)
        : DOMAIN + '/api/movie/' + tmdbId;

      console.log(TAG + ' 🚀 API: ' + apiUrl);

      var apiRes = await fetchGet(apiUrl, Object.assign({}, baseHeaders, {
        'accept': 'application/json, text/plain, */*',
        'priority': 'u=1, i',
        'sec-fetch-dest': 'empty',
        'sec-fetch-mode': 'cors',
        'sec-fetch-site': 'same-origin',
        'Referer': DOMAIN + (isTv ? '/tv/' + tmdbId : '/movie/' + tmdbId)
      }));
      if (!apiRes) return null;

      var apiData;
      try { apiData = await apiRes.json(); } catch (e) {
        console.warn(TAG + ' ❌ API not JSON'); return null;
      }

      var src = apiData && (apiData.src || apiData.url || apiData.embed);
      if (!src) {
        console.warn(TAG + ' ❌ No src in API response: ' + JSON.stringify(apiData).substring(0, 120));
        return null;
      }
      console.log(TAG + ' 📦 src = ' + src);

      // Step 2 — Fetch embed HTML
      var embedUrl = src.startsWith('http') ? src : DOMAIN + (src.startsWith('/') ? src : '/' + src);
      console.log(TAG + ' 🌐 Embed: ' + embedUrl);

      var embedRes = await fetchGet(embedUrl, Object.assign({}, baseHeaders, {
        'accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7',
        'priority': 'u=0, i',
        'sec-fetch-dest': 'iframe',
        'sec-fetch-mode': 'navigate',
        'sec-fetch-site': 'same-origin',
        'upgrade-insecure-requests': '1',
        'Referer': DOMAIN + '/'
      }));
      if (!embedRes) return null;
      var html = await embedRes.text();

      // Step 3 — Parse masterPlaylist
      var mp = parseMasterPlaylist(html);
      if (!mp || !mp.url) {
        console.warn(TAG + ' ❌ masterPlaylist not found');
        return null;
      }

      // Step 4 — Build final URL (with embed URL as token fallback)
      var finalUrl = buildFinalUrl(mp.url, mp.params, embedUrl);
      console.log(TAG + ' ✅ Final URL: ' + finalUrl.substring(0, 120));

      return {
        url: finalUrl,
        quality: 'Auto',
        provider: 'LordFlix',
        headers: {
          'User-Agent': USER_AGENT,
          'Referer': DOMAIN + '/',
          'Origin': DOMAIN
        },
        subtitles: []
      };

    } catch (e) {
      console.error(TAG + ' 💥 Fatal: ' + e.message);
      return null;
    }
  }

  module.exports = { extract: extract };
})();
