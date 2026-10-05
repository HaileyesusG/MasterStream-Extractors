/**
 * VidSrcMeExtractor — repurposed as YoTurkish extractor
 *
 * Source: https://yoturkish.to
 * Content: Turkish TV series (dizi) with English subtitles.
 *
 * Supported calling conventions:
 *   Mobile (4-param): extract(tmdbId, isTv, season, episode)
 *   TV app (7-param): extract(tmdbId, imdbId, title, isTv, season, episode, year)
 */
(function () {
  'use strict';

  var TAG = '[VidSrcMeExtractor]';
  var YOTURKISH_BASE = 'https://yoturkish.to';
  var TMDB_KEY = 'a2dc7e427ce7dc4a54a518f239a51909';
  var UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36';

  // Decryption constants — reverse-engineered from yoturkish.to/all.js _step2Init()
  var DECODE_KEY = [86, 110, 51, 72, 106, 87, 56, 102];
  var DECODE_SHIFT = 5;

  // ─── Utilities ──────────────────────────────────────────────────────────────

  function b64decode(str) {
    if (typeof atob === 'function') {
      return atob(str);
    }
    // Node / Hermes fallback
    return Buffer.from(str, 'base64').toString('binary');
  }

  function getHost(url) {
    try { return url.split('/')[2] || ''; } catch (e) { return ''; }
  }

  function getOrigin(url) {
    try { return url.split('/').slice(0, 3).join('/'); } catch (e) { return ''; }
  }

  async function fetchText(url, referer, extraHeaders) {
    try {
      var headers = Object.assign({ 'User-Agent': UA, 'Referer': referer || YOTURKISH_BASE + '/' }, extraHeaders || {});
      var res = await fetch(url, { headers: headers });
      if (!res.ok) {
        console.warn(TAG + ' HTTP ' + res.status + ' for ' + url.slice(0, 70));
        return null;
      }
      return await res.text();
    } catch (e) {
      console.warn(TAG + ' fetch error: ' + (e.message || e));
      return null;
    }
  }

  // ─── Player payload decoder ─────────────────────────────────────────────────

  /**
   * Decodes a data-sN attribute value into an iframe HTML string.
   * Algorithm (from _step2Init in all.js):
   *   1. Remove all '|' characters
   *   2. base64-decode
   *   3. Reverse the string
   *   4. Shift each char: (code - DECODE_SHIFT + 256) % 256
   *   5. XOR each char against cycling DECODE_KEY
   */
  function decodePlayerData(encoded) {
    try {
      var raw = encoded.replace(/\|/g, '');
      var bin = b64decode(raw);

      // Reverse
      var reversed = '';
      for (var i = bin.length - 1; i >= 0; i--) {
        reversed += bin[i];
      }

      // Shift
      var shifted = '';
      for (var i = 0; i < reversed.length; i++) {
        shifted += String.fromCharCode((reversed.charCodeAt(i) - DECODE_SHIFT + 256) % 256);
      }

      // XOR with key
      var result = '';
      for (var i = 0; i < shifted.length; i++) {
        result += String.fromCharCode(shifted.charCodeAt(i) ^ DECODE_KEY[i % DECODE_KEY.length]);
      }
      return result;
    } catch (e) {
      return '';
    }
  }

  function extractIframeSrc(iframeHtml) {
    var m = iframeHtml.match(/src="([^"]+)"/);
    return m ? m[1] : null;
  }

  // ─── Stream extractors per player host ─────────────────────────────────────

  /**
   * kitraskimisi.com — embedded JW Player with direct m3u8 in the page source.
   * Verified: works consistently across all episodes.
   */
  async function extractKitraskimisi(embedUrl) {
    var html = await fetchText(embedUrl, YOTURKISH_BASE + '/');
    if (!html) return null;
    var patterns = [
      /["']([^"']+\.m3u8[^"']*)/,
      /sources\s*:\s*\[\s*\{\s*file\s*:\s*["']([^"']+)/,
      /file\s*:\s*["']([^"']+\.m3u8[^"']*)/,
    ];
    for (var k = 0; k < patterns.length; k++) {
      var m = html.match(patterns[k]);
      if (m && m[1] && m[1].indexOf('http') === 0) {
        return { url: m[1], referer: getOrigin(embedUrl) + '/' };
      }
    }
    return null;
  }

  /**
   * vidmoly.biz — JW Player with sources array containing the m3u8.
   */
  async function extractVidmoly(embedUrl) {
    var html = await fetchText(embedUrl, YOTURKISH_BASE + '/');
    if (!html) return null;
    var m = html.match(/sources\s*:\s*\[\s*\{\s*file\s*:\s*["']([^"']+)/) ||
             html.match(/["']([^"']+\.m3u8[^"']*)/);
    if (!m || m[1].indexOf('http') !== 0) return null;
    return { url: m[1], referer: 'https://vidmoly.biz/' };
  }

  /**
   * Unpack the Dean Edwards p,a,c,k,e,d JS obfuscator.
   * Used by engifuosi.com (Filemoon-family) to hide the m3u8.
   */
  function unpackPACKED(html) {
    var packedStart = html.indexOf('eval(function(p,a,c,k,e,d)');
    if (packedStart === -1) return null;
    var block = html.slice(packedStart, packedStart + 8000);
    var m = block.match(/\}\('([\s\S]+?)',(\d+),(\d+),'([\s\S]+?)'\.split\('\|'\)/);
    if (!m) return null;
    var p = m[1], a = parseInt(m[2]), c = parseInt(m[3]);
    var k = m[4].split('|');
    var e = function (n) { return n.toString(a > 10 ? 36 : a); };
    while (c--) {
      if (k[c]) p = p.replace(new RegExp('\\b' + e(c) + '\\b', 'g'), k[c]);
    }
    return p;
  }

  /**
   * engifuosi.com / Filemoon — uses p,a,c,k,e,d packer hiding the m3u8 URL.
   */
  async function extractEngifuosi(embedUrl) {
    var html = await fetchText(embedUrl, YOTURKISH_BASE + '/');
    if (!html) return null;
    var unpacked = unpackPACKED(html) || html;
    var m = unpacked.match(/["']([^"']+\.m3u8[^"']*)/) ||
            unpacked.match(/file["']?\s*:\s*["']([^"']+)/);
    if (!m || m[1].indexOf('http') !== 0) return null;
    return { url: m[1], referer: getOrigin(embedUrl) + '/' };
  }

  async function tryExtractStream(iframeSrc) {
    if (!iframeSrc || iframeSrc === '#' || iframeSrc === 'about:blank') return null;
    var host = getHost(iframeSrc);
    try {
      if (host.indexOf('kitra') !== -1) {
        return await extractKitraskimisi(iframeSrc);
      }
      if (host.indexOf('vidmoly') !== -1) {
        return await extractVidmoly(iframeSrc);
      }
      if (host.indexOf('engifuosi') !== -1 || host.indexOf('filemoon') !== -1 ||
          host.indexOf('fembed') !== -1 || host.indexOf('moonplayer') !== -1) {
        return await extractEngifuosi(iframeSrc);
      }
      // Generic fallback: try direct m3u8 first, then p,a,c,k,e,d unpack
      var result = await extractKitraskimisi(iframeSrc);
      if (result) return result;
      return await extractEngifuosi(iframeSrc);
    } catch (e) {
      console.warn(TAG + ' player error [' + host + ']: ' + (e.message || e));
      return null;
    }
  }

  // ─── YoTurkish page logic ───────────────────────────────────────────────────

  function normalizeTitle(t) {
    // Lowercase, strip punctuation/special chars, collapse spaces
    return (t || '').toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
  }

  function titleScore(query, candidate) {
    var q = normalizeTitle(query);
    var c = normalizeTitle(candidate);
    if (c === q) return 100;
    if (c.indexOf(q) !== -1) return 80;
    // Word overlap
    var qWords = q.split(' ');
    var cWords = c.split(' ');
    var overlap = 0;
    for (var i = 0; i < qWords.length; i++) {
      if (qWords[i].length > 2 && cWords.indexOf(qWords[i]) !== -1) overlap++;
    }
    return overlap * 20;
  }

  async function searchSeries(rawTitle) {
    // Strip colons and other special chars that break the search
    var query = rawTitle.replace(/[:\-\u2013\u2014]/g, ' ').replace(/\s+/g, ' ').trim();
    var url = YOTURKISH_BASE + '/wp-admin/admin-ajax.php?action=searchwp_live_search&swpquery=' + encodeURIComponent(query);
    var html = await fetchText(url, YOTURKISH_BASE + '/');
    if (!html) return null;

    // Collect ALL ss-title results and pick the best match
    var regex = /<a\s+href="([^"]+)"\s+class="ss-title">([^<]+)<\/a>/g;
    var m;
    var best = null;
    var bestScore = 0;
    while ((m = regex.exec(html)) !== null) {
      var candidate = m[2].trim();
      var score = titleScore(rawTitle, candidate);
      if (score > bestScore) {
        bestScore = score;
        best = { seriesUrl: m[1], title: candidate };
      }
    }
    if (!best || bestScore === 0) return null;
    return best;
  }

  /**
   * Calculates the absolute (sequential) episode number used by yoturkish.to.
   * The site numbers episodes from 1 continuously across all seasons.
   * For S1 we can use the episode number directly.
   * For S2+ we sum episode counts of all preceding seasons via TMDB.
   */
  async function resolveAbsoluteEpisode(tmdbId, season, episode) {
    if (season <= 1) return episode;
    var total = 0;
    for (var s = 1; s < season; s++) {
      try {
        var url = 'https://api.themoviedb.org/3/tv/' + tmdbId + '/season/' + s + '?api_key=' + TMDB_KEY;
        var res = await fetch(url);
        if (res.ok) {
          var data = await res.json();
          total += (data.episodes ? data.episodes.length : 0);
        }
      } catch (e) { /* continue */ }
    }
    return total + episode;
  }

  async function fetchTmdbTitle(tmdbId) {
    try {
      var url = 'https://api.themoviedb.org/3/tv/' + tmdbId + '?api_key=' + TMDB_KEY;
      var res = await fetch(url);
      if (!res.ok) return null;
      var data = await res.json();
      return data.name || data.original_name || null;
    } catch (e) { return null; }
  }

  /**
   * Decodes all data-sN attributes in an episode page and returns
   * iframe src URLs in priority order:
   *   kitraskimisi (direct m3u8) → vidmoly (direct m3u8) → engifuosi (packed) → rest
   */
  function decodePagePlayers(episodeHtml) {
    var regex = /data-s\d+="([^"]+)"/g;
    var m;
    var kitra = [];
    var vidmoly = [];
    var engifuosi = [];
    var others = [];

    while ((m = regex.exec(episodeHtml)) !== null) {
      var decoded = decodePlayerData(m[1]);
      var src = extractIframeSrc(decoded);
      if (!src || src === '#' || src === 'about:blank') continue;
      var host = getHost(src);
      if (host.indexOf('kitra') !== -1) {
        kitra.push(src);
      } else if (host.indexOf('vidmoly') !== -1) {
        vidmoly.push(src);
      } else if (host.indexOf('engifuosi') !== -1 || host.indexOf('filemoon') !== -1) {
        engifuosi.push(src);
      } else {
        others.push(src);
      }
    }

    // Priority: kitraskimisi → vidmoly → engifuosi/filemoon → rest
    return kitra.concat(vidmoly, engifuosi, others);
  }

  // ─── Main extraction entry-point ────────────────────────────────────────────

  async function extract(tmdbId, arg1, arg2, arg3, arg4, arg5 /*, arg6 */) {
    // Detect calling convention:
    //   4-param (mobile): extract(tmdbId, isTv, season, episode)
    //   7-param (TV app): extract(tmdbId, imdbId, title, isTv, season, episode, year)
    var isTv, season, episode, title;
    if (typeof arg1 === 'boolean') {
      // Mobile 4-param
      isTv   = arg1;
      season  = arg2;
      episode = arg3;
      title   = null;
    } else {
      // TV app 7-param
      // arg1 = imdbId, arg2 = title, arg3 = isTv, arg4 = season, arg5 = episode
      isTv    = arg3;
      season  = arg4;
      episode = arg5;
      title   = arg2 || null;
    }

    try {
      // yoturkish.to is a Turkish TV-series-only site — skip movies
      if (!isTv) {
        console.log(TAG + ' \u23ed\ufe0f Skipping movie — yoturkish.to is Turkish series only');
        return null;
      }

      console.log(TAG + ' \ud83c\uddf9\ud83c\uddf7 Searching Turkish series for tmdbId=' + tmdbId + ' S' + season + 'E' + episode);

      // 1. Resolve title
      if (!title) {
        title = await fetchTmdbTitle(tmdbId);
      }
      if (!title) {
        console.warn(TAG + ' \u274c Could not resolve title for tmdbId=' + tmdbId);
        return null;
      }

      console.log(TAG + ' \ud83d\udd0d Searching for: "' + title + '"');

      // 2. Find series on yoturkish.to
      var searchResult = await searchSeries(title);
      if (!searchResult) {
        console.log(TAG + ' \u274c Not found on yoturkish.to: "' + title + '"');
        return null;
      }
      console.log(TAG + ' \u2705 Found: "' + searchResult.title + '" \u2192 ' + searchResult.seriesUrl);

      // 3. Resolve absolute episode number
      var absoluteEp = await resolveAbsoluteEpisode(tmdbId, season, episode);
      console.log(TAG + ' \ud83d\udcfa S' + season + 'E' + episode + ' \u2192 absolute episode #' + absoluteEp);

      // 4. Build episode URL and fetch
      var seriesSlug = searchResult.seriesUrl.replace(/\/$/, '').split('/').pop();
      var episodeUrl = YOTURKISH_BASE + '/' + seriesSlug + '-episode-' + absoluteEp + '/';
      console.log(TAG + ' \ud83d\udcc4 Fetching: ' + episodeUrl);

      var episodeHtml = await fetchText(episodeUrl, YOTURKISH_BASE + '/');
      if (!episodeHtml || episodeHtml.length < 1000) {
        console.warn(TAG + ' \u274c Episode page empty or not found');
        return null;
      }

      // 5. Decode embedded player URLs
      var iframeSrcs = decodePagePlayers(episodeHtml);
      console.log(TAG + ' \ud83c\udfa5 ' + iframeSrcs.length + ' players decoded');

      if (iframeSrcs.length === 0) {
        console.warn(TAG + ' \u274c No player sources found in page');
        return null;
      }

      // 6. Try each player in priority order
      for (var i = 0; i < iframeSrcs.length; i++) {
        var src = iframeSrcs[i];
        console.log(TAG + ' \ud83d\udd17 Trying player [' + (i + 1) + '/' + iframeSrcs.length + ']: ' + src.slice(0, 70));
        var streamData = await tryExtractStream(src);
        if (streamData && streamData.url) {
          console.log(TAG + ' \u2705 Stream found: ' + streamData.url.slice(0, 80));
          return {
            url: streamData.url,
            quality: 'Auto',
            provider: 'VidSrcMe',
            headers: {
              'User-Agent': UA,
              'Referer': streamData.referer,
              'Origin': (streamData.referer || '').replace(/\/$/, ''),
            },
            subtitles: [],
          };
        }
      }

      console.warn(TAG + ' \u274c All players exhausted for ' + episodeUrl);
      return null;

    } catch (e) {
      console.error(TAG + ' \ud83d\udca5 Fatal: ' + (e.message || e));
      return null;
    }
  }

  // ─── Exports ────────────────────────────────────────────────────────────────

  var extractor = { extract: extract };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = extractor;
  }

  var gObj = typeof globalThis !== 'undefined' ? globalThis
    : typeof window !== 'undefined' ? window
    : typeof global !== 'undefined' ? global
    : this;
  if (gObj) {
    gObj.VidSrcMeExtractor = extractor;
  }
})();
