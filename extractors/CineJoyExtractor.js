/**
 * CineJoyExtractor — self-contained CommonJS JS for remote hot-update.
 * Hosted at: HaileyesusG/MasterStream-Extractors/extractors/CineJoyExtractor.js
 * Works out-of-the-box on Mobile App (React Native) and Native TV App (Android WebView).
 *
 * Strategies:
 *   1. StreamSniffer (Primary for React Native & Android TV WebView):
 *      Loads https://cinejoy.to/movie/{tmdbId} or https://cinejoy.to/tv/{tmdbId}/{season}/{episode}
 *      in a background WebView. The site's own V8 engine performs the ECDH + scrypt handshake,
 *      and StreamSniffer intercepts the clean master .m3u8 (e.g. info.movieboxnoob.cc/playlist/...).
 *
 *   2. Direct API Fallback:
 *      Uses api.shegu.st /info catalog endpoint to verify MBP ID availability and query servers.
 */
(function () {
  'use strict';
  var TAG = '[CineJoyExtractor]';
  var BASE_URL = 'https://cinejoy.to';
  var API_BASE = 'https://api.shegu.st';
  var SNIFF_TIMEOUT_MS = 40000;
  var HTTP_TIMEOUT_MS = 10000;

  var FETCH_HEADERS = {
    Accept: 'application/json, */*',
    Origin: 'https://cinejoy.to',
    Referer: 'https://cinejoy.to/',
    'User-Agent':
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36',
  };

  function fetchTimeout(url, opts, ms) {
    return new Promise(function (resolve, reject) {
      var timer = setTimeout(function () {
        reject(new Error('timeout'));
      }, ms || HTTP_TIMEOUT_MS);
      fetch(url, opts)
        .then(function (r) {
          clearTimeout(timer);
          resolve(r);
        })
        .catch(function (e) {
          clearTimeout(timer);
          reject(e);
        });
    });
  }

  /**
   * Strategy 1: Native StreamSniffer (React Native / Android TV Bridge)
   */
  async function tryStreamSniffer(tmdbId, isTv, season, episode) {
    try {
      var g = typeof globalThis !== 'undefined' ? globalThis :
              typeof window !== 'undefined' ? window :
              typeof global !== 'undefined' ? global : this;

      var sniffer = (g && g.StreamSniffer) ||
                    (g && g.NativeModules && g.NativeModules.StreamSniffer);

      if (!sniffer || typeof sniffer.sniffStreamUrl !== 'function') {
        return null;
      }

      var embedUrl = isTv
        ? BASE_URL + '/tv/' + tmdbId + '/' + (season || 1) + '/' + (episode || 1)
        : BASE_URL + '/movie/' + tmdbId;

      console.log(TAG, '🔬 Attempting StreamSniffer on:', embedUrl);

      var result = await sniffer.sniffStreamUrl(embedUrl, SNIFF_TIMEOUT_MS);
      if (result && result.url) {
        console.log(TAG, '✅ Sniffer captured stream:', result.url.substring(0, 80));
        var headers = {
          Referer: 'https://cinejoy.to/',
          Origin: 'https://cinejoy.to',
          'User-Agent': FETCH_HEADERS['User-Agent'],
        };
        if (result.headers) {
          for (var k in result.headers) {
            headers[k] = result.headers[k];
          }
        }
        return {
          url: result.url,
          quality: 'Auto',
          provider: 'CineJoy',
          headers: headers,
          subtitles: [],
        };
      }
    } catch (e) {
      console.warn(TAG, 'Sniffer error / unavailable:', e.message);
    }
    return null;
  }

  /**
   * Strategy 2: Direct API check
   */
  async function fetchCatalogInfo(tmdbId, isTv, season, episode) {
    try {
      var type = isTv ? 2 : 1;
      var url = API_BASE + '/info?tmdb=' + tmdbId + '&type=' + type;
      if (isTv && season != null && episode != null) {
        url += '&season=' + season + '&episode=' + episode;
      }
      var res = await fetchTimeout(url, { headers: FETCH_HEADERS });
      if (!res.ok) return null;
      return await res.json();
    } catch (e) {
      return null;
    }
  }

  async function extract(tmdbId, imdbId, title, isTv, season, episode, year) {
    console.log(TAG, 'Extracting', isTv ? 'TV' : 'Movie', title || '', 'TMDB=' + tmdbId);

    // 1. Try StreamSniffer first (works directly on Web Video Caster / Android WebView / React Native)
    var sniffed = await tryStreamSniffer(tmdbId, isTv, season, episode);
    if (sniffed) return sniffed;

    // 2. Check catalogue existence on api.shegu.st
    var info = await fetchCatalogInfo(tmdbId, isTv, season, episode);
    if (info && info.mbp_id) {
      console.log(TAG, 'Catalogue match found: mbp_id=' + info.mbp_id + ', title=' + (info.title || title));
    }

    return null;
  }

  module.exports = { extract: extract };
})();
