/**
 * VidSrcMeExtractor — remote hot-update stub
 * Domain: https://vidsrcme.ru
 *
 * ⛔ This remote JS extractor intentionally returns null.
 *
 * vidsrcme.ru has completely overhauled its player architecture:
 *   - The old iframe-chain approach (parse #player_iframe → master_urls → generate.php) is broken.
 *   - The new site uses dynamically-computed CDN script domains via SHA-256 time-based tokens,
 *     with Cloudflare anti-devtools protection. Static HTTP scraping is impossible.
 *
 * ✅ The native StreamSniffer in the app handles VidSrcMe directly by loading
 *    the embed page in a hidden WebView and intercepting the .m3u8 network request.
 *
 * Embed URLs (TMDB ID):
 *   Movie: https://vidsrcme.ru/embed/movie/{tmdbId}
 *   TV:    https://vidsrcme.ru/embed/tv/{tmdbId}/{season}/{episode}
 */
(function () {
  var TAG = '[LordFlixExtractor]';

  async function extract(tmdbId, imdbId, title, isTv, season, episode, year) {
    console.log(TAG + ' ⛔ Remote JS disabled — native StreamSniffer handles VidSrcMe directly.');
    return null;
  }

  module.exports = { extract: extract };
})();
