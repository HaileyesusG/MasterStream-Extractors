/**
 * Vidlink / Amharic Dubbed Extractor
 * Provides Amharic voiceover / translated movies & series from @Masterstreamamharic
 * Streams directly from Telegram CDN to client with zero server bandwidth.
 */
(function () {
  'use strict';

  var TAG = '[VidlinkExtractor]';
  var USER_AGENT =
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36';

  // Catalog of Amharic dubbed movies and TV series
  var AMHARIC_CATALOG = {
    tv: {
      // Format: "{tmdbId}_{season}_{episode}"
      // Homeland / Carrie (TMDB 1407) Season 1 Episode 8
      '1407_1_8': {
        title: 'Carrie (Homeland)',
        season: 1,
        episode: 8,
        streamUrl: 'https://stream.unlockify.ink/internal-stream/AgADcR4AAnAzSFI',
        referer: 'https://stream.unlockify.ink/video/AgADcR4AAnAzSFI',
        quality: '1080p',
      },
    },
    movies: {
      // Format: "{tmdbId}"
    },
  };

  async function extract(tmdbId, arg1, arg2, arg3, arg4, arg5, arg6) {
    var imdbId, title, isTv, season, episode, year;

    if (typeof arg1 === 'boolean') {
      isTv = arg1; season = arg2; episode = arg3;
    } else if (typeof arg2 === 'boolean') {
      imdbId = arg1; isTv = arg2; season = arg3; episode = arg4;
    } else {
      imdbId = arg1; title = arg2; isTv = arg3; season = arg4; episode = arg5; year = arg6;
    }

    var isTvShow = isTv === true || String(isTv) === 'true' || String(isTv) === 'tv';
    var s = Number(season || 1);
    var e = Number(episode || 1);

    var item = null;

    if (isTvShow) {
      // 1. Match by TMDB ID
      var tvKey = String(tmdbId) + '_' + s + '_' + e;
      item = AMHARIC_CATALOG.tv[tvKey];

      // 2. Fallback match by Title (e.g. Carrie / Homeland S1E8)
      if (!item && title && /homeland|carrie/i.test(title) && s === 1 && e === 8) {
        item = AMHARIC_CATALOG.tv['1407_1_8'];
      }
    } else {
      // Match movie by TMDB ID
      item = AMHARIC_CATALOG.movies[String(tmdbId)];
    }

    if (!item) {
      // No Amharic dub available for this title -> return null immediately
      return null;
    }

    console.log(TAG + ' 🇪🇹 Found Amharic translation for: ' + (item.title || title) + (isTvShow ? ' S' + s + 'E' + e : ''));

    var streamUrl = item.streamUrl;
    var referer = item.referer || 'https://stream.unlockify.ink/';
    var quality = item.quality || '1080p';

    return {
      url: streamUrl,
      quality: quality,
      provider: 'Vidlink',
      headers: {
        'User-Agent': USER_AGENT,
        'Referer': referer,
      },
      subtitles: [],
      qualities: [
        { quality: quality, url: streamUrl },
        { quality: 'Auto', url: streamUrl },
      ],
      audioTracks: [
        {
          language: 'Amharic (በትርጉም)',
          url: streamUrl,
          qualities: [
            { quality: quality, url: streamUrl },
            { quality: 'Auto', url: streamUrl },
          ],
        },
      ],
    };
  }

  var extractor = { extract: extract };
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = extractor;
  }
  var gObj = typeof globalThis !== 'undefined' ? globalThis
    : typeof window !== 'undefined' ? window
    : typeof global !== 'undefined' ? global : this;
  if (gObj) {
    gObj.VidlinkExtractor = extractor;
  }
})();
