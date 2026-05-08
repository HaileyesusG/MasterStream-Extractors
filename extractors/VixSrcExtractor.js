/**
 * VixSrcExtractor — self-contained CommonJS JS for remote hot-update.
 * Hosted at: HaileyesusG/MasterStream-Extractors/extractors/VixSrcExtractor.js
 */
(function () {
  var TAG = '[VixSrcExtractor]';
  var DOMAIN = 'https://vixsrc.to';
  var USER_AGENT =
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36';

  function regexFirst(input, pattern) {
    var match = input.match(new RegExp(pattern, 'i'));
    return match ? match[1] : null;
  }

  async function fetchUrl(url, headers) {
    try {
      var response = await fetch(url, { headers: headers, redirect: 'follow' });
      if (!response.ok) {
        console.warn(TAG + ' ❌ HTTP ' + response.status + ' for ' + url);
        return null;
      }
      return await response.text();
    } catch (e) {
      console.warn(TAG + ' ❌ Network error: ' + e.message);
      return null;
    }
  }

  async function extract(tmdbId, isTv, season, episode, useH1) {
    try {
      var headers = {
        'User-Agent': USER_AGENT,
        Referer: DOMAIN + '/',
        Origin: DOMAIN,
      };

      var urlSearch = isTv
        ? DOMAIN + '/tv/' + tmdbId + '/' + season + '/' + episode
        : DOMAIN + '/movie/' + tmdbId;

      console.log(TAG + ' 🚀 Starting extraction: ' + urlSearch);

      var htmlDetail = await fetchUrl(urlSearch, headers);
      if (!htmlDetail) return null;

      var urlDirect = regexFirst(htmlDetail, "url *: *'([^']+)");
      if (!urlDirect) {
        console.warn(TAG + ' ❌ No url found in page');
        return null;
      }

      var token = regexFirst(htmlDetail, "'token' *: *'([^']+)");
      if (!token) {
        console.warn(TAG + ' ❌ No token found');
        return null;
      }

      var expires = regexFirst(htmlDetail, "'expires' *: *'([^']+)");
      if (!expires) {
        console.warn(TAG + ' ❌ No expires found');
        return null;
      }

      var separator = urlDirect.includes('?') ? '&' : '?';
      var h1Param = useH1 ? '&h=1' : '';
      var buildUrlDirect = urlDirect + separator + 'token=' + token + '&expires=' + expires + h1Param + '&lang=en';

      var htmlDirect = await fetchUrl(buildUrlDirect, headers);
      var finalBuildUrl = buildUrlDirect;

      if (!htmlDirect) {
        console.log(TAG + ' 🔄 Retrying with h=1...');
        finalBuildUrl = urlDirect + separator + 'token=' + token + '&expires=' + expires + '&h=1&lang=en';
        htmlDirect = await fetchUrl(finalBuildUrl, headers);
        if (!htmlDirect) return null;
      }

      var videoPattern = /^https:\/\/vixsrc\.to\/playlist\/.*?type=video.*?$/gm;
      var qualityCount = (htmlDirect.match(videoPattern) || []).length;

      if (qualityCount === 0) {
        console.warn(TAG + ' ❌ No quality variants found in M3U8');
        return null;
      }

      console.log(TAG + ' ✅ Master M3U8 has ' + qualityCount + ' quality variants');

      return {
        url: finalBuildUrl,
        quality: 'Auto',
        provider: 'VixSrc',
        headers: headers,
        subtitles: [],
      };
    } catch (e) {
      console.error(TAG + ' 💥 Error during extraction', e);
      return null;
    }
  }

  module.exports = { extract: extract };
})();
