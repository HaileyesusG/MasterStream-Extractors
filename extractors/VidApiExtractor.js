(function () {
  'use strict';

  var TAG = '[VidApiExtractor]';

  async function extract(tmdbId, imdbId, title, isTv, season, episode, year) {
    try {
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
