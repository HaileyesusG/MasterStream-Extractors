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
      '322280_1_1': {
        title: 'Master Omur S1E1',
        uniqueId: 'AgADnB4AAkn8IFM',
        audioLanguage: 'Amharic (በትርጉም)'
      },
      '322280_1_2': {
        title: 'Master Omur S1E2',
        uniqueId: 'AgADsyEAAsRvqVI',
        audioLanguage: 'Amharic (በትርጉም)'
      },
      '322280_1_3': {
        title: 'Master Omur S1E3',
        uniqueId: 'AgAD3CEAAsRvqVI',
        audioLanguage: 'Amharic (በትርጉም)'
      },
      '322280_1_4': {
        title: 'Master Omur S1E4',
        uniqueId: 'AgADWx4AAkn8IFM',
        audioLanguage: 'Amharic (በትርጉም)'
      },
      '322280_1_5': {
        title: 'Master Omur S1E5',
        uniqueId: 'AgADmB4AAkn8IFM',
        audioLanguage: 'Amharic (በትርጉም)'
      },
      '322280_1_6': {
        title: 'Master Omur S1E6',
        uniqueId: 'AgADnB4AAkn8IFM',
        audioLanguage: 'Amharic (በትርጉም)'
      },
      '322280_1_7': {
        title: 'Master Omur S1E7',
        uniqueId: 'AgADJSEAArScKFM',
        audioLanguage: 'Amharic (በትርጉም)'
      },
      '288673_1_1': { title: 'Carrie S1E1', uniqueId: 'AgADLB4AAnAzSFI', audioLanguage: 'Amharic (በትርጉም)' },
      '288673_1_2': { title: 'Carrie S1E2', uniqueId: 'AgADLB4AAnAzSFI', audioLanguage: 'Amharic (በትርጉም)' },
      '288673_1_3': { title: 'Carrie S1E3', uniqueId: 'AgADOh4AAnAzSFI', audioLanguage: 'Amharic (በትርጉም)' },
      '288673_1_4': { title: 'Carrie S1E4', uniqueId: 'AgADSx4AAnAzSFI', audioLanguage: 'Amharic (በትርጉም)' },
      '288673_1_5': { title: 'Carrie S1E5', uniqueId: 'AgADYR4AAnAzSFI', audioLanguage: 'Amharic (በትርጉም)' },
      '288673_1_6': { title: 'Carrie S1E6', uniqueId: 'AgADaR4AAnAzSFI', audioLanguage: 'Amharic (በትርጉም)' },
      '288673_1_7': { title: 'Carrie S1E7', uniqueId: 'AgADbR4AAnAzSFI', audioLanguage: 'Amharic (በትርጉም)' },
      '288673_1_8': {
        title: 'Carrie',
        season: 1,
        episode: 8,
        uniqueId: 'AgADcR4AAnAzSFI',
        streamUrl: 'https://stream.unlockify.ink/internal-stream/AgADcR4AAnAzSFI',
        referer: 'https://stream.unlockify.ink/video/AgADcR4AAnAzSFI',
        quality: '1080p',
      },
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
      '969681': { title: 'Spider-Man: Brand New Day', uniqueId: 'AgADaR4AAgdRIVI', audioLanguage: 'Amharic (በትርጉም)' },
      '855435': { title: 'Faces of Death', audioLanguage: 'Amharic (በትርጉም)' },
      '1007757': { title: 'Swapped', audioLanguage: 'Amharic (በትርጉም)' },
      '1058424': { title: 'Hope', audioLanguage: 'Amharic (በትርጉም)' },
      '1101412': { title: 'Fall 2: Deadpoint', audioLanguage: 'Amharic (በትርጉም)' },
      '1280738': { title: 'The Furious', audioLanguage: 'Amharic (በትርጉም)' },
      '1288445': { title: 'Mutiny', audioLanguage: 'Amharic (በትርጉም)' },
      '1507696': { title: 'Apocalypse Z: New World', audioLanguage: 'Amharic (በትርጉም)' },
      '1515692': { title: 'Baththa', audioLanguage: 'Amharic (በትርጉም)' },
      '1543142': { title: 'Thai Fighters', audioLanguage: 'Amharic (በትርጉም)' },
      '1561726': { title: 'Masterplan', audioLanguage: 'Amharic (በትርጉም)' },
      '1701686': { title: 'World War Bigfoot', audioLanguage: 'Amharic (በትርጉም)' }
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
      var timeoutId = controller ? setTimeout(function () { controller.abort(); }, 10000) : null;
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

    var audioTracks = [
      {
        language: item.audioLanguage || 'Amharic (በትርጉም)',
        url: streamUrl,
        qualities: [
          { quality: quality, url: streamUrl },
          { quality: 'Auto', url: streamUrl },
        ],
      },
    ];

    // If Turkish series or VidSrcCC is available, attach Original Audio
    try {
      var vidsrcCC = (typeof gObj !== 'undefined' && gObj.VidSrcCCExtractor)
        ? gObj.VidSrcCCExtractor
        : (typeof require !== 'undefined' ? (function () { try { return require('./VidSrcCCExtractor.js'); } catch (_) { return null; } })() : null);

      if (vidsrcCC && typeof vidsrcCC.extract === 'function') {
        var origRes = await vidsrcCC.extract(tmdbId, imdbId, title, isTv, season, episode, year);
        if (origRes && origRes.url && origRes.url !== streamUrl) {
          var origLang = (String(tmdbId) === '322280' || (title && /omur|usta|uzak|sehir/i.test(title)))
            ? 'Original Audio (Turkish)'
            : 'Original Audio';
          audioTracks.unshift({
            language: origLang,
            url: origRes.url,
            qualities: origRes.qualities || [{ quality: origRes.quality || 'Auto', url: origRes.url }]
          });
          console.log(TAG + ' 🇹🇷 Attached original audio track from VidSrcCC to Vidlink');
        }
      }
    } catch (_) {}

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
      audioTracks: audioTracks,
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
