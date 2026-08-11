/**
 * LordFlixExtractor — self-contained CommonJS JS for remote hot-update.
 * Hosted at: HaileyesusG/MasterStream-Extractors/extractors/LordFlixExtractor.js
 *
 * To update: edit this file, run Update-Manifest.ps1, commit and push.
 * The app will pick it up within 1 hour (or on next cold start).
 *
 * Domain: https://vixsrc.to
 * Flow: Fetch API → Get Embed URL → Fetch Embed HTML → Parse master URL + tokens → Build Playlist URL
 *
 * KEY FIX: TV shows use a base playlist URL with ?b=1 (e.g. /playlist/629736?b=1).
 * The old code discarded this and built /playlist/629736?token=...&expires=...
 * which caused HTTP 403 on every TV episode. We now read the URL directly from
 * window.masterPlaylist.url in the embed HTML so those params are preserved.
 */
(function () {
  var TAG = '[LordFlixExtractor]';
  var DOMAIN = 'https://vixsrc.to';
  var USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

  function regexFirst(input, pattern) {
    var match = input.match(new RegExp(pattern, 'i'));
    return match ? match[1] : null;
  }

  async function extract(tmdbId, imdbId, title, isTv, season, episode, year) {
    try {
      // Normalize isTv — could arrive as boolean, string 'true', 'tv', 'movie' etc.
      var isTvShow = isTv === true || String(isTv) === 'true' || String(isTv) === 'tv';

      var baseHeaders = {
        'User-Agent': USER_AGENT,
        'Referer': DOMAIN + '/',
        'Origin': DOMAIN,
      };

      // 1. Build API URL
      var apiUrl = isTvShow
        ? DOMAIN + '/api/tv/' + tmdbId + '/' + season + '/' + episode
        : DOMAIN + '/api/movie/' + tmdbId;

      console.log(TAG + ' \uD83D\uDE80 Fetching API: ' + apiUrl);

      // 2. Fetch API detail page
      var apiRes = await fetch(apiUrl, {
        headers: Object.assign({}, baseHeaders, {
          'Accept': '*/*',
          'X-Requested-With': 'XMLHttpRequest',
        }),
      });

      if (!apiRes.ok) {
        console.warn(TAG + ' \u274C API HTTP ' + apiRes.status);
        return null;
      }

      var apiData = await apiRes.json();
      if (!apiData || !apiData.src) {
        console.warn(TAG + ' \u274C No src in API response');
        return null;
      }

      var embedUrl = DOMAIN + apiData.src;
      console.log(TAG + ' \uD83D\uDD17 Found embed URL: ' + embedUrl);

      // Extract and parse cookies properly to prevent Cloudflare 403
      var setCookieHeader = apiRes.headers.get('set-cookie') || '';
      var cookiesArray = setCookieHeader.split(/,(?=\s*[A-Za-z0-9_]+=)/);
      var cookies = cookiesArray.map(function (c) { return c.split(';')[0].trim(); }).filter(Boolean).join('; ');

      var embedHeaders = Object.assign({}, baseHeaders, {
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
      });
      if (cookies) {
        embedHeaders['Cookie'] = cookies;
      }

      // 3. Fetch Embed HTML
      var embedRes = await fetch(embedUrl, { headers: embedHeaders });

      if (!embedRes.ok) {
        console.warn(TAG + ' \u274C Embed HTTP ' + embedRes.status);
        return null;
      }

      var embedHtml = await embedRes.text();

      // 4. Parse tokens and base playlist URL from window.masterPlaylist in embed HTML
      // The base URL contains provider-specific query params (e.g. ?b=1 for TV shows)
      // that MUST be preserved — omitting them causes HTTP 403.
      var masterUrlMatch = regexFirst(embedHtml, "url\\s*:\\s*['\"]([^'\"]+)['\"]");
      var token = regexFirst(embedHtml, "['\"]?token['\"]?\\s*:\\s*['\"]([^'\"]+)");
      var expires = regexFirst(embedHtml, "['\"]?expires['\"]?\\s*:\\s*['\"]([^'\"]+)");

      var basePlaylistUrl = masterUrlMatch;
      if (!basePlaylistUrl) {
        // Fallback: build from sourceId in the embed URL
        var sourceIdMatch = embedUrl.match(/\/embed\/([^/?#]+)/);
        var sourceId = sourceIdMatch ? sourceIdMatch[1] : null;
        if (sourceId) {
          basePlaylistUrl = DOMAIN + '/playlist/' + sourceId;
        }
      }

      if (!basePlaylistUrl || !token || !expires) {
        console.warn(TAG + ' \u274C Failed to parse playlist parameters from embed HTML (masterUrl=' + basePlaylistUrl + ', token=' + token + ', expires=' + expires + ')');
        return null;
      }

      // Ensure absolute URL and unescape any backslash-escaped slashes in JSON output
      if (basePlaylistUrl.charAt(0) === '/') {
        basePlaylistUrl = DOMAIN + basePlaylistUrl;
      }
      basePlaylistUrl = basePlaylistUrl.replace(/\\/g, '');

      // 5. Append token, expires, h=1, lang=en — preserving base query params
      var joinChar = basePlaylistUrl.indexOf('?') !== -1 ? '&' : '?';
      var finalPlaylistUrl = basePlaylistUrl + joinChar + 'token=' + token + '&expires=' + expires + '&h=1&lang=en';

      console.log(TAG + ' \u2705 Final Playlist URL: ' + finalPlaylistUrl);

      var resultHeaders = {
        'User-Agent': USER_AGENT,
        'Referer': DOMAIN + '/',
      };
      if (cookies) {
        resultHeaders['Cookie'] = cookies;
      }

      return {
        url: finalPlaylistUrl,
        quality: 'Auto',
        provider: 'LordFlix',
        headers: resultHeaders,
        subtitles: [],
      };
    } catch (e) {
      console.error(TAG + ' \uD83D\uDCA5 Error: ' + (e && e.message ? e.message : String(e)));
      return null;
    }
  }

  module.exports = { extract: extract };
})();
