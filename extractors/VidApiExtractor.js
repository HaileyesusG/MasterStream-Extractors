(function () {
  'use strict';

  var TAG = '[VidApiExtractor]';

  var KNOWN_TURKISH_SERIES = {
    '242551': true,
    '306215': true,
    '322280': true
  };
  var turkishSeriesCache = {};
  var TMDB_KEY = 'a2dc7e427ce7dc4a54a518f239a51909';

  async function isTurkishTvSeries(tmdbId) {
    if (!tmdbId) return false;
    var idStr = String(tmdbId);
    if (KNOWN_TURKISH_SERIES[idStr]) return true;
    if (turkishSeriesCache[idStr] !== undefined) return turkishSeriesCache[idStr];

    try {
      var controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
      var timer = controller ? setTimeout(function () { try { controller.abort(); } catch (e) {} }, 3000) : null;
      var endpoint = (idStr.indexOf('tt') === 0)
        ? 'find/' + encodeURIComponent(idStr) + '?external_source=imdb_id&api_key=' + TMDB_KEY
        : 'tv/' + encodeURIComponent(idStr) + '?api_key=' + TMDB_KEY;
      var res = await fetch('https://api.themoviedb.org/3/' + endpoint, {
        headers: { 'User-Agent': 'Mozilla/5.0' },
        signal: controller ? controller.signal : undefined
      });
      if (timer) clearTimeout(timer);
      if (res && res.ok) {
        var data = await res.json();
        var item = data.tv_results && data.tv_results[0] ? data.tv_results[0] : data;
        var isTurkish = (item.original_language === 'tr') ||
          (Array.isArray(item.origin_country) && item.origin_country.indexOf('TR') !== -1);
        turkishSeriesCache[idStr] = isTurkish;
        return isTurkish;
      }
    } catch (_) {}
    return false;
  }

  async function extract(tmdbId, imdbId, title, isTv, season, episode, year) {
    try {
      if (isTv && (await isTurkishTvSeries(tmdbId || imdbId))) {
        console.log(TAG + ' 🇹🇷 Skipping Turkish TV series (' + (tmdbId || imdbId) + ') — VidSrcCC is the dedicated Turkish provider');
        return null;
      }

      console.log(TAG + ' 🚀 Generating iframe URL for TMDB: ' + tmdbId + ' IMDB: ' + imdbId);
      
      // Use vaplayer.ru embed endpoint, which vidapi uses
      // They support TMDB IDs natively.
      var url = isTv
        ? 'https://vaplayer.ru/embed/tv/' + tmdbId + '/' + season + '/' + episode
        : 'https://vaplayer.ru/embed/movie/' + imdbId; // IMDB works well for movies, let's use it, fallback to TMDB

      if (!isTv && !imdbId) {
         url = 'https://vaplayer.ru/embed/movie/' + tmdbId;
      }

      console.log(TAG + ' ✅ Returning sniffer URL: ' + url);

      return {
        url: url,
        quality: 'Auto',
        qualities: [{ url: url, quality: 'Auto' }],
        provider: 'VidApi',
        headers: {
          'Referer': 'https://vidapi.ru/'
        },
        subtitles: [],
        isNative: true // Signal to the app to use WebView Sniffer if it checks this
      };
    } catch (e) {
      console.error(TAG + ' 💥 Error: ' + e.message);
      return null;
    }
  }

  module.exports = { extract: extract };
})();
