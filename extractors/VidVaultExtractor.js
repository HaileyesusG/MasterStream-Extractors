/**
 * VidVault Remote Extractor (Dual-Engine: Vidlink Priority 1 + VidVault Fallback Priority 2)
 *
 * Dedicated to downloading and streaming movies & TV series in MasterStream (DownloadOptionsModal).
 *
 * ENGINE 1 (Vidlink Direct MP4 Priority):
 * - Primary fast high-speed CDN streams (1080p, 720p, 480p)
 * - Automatically performs a fast health check on candidate streams
 * - If Vidlink returns dead/blocked links (e.g. HTTP 429/428), it automatically falls through to VidVault native
 *
 * ENGINE 2 (Native VidVault Direct Fallback):
 * - Fallback if Vidlink does not have the title or Vidlink links are dead
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

  // Fast pre-flight health check to verify a stream link is actually reachable and not blocked (HTTP 429/428/403)
  async function isStreamPlayable(url, headers) {
    if (!url) return false;
    try {
      var controller = (typeof AbortController !== 'undefined') ? new AbortController() : null;
      var timeoutId = controller ? setTimeout(function () { controller.abort(); }, 3000) : null;
      var reqHeaders = Object.assign({}, headers || {}, { 'Range': 'bytes=0-10' });
      var res = await fetch(url, {
        method: 'GET',
        headers: reqHeaders,
        signal: controller ? controller.signal : undefined
      });
      if (timeoutId) clearTimeout(timeoutId);
      // Status 200 or 206 confirms the CDN is alive and serving bytes!
      return res.status === 200 || res.status === 206;
    } catch (e) {
      return false;
    }
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

      // Provide 1080p, 720p, and 480p options (hide 360p)
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

      // ─── STREAM HEALTH CHECK ──────────────────────────────────────────────
      // Verify that the stream URL actually responds with video data.
      // If the CDN returns 429/428/403 (dead link), skip Vidlink so VidVault native can take over!
      var isAlive = await isStreamPlayable(parsedQualities[0].url, {});
      if (!isAlive) {
        console.warn(TAG + ' ⚠️ [Vidlink] Stream health check failed (dead or blocked link), skipping to VidVault fallback!');
        return null;
      }

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

      console.log(TAG + ' ✅ [Vidlink Priority 1] Extracted & verified ' + parsedQualities.length + ' MP4 streams (' + parsedQualities.map(function(q){return q.quality;}).join(', ') + '), best: ' + parsedQualities[0].quality);

      return {
        url: parsedQualities[0].url,
        quality: parsedQualities[0].quality,
        qualities: parsedQualities,
        provider: 'VidVault',
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
      var pageUrl = type === 'tv'
        ? VIDVAULT_BASE + '/tv/' + tmdbId + '/' + (season || 1) + '/' + (episode || 1)
        : VIDVAULT_BASE + '/movie/' + tmdbId;

      console.log(TAG + ' 🚀 [VidVault Native Fallback] Fetching page: ' + pageUrl);
      var pageRes = await fetch(pageUrl, {
        headers: {
          'User-Agent': USER_AGENT,
          'Referer': VIDVAULT_BASE + '/',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
        }
      });

      if (!pageRes.ok) {
        console.warn(TAG + ' ⚠️ [VidVault Native Fallback] Page fetch HTTP ' + pageRes.status);
        return null;
      }

      var html = await pageRes.text();
      var parsed = [];

      // ─── Format 1 (Current): Direct window.location.href in download button ────
      // e.g. <button type="button" class="download-btn" onclick="showToast(); window.location.href='https://cvt...mkv'">
      //        <span>📥 Download 1080p</span><small>(2.27 GB)</small>
      //      </button>
      var btnRegex = /<button[^>]*onclick=["'][^"']*window\.location\.href\s*=\s*['"]([^'"]+)['"][^"']*["'][^>]*>([\s\S]*?)<\/button>/gi;
      var match;

      while ((match = btnRegex.exec(html)) !== null) {
        var rawUrl = match[1];
        var btnInner = match[2];

        var cleanUrl = String(rawUrl).split('?')[0].split('#')[0];
        if (!cleanUrl.endsWith('.mkv')) cleanUrl += '.mkv';

        var qMatch = btnInner.match(/Download\s*(\d+p?)/i);
        var qualityStr = qMatch ? qMatch[1] : '';
        if (qualityStr && !qualityStr.toLowerCase().endsWith('p')) {
          qualityStr += 'p';
        }

        var sizeMatch = btnInner.match(/<small>\(([^)]+)\)<\/small>/i);
        var sizeStr = sizeMatch ? sizeMatch[1] : '';

        var qNum = parseQualityNumber(qualityStr) || 1080;
        var qLabel = (qualityStr || (qNum + 'p')) + ' (MKV)';
        if (sizeStr) qLabel += ' [' + sizeStr + ']';

        parsed.push({
          quality: qLabel,
          qualityNum: qNum,
          url: cleanUrl,
          size: sizeStr
        });
      }

      // ─── Format 2 (Legacy): requestDownload('movie', 'id', ...) in onclick ─────
      if (parsed.length === 0) {
        var preConverted = [];
        var dlMatches = [...html.matchAll(/requestDownload\(\s*['"]([^'"]+)['"]\s*,\s*['"]([^'"]+)['"]\s*,\s*['"]([^'"]*)['"]\s*,\s*['"]([^'"]*)['"]\s*,\s*['"]([^'"]+)['"]\s*\)/gi)];
        for (var d = 0; d < dlMatches.length; d++) {
          var dm = dlMatches[d];
          preConverted.push({
            type: dm[1],
            id: dm[2],
            season: dm[3],
            episode: dm[4],
            quality: dm[5]
          });
        }

        for (var i = 0; i < preConverted.length; i++) {
          var item = preConverted[i];
          var dlApi = VIDVAULT_BASE + '/download-link/' + encodeURIComponent(item.type) + '/' + encodeURIComponent(item.id);
          if (item.season && item.episode) {
            dlApi += '/' + encodeURIComponent(item.season) + '/' + encodeURIComponent(item.episode);
          }
          dlApi += '/' + encodeURIComponent(item.quality);

          try {
            var dlRes = await fetch(dlApi, {
              headers: {
                'User-Agent': USER_AGENT,
                'Referer': pageUrl,
                'Accept': 'application/json, text/plain, */*'
              }
            });
            if (dlRes.ok) {
              var data = await dlRes.json();
              if (data && data.url) {
                var cUrl = String(data.url).split('?')[0].split('#')[0];
                if (!cUrl.endsWith('.mkv')) cUrl += '.mkv';

                var legacyNum = parseQualityNumber(item.quality);
                parsed.push({
                  quality: (item.quality || 'Direct') + ' (MKV)',
                  qualityNum: legacyNum,
                  url: cUrl,
                  size: ''
                });
              }
            }
          } catch (e) {}
        }
      }

      if (parsed.length === 0) {
        console.warn(TAG + ' ⚠️ [VidVault Native Fallback] No pre-converted downloads ready on ' + pageUrl);
        return null;
      }

      // Sort: highest resolution first (1080p > 720p > 480p > 360p)
      parsed.sort(function (a, b) {
        return b.qualityNum - a.qualityNum;
      });

      // Health check the top candidate stream
      var isAlive = await isStreamPlayable(parsed[0].url, { 'Referer': VIDVAULT_BASE + '/' });
      if (!isAlive) {
        console.warn(TAG + ' ⚠️ [VidVault Native Fallback] Top stream health check failed, checking remaining qualities...');
        var viable = null;
        for (var k = 1; k < parsed.length; k++) {
          if (await isStreamPlayable(parsed[k].url, { 'Referer': VIDVAULT_BASE + '/' })) {
            viable = parsed[k];
            break;
          }
        }
        if (!viable) {
          console.warn(TAG + ' ⚠️ [VidVault Native Fallback] All streams failed health check');
          return null;
        }
        parsed = parsed.filter(function (p) { return p !== viable; });
        parsed.unshift(viable);
      }

      var parsedQualities = parsed.map(function (p) {
        return { quality: p.quality, url: p.url };
      });

      console.log(TAG + ' ✅ [VidVault Native Fallback] Extracted ' + parsedQualities.length + ' download streams, best: ' + parsedQualities[0].quality);

      return {
        url: parsedQualities[0].url,
        quality: parsedQualities[0].quality,
        qualities: parsedQualities,
        provider: 'VidVault',
        headers: {
          'Referer': VIDVAULT_BASE + '/',
          'User-Agent': USER_AGENT
        },
        subtitles: []
      };
    } catch (e) {
      console.warn(TAG + ' ⚠️ [VidVault Native Fallback] Error: ' + (e.message || e));
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
      console.log(TAG + ' 🔄 Vidlink skipped/unavailable, trying VidVault native fallback...');
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
