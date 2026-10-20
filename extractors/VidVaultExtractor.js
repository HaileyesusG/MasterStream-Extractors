/**
 * VidVault Remote Extractor (Dual-Engine: VidVault Native MKV + Vidlink MP4 Fallback)
 *
 * Dedicated to downloading movies & TV series in DownloadOptionsModal.
 *
 * ENGINE 1 (Native VidVault):
 * - Checks https://vidvault.to/{type}/{tmdbId}
 * - Scrapes ready converted qualities (1080p, 720p, 360p, etc.)
 * - Resolves direct download links from /download-link/{type}/{tmdbId}/{quality}
 * - Emits clean MKV streams with 'Referer': 'https://vidvault.to/' (required by CDN)
 *
 * ENGINE 2 (Vidlink Direct MP4 Fallback):
 * - If VidVault returns 404 or has no ready downloads, falls back to Vidlink API
 * - Provides fast direct progressive MP4 streams
 *
 * Hot-update: run Update-Manifest.ps1, commit and push.
 */
(function () {
  'use strict';

  var TAG = '[VidVaultExtractor]';
  var VIDVAULT_BASE = 'https://vidvault.to';
  var VIDLINK_BASE = 'https://vidlink.pro';
  var ENC_API = 'https://enc-dec.app/api/enc-vidlink';
  var USER_AGENT =
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

  function parseQualityNumber(qStr) {
    if (!qStr) return 0;
    var m = qStr.toString().match(/(\d+)/);
    return m ? parseInt(m[1], 10) : 0;
  }

  // ─── Engine 1: Native VidVault MKV Scraper ─────────────────────────────────
  async function extractNativeVidVault(type, tmdbId, season, episode) {
    try {
      var pageUrl = VIDVAULT_BASE + '/' + type + '/' + tmdbId;
      if (type === 'tv') {
        pageUrl += '/' + (season || 1) + '/' + (episode || 1);
      }

      console.log(TAG + ' 🌐 [VidVault] Fetching page: ' + pageUrl);
      var pageRes = await fetch(pageUrl, {
        headers: { 'User-Agent': USER_AGENT }
      });

      if (!pageRes.ok) {
        console.warn(TAG + ' ⚠️ [VidVault] Page HTTP ' + pageRes.status);
        return null;
      }

      var html = await pageRes.text();

      // Find ready download qualities: requestDownload('type', 'id', 's', 'e', 'quality')
      var regex = /requestDownload\('([^']+)',\s*'([^']*)',\s*'([^']*)',\s*'([^']*)',\s*'([^']+)'\)/g;
      var match;
      var readyQualities = [];
      while ((match = regex.exec(html)) !== null) {
        var q = match[5];
        if (readyQualities.indexOf(q) === -1) {
          readyQualities.push(q);
        }
      }

      if (readyQualities.length === 0) {
        console.warn(TAG + ' ⚠️ [VidVault] No ready download streams on page');
        return null;
      }

      console.log(TAG + ' 📋 [VidVault] Found ' + readyQualities.length + ' ready qualities: ' + readyQualities.join(', '));

      // Fetch download links for each quality in parallel
      var qualityResults = await Promise.all(
        readyQualities.map(async function (q) {
          var dlUrl = VIDVAULT_BASE + '/download-link/' + type + '/' + tmdbId;
          if (type === 'tv') {
            dlUrl += '/' + (season || 1) + '/' + (episode || 1);
          }
          dlUrl += '/' + encodeURIComponent(q);

          try {
            var dlRes = await fetch(dlUrl, {
              headers: {
                'User-Agent': USER_AGENT,
                'Referer': pageUrl
              }
            });
            if (!dlRes.ok) return null;
            var dlData = await dlRes.json();
            if (dlData && dlData.url) {
              var clean = String(dlData.url).split('?')[0].split('#')[0];
              if (!clean.endsWith('.mkv')) clean += '.mkv';
              return {
                quality: q,
                qualityNum: parseQualityNumber(q),
                url: clean
              };
            }
          } catch (_) {}
          return null;
        })
      );

      var validQualities = qualityResults.filter(Boolean);
      if (validQualities.length === 0) {
        console.warn(TAG + ' ⚠️ [VidVault] Failed to resolve download links');
        return null;
      }

      // Sort descending by resolution (1080p > 720p > 360p)
      validQualities.sort(function (a, b) {
        return b.qualityNum - a.qualityNum;
      });

      var parsedQualities = validQualities.map(function (v) {
        return { quality: v.quality, url: v.url };
      });

      console.log(TAG + ' ✅ [VidVault] Extracted ' + parsedQualities.length + ' MKV streams, best: ' + parsedQualities[0].quality);

      return {
        url: parsedQualities[0].url,
        quality: parsedQualities[0].quality,
        qualities: parsedQualities,
        provider: 'VidVault',
        headers: {
          'Referer': VIDVAULT_BASE + '/',
          'Origin': VIDVAULT_BASE,
          'User-Agent': USER_AGENT
        },
        subtitles: []
      };
    } catch (e) {
      console.warn(TAG + ' ⚠️ [VidVault] Error: ' + (e.message || e));
      return null;
    }
  }

  // ─── Engine 2: Vidlink Direct MP4 Fallback ────────────────────────────────
  async function extractVidlinkFallback(type, tmdbId, season, episode) {
    try {
      console.log(TAG + ' 🔄 [Vidlink Fallback] Requesting token for TMDB ' + tmdbId);
      var encRes = await fetch(ENC_API + '?text=' + tmdbId);
      if (!encRes.ok) return null;
      var encJson = await encRes.json();
      var token = encJson && encJson.result;
      if (!token) return null;

      var apiUrl = type === 'tv'
        ? VIDLINK_BASE + '/api/b/tv/' + token + '/' + (season || 1) + '/' + (episode || 1)
        : VIDLINK_BASE + '/api/b/movie/' + token;

      var apiRes = await fetch(apiUrl, {
        headers: {
          'User-Agent': USER_AGENT,
          'Referer': VIDLINK_BASE + '/',
          'Origin': VIDLINK_BASE,
          'Accept': 'application/json, text/plain, */*'
        }
      });
      if (!apiRes.ok) return null;
      var data = await apiRes.json();
      var stream = data && data.stream;
      var qualities = stream && stream.qualities;
      if (!qualities || typeof qualities !== 'object') return null;

      var qualityKeys = Object.keys(qualities).sort(function (a, b) {
        return parseInt(b, 10) - parseInt(a, 10);
      });
      if (qualityKeys.length === 0) return null;

      var parsedQualities = [];
      for (var i = 0; i < qualityKeys.length; i++) {
        var k = qualityKeys[i];
        var item = qualities[k];
        var u = item && (item.url || item.file || '');
        if (u) parsedQualities.push({ url: u, quality: k + 'p' });
      }

      if (parsedQualities.length === 0) return null;

      var subtitles = [];
      if (Array.isArray(stream.captions)) {
        for (var c = 0; c < stream.captions.length; c++) {
          var cap = stream.captions[c];
          if (cap.id && cap.label) {
            subtitles.push({ url: cap.id, lang: cap.label, label: cap.label });
          }
        }
      }

      console.log(TAG + ' ✅ [Vidlink Fallback] Extracted ' + parsedQualities.length + ' MP4 streams, best: ' + parsedQualities[0].quality);

      return {
        url: parsedQualities[0].url,
        quality: parsedQualities[0].quality,
        qualities: parsedQualities,
        provider: 'VidVault',
        headers: {},
        subtitles: subtitles
      };
    } catch (e) {
      console.warn(TAG + ' ⚠️ [Vidlink Fallback] Error: ' + (e.message || e));
      return null;
    }
  }

  // ─── Main Extract Function ────────────────────────────────────────────────
  async function extract(tmdbId, arg1, arg2, arg3, arg4, arg5, arg6) {
    var isTv, season, episode, title, imdbId, year;

    // Detect calling convention:
    // Mobile 4-param: (tmdbId, isTv, season, episode)
    // Mobile 5-param: (tmdbId, isTv, season, episode, title)
    // Mobile 5-param alt: (tmdbId, imdbId, isTv, season, episode)
    // TV / Full 7-param: (tmdbId, imdbId, title, isTv, season, episode, year)
    if (typeof arg1 === 'boolean') {
      isTv = arg1;
      season = arg2;
      episode = arg3;
      title = arg4;
      imdbId = null;
      year = null;
    } else if (typeof arg2 === 'boolean') {
      imdbId = arg1;
      isTv = arg2;
      season = arg3;
      episode = arg4;
      title = null;
      year = null;
    } else {
      imdbId = arg1;
      title = typeof arg2 === 'string' ? arg2 : null;
      isTv = arg3;
      season = arg4;
      episode = arg5;
      year = arg6;
    }

    try {
      var type = isTv ? 'tv' : 'movie';
      console.log(TAG + ' 🚀 Extracting for ' + type + ' tmdbId=' + tmdbId + (isTv ? ' (S' + (season || 1) + 'E' + (episode || 1) + ')' : ''));

      // 1. Try Native VidVault MKV first (Pre-converted fast direct download)
      var nativeResult = await extractNativeVidVault(type, tmdbId, season, episode);
      if (nativeResult) return nativeResult;

      // 2. Fall back to Vidlink Direct MP4
      console.log(TAG + ' 🔄 VidVault native returned no streams, trying Vidlink fallback...');
      var fallbackResult = await extractVidlinkFallback(type, tmdbId, season, episode);
      if (fallbackResult) return fallbackResult;

      console.warn(TAG + ' ❌ Both VidVault and fallback failed for tmdbId=' + tmdbId);
      return null;
    } catch (e) {
      console.error(TAG + ' 💥 Unexpected extraction error: ' + (e.message || e));
      return null;
    }
  }

  var extractorObj = { extract: extract };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = extractorObj;
  }

  var gObj =
    typeof globalThis !== 'undefined'
      ? globalThis
      : typeof window !== 'undefined'
      ? window
      : typeof global !== 'undefined'
      ? global
      : this;
  if (gObj) {
    gObj.VidVaultExtractor = extractorObj;
  }
})();
