(function () {
  'use strict';

  /**
   * VidSrcMeExtractor.js
   * Domain: https://vidsrcme.ru
   * Flow:
   *   1. Build embed URL → fetch HTML → parse #player_iframe src (iframe1)
   *   2. Fetch iframe1 → parse inner src (iframe2, a prorcp URL)
   *   3. Fetch iframe2 → extract var master_urls with __TOKEN__ / __TOKENPG__ placeholders
   *   4. Hydrate tokens via generate.php endpoints → return first m3u8 stream URL
   *
   * Hosted at: HaileyesusG/MasterStream-Extractors/extractors/VidSrcMeExtractor.js
   * To update: edit this file, run Update-Manifest.ps1, commit and push.
   */

  var BASE_URL = 'https://vidsrcme.ru';
  var UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36';

  async function httpGet(url, referer) {
    var headers = { 'User-Agent': UA };
    if (referer) headers['Referer'] = referer;
    try {
      var res = await fetch(url, { headers: headers });
      if (!res.ok) return null;
      return await res.text();
    } catch (e) {
      console.log('[VidSrcMe] \u274c GET ' + url + ' failed: ' + e.message);
      return null;
    }
  }

  function getHost(url) {
    try { return new URL(url).host; } catch (e) { return ''; }
  }

  function resolveUrl(src, baseHost) {
    if (!src) return null;
    if (src.startsWith('//')) return 'https:' + src;
    if (src.startsWith('/')) return 'https://' + baseHost + src;
    if (!src.startsWith('http')) return BASE_URL + src;
    return src;
  }

  async function extract(tmdbId, imdbId, title, isTv, season, episode, year) {
    try {
      // Step 1: Build embed URL and parse #player_iframe
      var embedUrl = isTv
        ? BASE_URL + '/embed/tv/' + tmdbId + '/' + season + '/' + episode
        : BASE_URL + '/embed/' + tmdbId;

      console.log('[VidSrcMe] \ud83d\ude80 Fetching: ' + embedUrl);
      var embedHtml = await httpGet(embedUrl);
      if (!embedHtml) return null;

      var m1 = embedHtml.match(/id=["']player_iframe["'][^>]+src=["']([^"']+)["']/i)
             || embedHtml.match(/src=["']([^"']+)["'][^>]+id=["']player_iframe["']/i);
      if (!m1) { console.log('[VidSrcMe] \u274c No #player_iframe found'); return null; }
      var iframe1Src = resolveUrl(m1[1], getHost(embedUrl));
      console.log('[VidSrcMe] \ud83d\udd0d iframe1: ' + iframe1Src);

      // Step 2: Fetch iframe1 → parse iframe2 src
      var iframe1Html = await httpGet(iframe1Src, embedUrl);
      if (!iframe1Html) return null;

      var iframe2Src = null;
      var iframe2Patterns = [
        /src\s*:\s*'([^']+)/,
        /src\s*:\s*"([^"]+)/,
        /<iframe[^>]+src=["']([^"']+)["']/i,
        /(https?:\/\/[^"'\s]+\/(?:pro)?rcp\/[^"'\s]+)/
      ];
      for (var i = 0; i < iframe2Patterns.length; i++) {
        var m = iframe1Html.match(iframe2Patterns[i]);
        if (m) { iframe2Src = m[1]; break; }
      }
      if (!iframe2Src) { console.log('[VidSrcMe] \u274c No iframe2 src found'); return null; }
      iframe2Src = resolveUrl(iframe2Src, getHost(iframe1Src));
      console.log('[VidSrcMe] \ud83d\udd0d iframe2: ' + iframe2Src);

      // Step 3: Fetch iframe2 → extract master_urls
      var iframe2Html = await httpGet(iframe2Src, iframe1Src);
      if (!iframe2Html) return null;

      var urlsMatch = iframe2Html.match(/var\s+master_urls\s*=\s*"([^"]+)"/);
      if (!urlsMatch) { console.log('[VidSrcMe] \u274c No master_urls found'); return null; }
      var masterUrls = urlsMatch[1];

      // Step 4: Hydrate __TOKENPG__ (putgate CDN)
      if (masterUrls.indexOf('__TOKENPG__') !== -1) {
        var pgToken = await httpGet('https://app2.putgate.com/generate.php');
        if (pgToken) masterUrls = masterUrls.split('__TOKENPG__').join(pgToken.trim());
      }

      // Hydrate __TOKEN__ (amalgam CDN) — fetch from same host as first URL
      if (masterUrls.indexOf('__TOKEN__') !== -1) {
        var hostMatch = masterUrls.match(/https?:\/\/([^\/]+)/);
        if (hostMatch) {
          var aToken = await httpGet('https://' + hostMatch[1] + '/generate.php');
          if (aToken) masterUrls = masterUrls.split('__TOKEN__').join(aToken.trim());
        }
      }

      // Step 5: Return first valid stream URL
      var urlList = masterUrls.split(' or ');
      for (var j = 0; j < urlList.length; j++) {
        var streamUrl = urlList[j].trim();
        if (streamUrl && streamUrl.startsWith('http')) {
          console.log('[VidSrcMe] \u2705 Found stream: ' + streamUrl.substring(0, 80));
          return {
            url: streamUrl,
            quality: 'Auto',
            provider: 'VidSrcMe',
            headers: {
              'Referer': iframe2Src,
              'User-Agent': UA,
              'Origin': 'https://' + getHost(iframe2Src)
            },
            subtitles: []
          };
        }
      }

      console.log('[VidSrcMe] \u26a0\ufe0f No valid stream URL in master_urls');
      return null;

    } catch (e) {
      console.log('[VidSrcMe] \u274c Fatal error: ' + e.message);
      return null;
    }
  }

  module.exports = { extract: extract };
})();
