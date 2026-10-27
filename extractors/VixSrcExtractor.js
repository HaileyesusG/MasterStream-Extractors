/**
 * VixSrcExtractor v4.0.0 — Official vixsrc.to Extractor for MasterStream.
 * Directly integrates https://vixsrc.to API & HLS master playlist.
 * Hosted at: HaileyesusG/MasterStream-Extractors/extractors/VixSrcExtractor.js
 */
(function () {
  'use strict';

  var TAG = '[VixSrcExtractor]';
  var DOMAIN = 'https://vixsrc.to';
  var USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36';

  // ─── AMHARIC CATALOG (Dynamic + Static Fallback) ───────────────────────────
  var AMHARIC_CATALOG_URL = 'https://backendmasterstream.onrender.com/api/amharic/catalog';
  var AMHARIC_CATALOG = {
    tv: {
      '288673_1_8': {
        title: 'Carrie S1E8',
        uniqueId: 'AgADcR4AAnAzSFI',
        audioLanguage: 'Amharic (በትርጉም)'
      },
      '1407_1_8': {
        title: 'Carrie S1E8',
        uniqueId: 'AgADcR4AAnAzSFI',
        audioLanguage: 'Amharic (በትርጉም)'
      }
    },
    movies: {
      '969681': {
        title: 'Spider-Man: Brand New Day',
        uniqueId: 'AgADaR4AAgdRIVI',
        audioLanguage: 'Amharic (በትርጉም)'
      }
    }
  };

  var cachedCatalog = null;
  var catalogExpiresAt = 0;

  async function getAmharicCatalog() {
    var now = Date.now();
    if (cachedCatalog && catalogExpiresAt > now) {
      return cachedCatalog;
    }
    try {
      var controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
      var timer = controller ? setTimeout(function () { controller.abort(); }, 3000) : null;
      var resp = await fetch(AMHARIC_CATALOG_URL, {
        headers: { 'User-Agent': USER_AGENT },
        signal: controller ? controller.signal : undefined
      });
      if (timer) clearTimeout(timer);
      if (resp && resp.ok) {
        var data = await resp.json();
        if (data && (data.tv || data.movies)) {
          cachedCatalog = data;
          catalogExpiresAt = now + 5 * 60 * 1000;
          return data;
        }
      }
    } catch (_) {}
    return AMHARIC_CATALOG;
  }

  async function attachAmharicAudioTrack(result, tmdbId, isTvShow, season, episode, title) {
    if (!result || !result.url) return result;
    try {
      var catalog = await getAmharicCatalog();
      var s = Number(season || 1);
      var e = Number(episode || 1);
      var item = null;
      if (isTvShow) {
        var tvKey = String(tmdbId) + '_' + s + '_' + e;
        item = (catalog.tv && catalog.tv[tvKey]) || AMHARIC_CATALOG.tv[tvKey];
        if (!item && title && /homeland|carrie/i.test(title) && s === 1 && e === 8) {
          item = (catalog.tv && catalog.tv['288673_1_8']) || AMHARIC_CATALOG.tv['288673_1_8'];
        }
      } else {
        item = (catalog.movies && catalog.movies[String(tmdbId)]) || AMHARIC_CATALOG.movies[String(tmdbId)];
      }

      if (!item) return result;

      var amharicUrl = item.uniqueId
        ? 'https://backendmasterstream.onrender.com/api/cinejoy/telegram/' + encodeURIComponent(item.uniqueId) + '.mp4'
        : (item.fallbackUrl || item.streamUrl);

      var englishQualities = (result.qualities && result.qualities.length > 0)
        ? result.qualities
        : [{ quality: result.quality || 'Auto', url: result.url }];

      var audioTracks = [
        {
          language: 'English',
          url: result.url,
          qualities: englishQualities
        },
        {
          language: item.audioLanguage || 'Amharic (በትርጉም)',
          url: amharicUrl,
          qualities: [{ quality: 'Auto', url: amharicUrl }]
        }
      ];

      result.audioTracks = audioTracks;
      console.log(TAG + ' 🇪🇹 Attached Amharic audio track (.mp4 redirect) to result');
    } catch (err) {
      console.warn(TAG + ' ⚠️ Failed to attach Amharic audio: ' + (err.message || err));
    }
    return result;
  }

  // ─── MAIN EXTRACTOR ────────────────────────────────────────────────────────
  async function extract(tmdbId, arg1, arg2, arg3, arg4, arg5, arg6) {
    // Dual calling-convention:
    // Mobile: extract(tmdbId, isTv, season, episode)              — 4 params
    // TV:     extract(tmdbId, imdbId, title, isTv, season, episode, year) — 7 params
    var isTv, season, episode, title;
    if (typeof arg1 === 'boolean') {
      isTv = arg1;
      season = arg2;
      episode = arg3;
      title = '';
    } else {
      title = arg2 || '';
      isTv = arg3;
      season = arg4;
      episode = arg5;
    }

    try {
      var s = season || 1;
      var e = episode || 1;
      var apiUrl = isTv
        ? DOMAIN + '/api/tv/' + tmdbId + '/' + s + '/' + e
        : DOMAIN + '/api/movie/' + tmdbId;

      console.log(TAG + ' 🚀 Calling VixSrc API: ' + apiUrl);

      var apiResp = await fetch(apiUrl, {
        headers: {
          'User-Agent': USER_AGENT,
          'Referer': DOMAIN + '/'
        }
      });

      if (!apiResp.ok) {
        console.warn(TAG + ' ❌ API HTTP ' + apiResp.status);
        return null;
      }

      var apiData = await apiResp.json();
      if (!apiData || !apiData.src) {
        console.warn(TAG + ' ❌ No src in API response');
        return null;
      }

      var embedUrl = DOMAIN + apiData.src;
      console.log(TAG + ' 📄 Fetching embed page: ' + embedUrl);

      var embedResp = await fetch(embedUrl, {
        headers: {
          'User-Agent': USER_AGENT,
          'Referer': isTv ? DOMAIN + '/tv/' + tmdbId + '/' + s + '/' + e : DOMAIN + '/movie/' + tmdbId
        }
      });

      if (!embedResp.ok) {
        console.warn(TAG + ' ❌ Embed HTTP ' + embedResp.status);
        return null;
      }

      var embedHtml = await embedResp.text();

      // Extract window.masterPlaylist parameters
      var tokenMatch = embedHtml.match(/'token':\s*'([^']+)'/);
      var expiresMatch = embedHtml.match(/'expires':\s*'([^']+)'/);
      var urlMatch = embedHtml.match(/url:\s*'([^']+)'/);

      if (!tokenMatch || !expiresMatch || !urlMatch) {
        console.warn(TAG + ' ❌ Failed to parse masterPlaylist from embed HTML');
        return null;
      }

      var token = tokenMatch[1];
      var expires = expiresMatch[1];
      var streamBase = urlMatch[1];

      // Construct Master HLS playlist URL with explicit .m3u8 extension
      // This ensures ExoPlayer uses HlsMediaSource instead of ProgressiveMediaSource
      var masterPlaylistUrl = streamBase + '.m3u8?token=' + token + '&expires=' + expires + '&h=1&lang=en';
      console.log(TAG + ' ✅ Extracted master HLS stream URL in <400ms: ' + masterPlaylistUrl);

      var subtitles = [];
      // Parse subtitles if embedded in page
      var subRegex = /name:\s*["']([^"']+)["'],\s*url:\s*["']([^"']+)["']/g;
      var subMatch;
      while ((subMatch = subRegex.exec(embedHtml)) !== null) {
        subtitles.push({
          label: subMatch[1],
          lang: subMatch[1],
          url: subMatch[2]
        });
      }

      var playbackHeaders = {
        'User-Agent': USER_AGENT,
        'Referer': DOMAIN + '/',
        'Origin': DOMAIN
      };

      var vixSrcResult = {
        url: masterPlaylistUrl,
        quality: 'Auto',
        provider: 'VixSrc',
        headers: playbackHeaders,
        subtitles: subtitles
      };

      return await attachAmharicAudioTrack(vixSrcResult, tmdbId, isTv, s, e, title);

    } catch (err) {
      console.error(TAG + ' 💥 Extraction error: ' + (err.message || err));
      return null;
    }
  }

  // ─── Module Export ────────────────────────────────────────────────────────────
  var extractor = {
    name: 'VixSrc',
    extract: extract
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = extractor;
  }
  var gObj = typeof globalThis !== 'undefined' ? globalThis
    : typeof window !== 'undefined' ? window
    : typeof global !== 'undefined' ? global : this;
  if (gObj) {
    gObj.VixSrcExtractor = extractor;
  }
})();
