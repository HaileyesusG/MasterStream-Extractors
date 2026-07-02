(function () {
  'use strict';

  /**
   * VidSrcExtractor.js
   * Domain: https://vidsrc.xyz
   * Flow:
   *   1. Build embed URL → fetch HTML → parse #player_iframe src (iframe1)
   *   2. Fetch iframe1 → parse inner src (iframe2)
   *   3. Fetch iframe2 → extract encoded file data
   *   4. Decode: replace /{v[0-9]+}/i with 'shadowlandschronicles.com' → find tmstr URL
   */

  const BASE_URL = 'https://vidsrc.xyz';
  const UA       = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36';

  async function httpGet(url, referer) {
    const headers = { 'User-Agent': UA };
    if (referer) headers['Referer'] = referer;
    try {
      const res = await fetch(url, { headers });
      if (!res.ok) return null;
      return res.text();
    } catch (e) {
      console.log('[VidSrc] ❌ GET ' + url + ' failed: ' + e.message);
      return null;
    }
  }

  function parseIframeSrc(html, baseHost) {
    // Pattern 1: src: '...'
    let m = html.match(/src\s*:\s*'([^']+)/);
    if (m) return m[1];
    // Pattern 2: src: "..."
    m = html.match(/src\s*:\s*"([^"]+)/);
    if (m) return m[1];
    // Pattern 3: <iframe src="...">
    m = html.match(/<iframe[^>]+src=["']([^"']+)["']/i);
    if (m) return m[1];
    // Pattern 4: /prorcp/ or /rcp/ URL
    m = html.match(/(https?:\/\/[^"'\s]+\/(?:pro)?rcp\/[^"'\s]+)/);
    if (m) return m[1];
    return null;
  }

  function resolveUrl(src, base, baseHost) {
    if (!src) return null;
    if (src.startsWith('//')) return 'https:' + src;
    if (src.startsWith('/')) return 'https://' + baseHost + src;
    if (!src.startsWith('http')) return BASE_URL + src;
    return src;
  }

  function getHost(url) {
    try { return new URL(url).host; } catch (e) { return ''; }
  }

  async function extract(tmdbId, isTv, season, episode) {
    try {
      // Step 1: Embed page
      const embedUrl = isTv
        ? BASE_URL + '/embed/tv/' + tmdbId + '/' + season + '-' + episode
        : BASE_URL + '/embed/' + tmdbId;

      console.log('[VidSrc] 🚀 Fetching: ' + embedUrl);
      const embedHtml = await httpGet(embedUrl);
      if (!embedHtml) return null;

      // Parse #player_iframe
      const parser = new DOMParser();
      const doc = parser.parseFromString(embedHtml, 'text/html');
      let iframe1Src = doc.querySelector('#player_iframe') && doc.querySelector('#player_iframe').getAttribute('src');
      if (!iframe1Src) {
        // Fallback: regex
        const m = embedHtml.match(/id=["']player_iframe["'][^>]+src=["']([^"']+)["']/i)
               || embedHtml.match(/src=["']([^"']+)["'][^>]+id=["']player_iframe["']/i);
        if (m) iframe1Src = m[1];
      }
      if (!iframe1Src) { console.log('[VidSrc] ❌ No #player_iframe found'); return null; }
      iframe1Src = resolveUrl(iframe1Src, embedUrl, getHost(embedUrl));

      console.log('[VidSrc] 🔍 iframe1: ' + iframe1Src);

      // Step 2: Iframe 1
      const iframe1Html = await httpGet(iframe1Src, embedUrl);
      if (!iframe1Html) return null;

      let iframe2Src = parseIframeSrc(iframe1Html, getHost(iframe1Src));
      if (!iframe2Src) { console.log('[VidSrc] ❌ No iframe2 src found'); return null; }
      iframe2Src = resolveUrl(iframe2Src, iframe1Src, getHost(iframe1Src));

      console.log('[VidSrc] 🔍 iframe2: ' + iframe2Src);

      // Step 3: Iframe 2 → encoded file data
      const iframe2Html = await httpGet(iframe2Src, iframe1Src);
      if (!iframe2Html) return null;

      const fileMatch = iframe2Html.match(/file\s*:\s*"([^"]+)/);
      if (!fileMatch) { console.log('[VidSrc] ❌ No encoded file data found'); return null; }
      const dataEncoded = fileMatch[1];

      // Step 4: Decode — split by " or ", replace {v[0-9]+} pattern
      const parts = dataEncoded.split(' or ');
      for (const part of parts) {
        const decoded = part.replace(/\{v[0-9]+\}/gi, 'shadowlandschronicles.com');
        if (decoded.includes('tmstr')) {
          console.log('[VidSrc] ✅ Found stream: ' + decoded.substring(0, 60));
          const iframe2Host = getHost(iframe2Src);
          return {
            url:     decoded,
            quality: 'Auto',
            provider: 'VidSrc',
            headers: {
              'Referer':    iframe2Src,
              'User-Agent': UA,
              'Origin':     iframe2Host ? 'https://' + iframe2Host : ''
            }
          };
        }
      }

      console.log('[VidSrc] ⚠️ Decoded data did not contain expected tmstr stream');
      return null;

    } catch (e) {
      console.log('[VidSrc] ❌ Fatal error: ' + e.message);
      return null;
    }
  }

  module.exports = { extract };
})();
