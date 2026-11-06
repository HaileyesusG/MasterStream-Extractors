/**
 * VidVault Remote Extractor (Dual-Engine: Vidlink Priority 1 + VidVault Fallback Priority 2)
 *
 * Dedicated to downloading and streaming movies & TV series in MasterStream (DownloadOptionsModal).
 *
 * ENGINE 1 (Vidlink Direct MP4 Priority):
 * - Primary fast high-speed CDN streams (1080p, 720p, 480p)
 * - Directly downloadable progressive MP4 video streams
 * - Clean headers for fast multi-connection downloading in mobile app and external downloaders
 *
 * ENGINE 2 (Native VidVault Direct Fallback):
 * - Fallback if Vidlink does not have the title
 * - Queries https://vidvault.to/media/movie/{tmdbId} or /media/tv/{tmdbId}/{season}/{episode}
 * - Pre-converted MKV & MP4 1080p/720p/480p
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

  // ─── Engine 1 (PRIORITY 1): Vidlink Fast Progressive MP4 ─────────────────────
  async function extractVidlink(type, tmdbId, season, episode) {
    try {
      console.log(TAG + ' 🚀 [Vidlink Priority 1] Requesting token for TMDB ' + tmdbId);
      var encRes = await fetch(ENC_API + '?text=' + tmdbId);
      if (!encRes.ok) return null;
      var encJson = await encRes.json();
      var token = encJson && encJson.result;
      if (!token) return null;

      var apiUrl = type === 'tv'
        ? VIDLINK_BASE + '/api/b/tv/' + token + '/' + (season || 1) + '/' + (episode || 1)
        : VIDLINK_BASE + '/api/b/movie/' + token;

      var pageReferer = type === 'tv'
        ? VIDLINK_BASE + '/tv/' + tmdbId + '/' + (season || 1) + '/' + (episode || 1)
        : VIDLINK_BASE + '/movie/' + tmdbId;

      var apiRes = await fetch(apiUrl, {
        headers: {
          'User-Agent': USER_AGENT,
          'Referer': pageReferer,
          'Origin': VIDLINK_BASE,
          'Accept': 'application/json, text/plain, */*'
        }
      });
      if (!apiRes.ok) return null;
      var data = await apiRes.json();
      var stream = data && data.stream;
      var qualities = stream && stream.qualities;
      if (!qualities || typeof qualities !== 'object') return null;

      var parsedQualities = [];
      var q1080 = qualities['1080'] && (qualities['1080'].url || qualities['1080'].file);
      var q720 = qualities['720'] && (qualities['720'].url || qualities['720'].file);
      var q480 = qualities['480'] && (qualities['480'].url || qualities['480'].file);

      // Provide 1080p, 720p, and 480p options (no 360p)
      var effective720 = q720 || q1080;

      if (q1080) {
        parsedQualities.push({ quality: '1080p', url: q1080 });
      }
      if (effective720) {
        parsedQualities.push({ quality: '720p', url: effective720 });
      }
      if (q480) {
        parsedQualities.push({ quality: '480p', url: q480 });
      }

      // Fallback if other non-standard resolutions exist
      if (parsedQualities.length === 0) {
        var keys = Object.keys(qualities).sort(function (a, b) {
          return parseInt(b, 10) - parseInt(a, 10);
        });
        for (var i = 0; i < keys.length; i++) {
          var k = keys[i];
          if (k === '360') continue;
          var item = qualities[k];
          var u = item && (item.url || item.file);
          if (u) parsedQualities.push({ quality: k + 'p', url: u });
        }
      }

      if (parsedQualities.length === 0) return null;

      var subtitles = [];
      if (Array.isArray(stream.captions)) {
        for (var c = 0; c < stream.captions.length; c++) {
          var cap = stream.captions[c];
          var subUrl = cap.url || cap.id;
          if (subUrl && cap.language) {
            subtitles.push({ url: subUrl, lang: cap.language, label: cap.language });
          } else if (cap.id && cap.label) {
            subtitles.push({ url: cap.id, lang: cap.label, label: cap.label });
          }
        }
      }

      console.log(TAG + ' ✅ [Vidlink Priority 1] Extracted ' + parsedQualities.length + ' MP4 streams (' + parsedQualities.map(function(q){return q.quality;}).join(', ') + '), best: ' + parsedQualities[0].quality);

      return {
        url: parsedQualities[0].url,
        quality: parsedQualities[0].quality,
        qualities: parsedQualities,
        provider: 'VidVault',
        // Clean headers for unthrottled direct downloading
        headers: {},
        subtitles: subtitles
      };
    } catch (e) {
      console.warn(TAG + ' ⚠️ [Vidlink Priority 1] Error: ' + (e.message || e));
      return null;
    }
  }

  // ─── Engine 2 (FALLBACK PRIORITY 2): Native VidVault API ─────────────────────
  async function extractNativeVidVault(type, tmdbId, season, episode, title, year) {
    try {
      var mediaUrl = type === 'tv'
        ? VIDVAULT_BASE + '/media/tv/' + tmdbId + '/' + (season || 1) + '/' + (episode || 1)
        : VIDVAULT_BASE + '/media/movie/' + tmdbId;

      console.log(TAG + ' 🚀 [VidVault Fallback] Fetching media endpoint: ' + mediaUrl);
      var res = await fetch(mediaUrl, {
        headers: {
          'User-Agent': USER_AGENT,
          'Referer': VIDVAULT_BASE + '/',
          'Origin': VIDVAULT_BASE,
          'Accept': 'application/json, text/plain, */*'
        }
      });

      if (!res.ok) {
        console.warn(TAG + ' ⚠️ [VidVault Fallback] Media endpoint HTTP ' + res.status);
        return null;
      }

      var data = await res.json();
      if (!data || !Array.isArray(data.direct) || data.direct.length === 0) {
        console.warn(TAG + ' ⚠️ [VidVault Fallback] No direct streams found in response');
        return null;
      }

      var safeTitle = (title || (type === 'tv' ? 'Series' : 'Movie'))
        .replace(/[\\/:*?"<>|]/g, '')
        .trim();
      var fileName = type === 'tv'
        ? (safeTitle + (year ? ' (' + year + ')' : '') + ' S' + (season || 1) + 'E' + (episode || 1))
        : (safeTitle + (year ? ' (' + year + ')' : ''));

      var parsed = [];
      for (var i = 0; i < data.direct.length; i++) {
        var item = data.direct[i];
        if (!item || !item.path) continue;

        var fmt = (item.format || 'mp4').toLowerCase();
        var directUrl = VIDVAULT_BASE + item.path;
        if (!directUrl.toLowerCase().endsWith('.' + fmt)) {
          directUrl += '.' + fmt;
        }
        if (fileName) {
          directUrl += '?n=' + encodeURIComponent(fileName + '.' + fmt);
        }

        var qNum = parseQualityNumber(item.quality);
        var qLabel = '';
        if (item.quality) {
          qLabel = item.quality + ' (' + fmt.toUpperCase() + ')';
        } else {
          if (fmt === 'mp4') {
            qLabel = '1080p (MP4)';
            qNum = 1080;
          } else {
            qLabel = '720p (MKV)';
            qNum = 720;
          }
        }
        if (item.size) {
          qLabel += ' [' + item.size + ']';
        }

        parsed.push({
          quality: qLabel,
          qualityNum: qNum,
          format: fmt,
          size: item.size || '',
          url: directUrl
        });
      }

      if (parsed.length === 0) {
        console.warn(TAG + ' ⚠️ [VidVault Fallback] Direct items could not be parsed');
        return null;
      }

      // Sort: highest resolution first, prefer MP4 if tied
      parsed.sort(function (a, b) {
        if (b.qualityNum !== a.qualityNum) {
          return b.qualityNum - a.qualityNum;
        }
        if (a.format === 'mp4' && b.format !== 'mp4') return -1;
        if (b.format === 'mp4' && a.format !== 'mp4') return 1;
        return 0;
      });

      var parsedQualities = parsed.map(function (p) {
        return { quality: p.quality, url: p.url };
      });

      console.log(TAG + ' ✅ [VidVault Fallback] Extracted ' + parsedQualities.length + ' streams, best: ' + parsedQualities[0].quality);

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
      console.warn(TAG + ' ⚠️ [VidVault Fallback] Error: ' + (e.message || e));
      return null;
    }
  }

  // ─── Main Extract Function ───────────────────────────────────────────────────
  async function extract(tmdbId, arg1, arg2, arg3, arg4, arg5, arg6) {
    var isTv, season, episode, title, imdbId, year;

    if (typeof tmdbId === 'object' && tmdbId !== null) {
      var opt = tmdbId;
      tmdbId = opt.tmdbId;
      imdbId = opt.imdbId;
      title = opt.title;
      isTv = !!opt.isTv;
      season = opt.season;
      episode = opt.episode;
      year = opt.year;
    } else if (typeof arg1 === 'boolean') {
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
      isTv = !!arg3;
      season = arg4;
      episode = arg5;
      year = arg6;
    }

    try {
      var type = isTv ? 'tv' : 'movie';
      console.log(TAG + ' 🔍 Extracting for ' + type + ' tmdbId=' + tmdbId + (isTv ? ' (S' + (season || 1) + 'E' + (episode || 1) + ')' : ''));

      // 1. Try Vidlink fast MP4 first (PRIORITY 1)
      var vidlinkResult = await extractVidlink(type, tmdbId, season, episode);
      if (vidlinkResult) return vidlinkResult;

      // 2. Fall back to Native VidVault Direct (PRIORITY 2 FALLBACK)
      console.log(TAG + ' 🔄 Vidlink returned no streams, trying VidVault native fallback...');
      var nativeResult = await extractNativeVidVault(type, tmdbId, season, episode, title, year);
      if (nativeResult) return nativeResult;

      console.warn(TAG + ' ❌ Both Vidlink and VidVault failed for tmdbId=' + tmdbId);
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
