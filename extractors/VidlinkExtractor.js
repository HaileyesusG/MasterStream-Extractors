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
      // Carrie (TMDB 288673) Season 1 Episode 8
      '288673_1_8': {
        title: 'Carrie',
        season: 1,
        episode: 8,
        uniqueId: 'AgADcR4AAnAzSFI',
        streamUrl: 'https://stream.unlockify.ink/internal-stream/AgADcR4AAnAzSFI',
        referer: 'https://stream.unlockify.ink/video/AgADcR4AAnAzSFI',
        quality: '1080p',
      },
      // Homeland / Carrie (TMDB 1407) Season 1 Episode 8
      '1407_1_8': {
        title: 'Carrie (Homeland)',
        season: 1,
        episode: 8,
        uniqueId: 'AgADcR4AAnAzSFI',
        streamUrl: 'https://stream.unlockify.ink/internal-stream/AgADcR4AAnAzSFI',
        referer: 'https://stream.unlockify.ink/video/AgADcR4AAnAzSFI',
        quality: '1080p',
      },
    },
    movies: {
      // Format: "{tmdbId}"
    },
  };

  var dynamicCatalogCache = null;
  var dynamicCatalogExpiry = 0;

  async function getAmharicCatalog() {
    var now = Date.now();
    if (dynamicCatalogCache && now < dynamicCatalogExpiry) {
      return dynamicCatalogCache;
    }
    try {
      var controller = (typeof AbortController !== 'undefined') ? new AbortController() : null;
      var timeoutId = controller ? setTimeout(function () { controller.abort(); }, 3500) : null;
      var res = await fetch('https://backendmasterstream.onrender.com/api/amharic/catalog', {
        signal: controller ? controller.signal : undefined,
      });
      if (timeoutId) clearTimeout(timeoutId);
      if (res && res.ok) {
        var data = await res.json();
        if (data && (data.tv || data.movies)) {
          var mergedTv = Object.assign({}, AMHARIC_CATALOG.tv, data.tv || {});
          var mergedMovies = Object.assign({}, AMHARIC_CATALOG.movies, data.movies || {});
          dynamicCatalogCache = { tv: mergedTv, movies: mergedMovies };
          dynamicCatalogExpiry = now + (5 * 60 * 1000);
          return dynamicCatalogCache;
        }
      }
    } catch (fetchErr) {
      // Fall back quietly
    }
    return AMHARIC_CATALOG;
  }


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

    var catalog = await getAmharicCatalog();
    if (isTvShow) {
      var tvKey = String(tmdbId) + '_' + s + '_' + e;
      item = (catalog.tv && catalog.tv[tvKey]) || AMHARIC_CATALOG.tv[tvKey];

      if (!item && title && /homeland|carrie/i.test(title) && s === 1 && e === 8) {
        item = (catalog.tv && catalog.tv['288673_1_8']) || AMHARIC_CATALOG.tv['288673_1_8'];
      }
    } else {
      item = (catalog.movies && catalog.movies[String(tmdbId)]) || AMHARIC_CATALOG.movies[String(tmdbId)];
    }

    if (!item) {
      // No Amharic dub available for this title -> return null immediately
      return null;
    }

    console.log(TAG + ' 🇪🇹 Found Amharic translation for: ' + (item.title || title || tmdbId) + (isTvShow ? ' S' + s + 'E' + e : ''));

    var streamUrl = item.uniqueId
      ? 'https://backendmasterstream.onrender.com/api/cinejoy/telegram/' + encodeURIComponent(item.uniqueId) + '.mp4'
      : item.streamUrl;
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
