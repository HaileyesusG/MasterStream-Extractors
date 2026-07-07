/**
 * LordFlixExtractor — self-contained CommonJS JS for remote hot-update.
 * Uses the new vixsrc.to Next.js API logic (replaced old LordFlix logic).
 */
(function () {
  var TAG = '[LordFlixExtractor]';
  var DOMAIN = 'https://vixsrc.to';
  var USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

  function regexFirst(input, pattern) {
    var match = input.match(new RegExp(pattern, 'i'));
    return match ? match[1] : null;
  }

  async function fetchGet(url, headers) {
    try {
      var response = await fetch(url, { headers: headers, redirect: 'follow' });
      return response;
    } catch (e) {
      console.warn(TAG + ' ❌ Network error: ' + e.message);
      return null;
    }
  }

  async function extract(tmdbId, imdbId, title, isTv, season, episode, year) {
    try {
      var baseHeaders = {
        'User-Agent': USER_AGENT,
        'Referer': DOMAIN + '/',
        'Origin': DOMAIN
      };

      // 1. Build API URL
      var apiUrl = isTv
        ? DOMAIN + '/api/tv/' + tmdbId + '/' + season + '/' + episode
        : DOMAIN + '/api/movie/' + tmdbId;

      console.log(TAG + ' 🚀 Fetching API: ' + apiUrl);

      // 2. Fetch API detail page
      var apiHeaders = Object.assign({}, baseHeaders, {
        'Accept': '*/*',
        'X-Requested-With': 'XMLHttpRequest'
      });
      var apiRes = await fetchGet(apiUrl, apiHeaders);

      if (!apiRes || !apiRes.ok) {
        console.warn(TAG + ' ❌ API HTTP Error');
        return null;
      }

      var apiData = await apiRes.json();
      if (!apiData || !apiData.src) {
        console.warn(TAG + ' ❌ No src in API response');
        return null;
      }

      var embedUrl = DOMAIN + apiData.src;
      console.log(TAG + ' 🔗 Found embed URL: ' + embedUrl);

      // Extract cookies if any are set by the API
      var setCookieHeader = apiRes.headers.get('set-cookie') || '';
      var cookiesArray = setCookieHeader.split(/,(?=\s*[A-Za-z0-9_]+\=)/);
      var cookies = cookiesArray.map(function(c) { return c.split(';')[0].trim(); }).join('; ');

      // 3. Fetch Embed HTML
      var embedHeaders = Object.assign({}, baseHeaders, {
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Cookie': cookies
      });
      var embedRes = await fetchGet(embedUrl, embedHeaders);

      if (!embedRes || !embedRes.ok) {
        console.warn(TAG + ' ❌ Embed HTTP Error');
        return null;
      }

      var embedHtml = await embedRes.text();

      // 4. Regex for token and expires
      var token = regexFirst(embedHtml, "'token' *: *'([^']+)");
      var expires = regexFirst(embedHtml, "'expires' *: *'([^']+)");
      var sourceIdMatch = embedUrl.match(/\/embed\/(\d+)/);
      var sourceId = sourceIdMatch ? sourceIdMatch[1] : null;

      if (!token || !expires || !sourceId) {
        console.warn(TAG + ' ❌ Failed to parse tokens or sourceId from embed HTML');
        return null;
      }

      console.log(TAG + ' 🔑 Tokens found: token=' + token + ', expires=' + expires + ', sourceId=' + sourceId);

      // 5. Build Final Playlist URL
      var finalPlaylistUrl = DOMAIN + '/playlist/' + sourceId + '?token=' + token + '&expires=' + expires + '&h=1&lang=en';
      console.log(TAG + ' ✅ Final Playlist URL: ' + finalPlaylistUrl);

      return {
        url: finalPlaylistUrl,
        quality: 'Auto',
        provider: 'LordFlix',
        headers: {
          'User-Agent': USER_AGENT,
          'Referer': DOMAIN + '/',
          'Cookie': cookies
        },
        subtitles: []
      };
    } catch (e) {
      console.error(TAG + ' 💥 Error: ' + e.message);
      return null;
    }
  }

  return {
    extract: extract,
    getName: function() { return 'LordFlix'; }
  };
})();
