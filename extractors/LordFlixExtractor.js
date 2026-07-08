(function () {
  'use strict';

  /**
   * LordFlixExtractor.js — uses vixsrc.to API (hacker-verified, no encryption)
   *
   * Hacker's confirmed flow:
   *   1. GET /api/movie/{tmdbId}  or  /api/tv/{tmdbId}?s=&e=
   *      → { src: "/path/to/embed" }
   *   2. GET /{src}  with Referer: vixsrc.to/
   *      → HTML with inline <script> blocks
   *   3. scripts[4] sets window.masterPlaylist = { url: "...", params: {...} }
   *   4. Build URL: masterPlaylist.url + all params + h=1 + lang=en
   *
   * Remotely updatable from GitHub — no APK release needed.
   */

  var TAG = '[LordFlix/VixSrc]';
  var DOMAIN = 'https://vixsrc.to';
  var USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36';

  // ── HTTP helper ───────────────────────────────────────────────────────────

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

  // ── Parse masterPlaylist safely (no eval) ────────────────────────────────
  //
  // The hacker used eval(scripts[4]) in a browser.
  // We reproduce the same result via regex — safe, no arbitrary code execution.

  function parseMasterPlaylist(html) {
    // Extract all inline scripts
    var allScripts = [];
    var re = /<script\b[^>]*>([\s\S]*?)<\/script>/gi;
    var m;
    while ((m = re.exec(html)) !== null) {
      allScripts.push(m[1].trim());
    }

    // Try scripts[4] first (hacker's finding), then all scripts
    var candidates = [];
    if (allScripts.length > 4) candidates.push(allScripts[4]);
    candidates = candidates.concat(allScripts);

    for (var i = 0; i < candidates.length; i++) {
      var script = candidates[i];
      if (!script.includes('masterPlaylist')) continue;

      // Try to extract url value
      var urlMatch =
        script.match(/masterPlaylist\s*[=:]\s*\{[^}]*\burl\s*:\s*["']([^"']+)["']/) ||
        script.match(/"url"\s*:\s*"([^"]+)"/) ||
        script.match(/'url'\s*:\s*'([^']+)'/);

      if (!urlMatch) continue;
      var playlistUrl = urlMatch[1];

      // Try to extract params object
      var paramsMatch = script.match(/\bparams\s*:\s*(\{[^}]*\})/);
      var params = {};
      if (paramsMatch) {
        try {
          var normalized = paramsMatch[1]
            .replace(/([{,]\s*)([a-zA-Z_$][a-zA-Z0-9_$]*)\s*:/g, '$1"$2":')
            .replace(/:\s*'([^']*)'/g, ':"$1"')
            .replace(/,\s*}/g, '}');
          params = JSON.parse(normalized);
        } catch (e) {
          console.warn(TAG + ' ⚠️ params parse failed: ' + e.message);
        }
      }

      return { url: playlistUrl, params: params };
    }

    return null;
  }

  // ── Build final HLS URL ──────────────────────────────────────────────────

  function buildFinalUrl(masterPlaylist) {
    var base = masterPlaylist.url;
    // Make absolute if needed
    if (!base.startsWith('http')) {
      base = DOMAIN + (base.startsWith('/') ? '' : '/') + base;
    }
    try {
      var u = new URL(base);
      var p = masterPlaylist.params || {};
      for (var key in p) {
        if (Object.prototype.hasOwnProperty.call(p, key) && p[key] !== null && p[key] !== undefined && p[key] !== false) {
          u.searchParams.append(key, p[key]);
        }
      }
      u.searchParams.append('h', '1');
      u.searchParams.append('lang', 'en');
      return u.toString();
    } catch (e) {
      return base + '?h=1&lang=en';
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

      // Step 1 — Get embed src from API
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
        console.warn(TAG + ' ❌ API response not JSON');
        return null;
      }

      var src = apiData && (apiData.src || apiData.url || apiData.embed);
      if (!src) {
        console.warn(TAG + ' ❌ No src in API response: ' + JSON.stringify(apiData).substring(0, 100));
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

      // Step 3 — Parse masterPlaylist from scripts
      var masterPlaylist = parseMasterPlaylist(html);
      if (!masterPlaylist || !masterPlaylist.url) {
        console.warn(TAG + ' ❌ masterPlaylist not found in embed HTML');
        return null;
      }
      console.log(TAG + ' 🎬 masterPlaylist.url = ' + masterPlaylist.url);

      // Step 4 — Build final URL
      var finalUrl = buildFinalUrl(masterPlaylist);
      console.log(TAG + ' ✅ Final URL: ' + finalUrl.substring(0, 100));

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
