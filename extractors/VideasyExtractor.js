/**
 * Videasy / CineJoy v2 Extractor
 * Powered by api.wing.st / CineJoy API
 *
 * Remote hot-update CommonJS module for Android TV and React Native Mobile.
 * Uses enc-dec.app encryption/decryption endpoints to stream movies and TV series
 * with multi-resolution HLS support and multi-language subtitles.
 */
(function () {
  'use strict';

  var TAG = '[VideasyExtractor]';
  var USER_AGENT =
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36';

  // Catalog of Amharic dubbed movies and TV series
  var AMHARIC_CATALOG = {
    tv: {
      '288673_1_8': {
        title: 'Carrie S1E8',
        uniqueId: 'AgADcR4AAnAzSFI',
        fallbackUrl: 'https://stream.unlockify.ink/internal-stream/AgADcR4AAnAzSFI',
      },
      '1407_1_8': {
        title: 'Carrie (Homeland) S1E8',
        uniqueId: 'AgADcR4AAnAzSFI',
        fallbackUrl: 'https://stream.unlockify.ink/internal-stream/AgADcR4AAnAzSFI',
      },
    },
    movies: {},
  };

  var dynamicCatalogCache = null;
  var dynamicCatalogExpiry = 0;

  async function getAmharicCatalog() {
    var now = Date.now();
    if (dynamicCatalogCache && now < dynamicCatalogExpiry) {
      return dynamicCatalogCache;
    }
    try {
      var controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
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
          dynamicCatalogExpiry = now + 5 * 60 * 1000;
          return dynamicCatalogCache;
        }
      }
    } catch (e) {
      // Fall back quietly
    }
    return AMHARIC_CATALOG;
  }

  async function isStreamPlayable(url, headers) {
    if (!url) return false;
    try {
      var controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
      var timeoutId = controller
        ? setTimeout(function () {
            try {
              controller.abort();
            } catch (e) {}
          }, 4000)
        : null;
      var reqHeaders = Object.assign({}, headers || {}, { Range: 'bytes=0-10' });
      var res = await fetch(url, {
        method: 'GET',
        headers: reqHeaders,
        signal: controller ? controller.signal : undefined,
      });
      if (timeoutId) clearTimeout(timeoutId);
      return res.status >= 200 && res.status < 400;
    } catch (e) {
      return false;
    }
  }

  async function attachAmharicAudioTrack(result, tmdbId, isTvShow, season, episode, title) {
    if (!result || !result.url) return null;

    var isPlayable = await isStreamPlayable(result.url, result.headers);
    if (!isPlayable) {
      console.warn(TAG + ' ⚠️ Primary stream health check failed (unplayable/403/dead) — rejecting result');
      return null;
    }

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
        : item.fallbackUrl || item.streamUrl;

      var englishQualities =
        result.qualities && result.qualities.length > 0
          ? result.qualities
          : [{ quality: result.quality || 'Auto', url: result.url }];

      var amharicQualities = [
        { quality: '1080p', url: amharicUrl },
        { quality: 'Auto', url: amharicUrl },
      ];

      var amharicLabel = 'Amharic (\u1260\u1275\u122d\u1309\u121d)';
      var existingAudio = result.audioTracks || [
        {
          language: 'English',
          url: result.url,
          qualities: englishQualities,
        },
      ];

      if (!existingAudio.some(function (a) { return a.language === amharicLabel; })) {
        existingAudio.push({
          language: amharicLabel,
          url: amharicUrl,
          qualities: amharicQualities,
        });
      }
      result.audioTracks = existingAudio;
      console.log(TAG + ' 🇪🇹 Attached Amharic audio track (.mp4 redirect) to result');
    } catch (err) {}
    return result;
  }

  function base64UrlEncode(bytes) {
    var b64 = '';
    if (typeof Buffer !== 'undefined') {
      b64 = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString('base64');
    } else {
      var bin = '';
      var len = bytes.byteLength;
      for (var i = 0; i < len; i++) {
        bin += String.fromCharCode(bytes[i]);
      }
      b64 = typeof btoa === 'function' ? btoa(bin) : '';
    }
    return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }

  function base64UrlDecodeToUint8(str) {
    var b64 = str.replace(/-/g, '+').replace(/_/g, '/');
    while (b64.length % 4) b64 += '=';
    if (typeof Buffer !== 'undefined') {
      var buf = Buffer.from(b64, 'base64');
      return new Uint8Array(buf.buffer, buf.byteOffset, buf.length);
    }
    var bin = typeof atob === 'function' ? atob(b64) : '';
    var bytes = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) {
      bytes[i] = bin.charCodeAt(i);
    }
    return bytes;
  }

  function parseM3u8Qualities(m3u8Text, masterUrl) {
    var qualities = [{ quality: 'Auto', url: masterUrl }];
    if (!m3u8Text) return qualities;
    var lines = m3u8Text.split('\n');
    for (var i = 0; i < lines.length; i++) {
      var line = lines[i].trim();
      if (line.indexOf('#EXT-X-STREAM-INF') === 0) {
        var resMatch = line.match(/RESOLUTION=\d+x(\d+)/i);
        var nameMatch = line.match(/NAME="([^"]+)"/i);
        var qualityName = (nameMatch && nameMatch[1]) || (resMatch ? resMatch[1] + 'p' : null);
        var nextLine = (lines[i + 1] || '').trim();
        if (qualityName && nextLine && nextLine.indexOf('#') !== 0) {
          try {
            var variantUrl = new URL(nextLine, masterUrl).toString();
            qualities.push({ quality: qualityName, url: variantUrl });
          } catch (e) {}
        }
      }
    }
    return qualities;
  }

  async function extract(tmdbId, arg1, arg2, arg3, arg4, arg5, arg6) {
    var imdbId, title, isTv, season, episode, year;

    if (typeof arg1 === 'boolean') {
      isTv = arg1;
      season = arg2;
      episode = arg3;
    } else if (typeof arg2 === 'boolean') {
      imdbId = arg1;
      isTv = arg2;
      season = arg3;
      episode = arg4;
    } else {
      imdbId = arg1;
      title = arg2;
      isTv = arg3;
      season = arg4;
      episode = arg5;
      year = arg6;
    }

    var isTvShow = isTv === true || String(isTv) === 'true' || String(isTv) === 'tv';
    var id = tmdbId || imdbId;
    if (!id) {
      console.warn(TAG + ' ❌ Missing tmdbId and imdbId');
      return null;
    }

    console.log(TAG + ' 🚀 Extracting tmdbId=' + tmdbId + ' isTv=' + isTvShow + (isTvShow ? (' s=' + season + ' e=' + episode) : ''));

    var defaultServers = ['Light', 'Lisbon', 'Nebula', 'Comet', 'Zenith'];
    var servers = defaultServers;
    try {
      var sController = typeof AbortController !== 'undefined' ? new AbortController() : null;
      var sTimeout = sController ? setTimeout(function () { sController.abort(); }, 2000) : null;
      var sRes = await fetch('https://api.wing.st/servers', {
        headers: {
          Origin: 'https://cinejoy.pk',
          Referer: 'https://cinejoy.pk/',
          'User-Agent': USER_AGENT,
        },
        signal: sController ? sController.signal : undefined,
      });
      if (sTimeout) clearTimeout(sTimeout);
      if (sRes && sRes.ok) {
        var sData = await sRes.json();
        if (Array.isArray(sData) && sData.length > 0) {
          var dynNames = sData.map(function (s) { return s.name; }).filter(Boolean);
          var prioritized = ['Light', 'Lisbon', 'Nebula', 'Comet', 'Zenith'];
          var ordered = [];
          for (var pi = 0; pi < prioritized.length; pi++) {
            if (dynNames.indexOf(prioritized[pi]) !== -1) ordered.push(prioritized[pi]);
          }
          for (var di = 0; di < dynNames.length; di++) {
            if (ordered.indexOf(dynNames[di]) === -1) ordered.push(dynNames[di]);
          }
          if (ordered.length > 0) servers = ordered;
        }
      }
    } catch (e) {}

    for (var si = 0; si < servers.length; si++) {
      var server = servers[si];
      try {
        var targetUrl =
          'https://api.wing.st/?title=' +
          encodeURIComponent(title || '') +
          '&type=' +
          (isTvShow ? 'series' : 'movie') +
          '&year=' +
          (year || '') +
          '&imdb=' +
          (imdbId || '') +
          '&tmdb=' +
          (tmdbId || '') +
          '&server=' +
          encodeURIComponent(server);

        if (isTvShow) {
          targetUrl += '&season=' + (season || 1) + '&episode=' + (episode || 1);
        }

        var encController = typeof AbortController !== 'undefined' ? new AbortController() : null;
        var encTimeout = encController ? setTimeout(function () { encController.abort(); }, 5000) : null;
        var encRes = await fetch(
          'https://enc-dec.app/api/enc-cinejoy?url=' + encodeURIComponent(targetUrl),
          {
            headers: { 'User-Agent': USER_AGENT },
            signal: encController ? encController.signal : undefined,
          }
        );
        if (encTimeout) clearTimeout(encTimeout);
        if (!encRes.ok) continue;

        var encData = await encRes.json();
        if (!encData || !encData.result || !encData.result.data || !encData.result.state) continue;

        var postBody = base64UrlDecodeToUint8(encData.result.data);
        var gController = typeof AbortController !== 'undefined' ? new AbortController() : null;
        var gTimeout = gController ? setTimeout(function () { gController.abort(); }, 6000) : null;
        var gRes = await fetch('https://api.wing.st/g', {
          method: 'POST',
          headers: {
            Origin: 'https://cinejoy.pk',
            Referer: 'https://cinejoy.pk/',
            'User-Agent': USER_AGENT,
          },
          body: postBody,
          signal: gController ? gController.signal : undefined,
        });
        if (gTimeout) clearTimeout(gTimeout);
        if (!gRes.ok) continue;

        var gArrayBuf = await gRes.arrayBuffer();
        var gBytes = new Uint8Array(gArrayBuf);
        if (gBytes.length === 0) continue;
        var gBase64Url = base64UrlEncode(gBytes);

        var decController = typeof AbortController !== 'undefined' ? new AbortController() : null;
        var decTimeout = decController ? setTimeout(function () { decController.abort(); }, 5000) : null;
        var decRes = await fetch('https://enc-dec.app/api/dec-cinejoy', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'User-Agent': USER_AGENT,
          },
          body: JSON.stringify({
            text: gBase64Url,
            state: encData.result.state,
          }),
          signal: decController ? decController.signal : undefined,
        });
        if (decTimeout) clearTimeout(decTimeout);
        if (!decRes.ok) continue;

        var decData = await decRes.json();
        var streams = (decData && decData.result && decData.result.data && decData.result.data.stream) || [];
        var hlsStream = null;
        for (var sti = 0; sti < streams.length; sti++) {
          if (streams[sti] && streams[sti].type === 'hls' && streams[sti].playlist) {
            hlsStream = streams[sti];
            break;
          }
        }
        if (!hlsStream || !hlsStream.playlist) continue;

        var streamHeaders = {
          Origin: 'https://cinejoy.pk',
          Referer: 'https://cinejoy.pk/',
          'User-Agent': USER_AGENT,
        };

        // Check stream playability
        var playable = await isStreamPlayable(hlsStream.playlist, streamHeaders);
        if (!playable) continue;

        // Extract subtitles
        var subtitles = [];
        if (Array.isArray(hlsStream.captions)) {
          for (var ci = 0; ci < hlsStream.captions.length; ci++) {
            var cap = hlsStream.captions[ci];
            if (cap && cap.url) {
              subtitles.push({
                label: cap.language || cap.id || 'Subtitle',
                lang: cap.id || cap.language || 'en',
                url: cap.url,
              });
            }
          }
        }

        // Fetch master.m3u8 text to parse resolution qualities
        var qualities = [{ quality: 'Auto', url: hlsStream.playlist }];
        try {
          var m3u8Res = await fetch(hlsStream.playlist, {
            headers: streamHeaders,
          });
          if (m3u8Res.ok) {
            var m3u8Text = await m3u8Res.text();
            var parsed = parseM3u8Qualities(m3u8Text, hlsStream.playlist);
            if (parsed.length > 1) {
              qualities = parsed;
            }
          }
        } catch (e) {}

        console.log(
          TAG +
            ' ✅ Extracted stream from [' +
            server +
            ']: ' +
            hlsStream.playlist.slice(0, 70) +
            '... (qualities: ' +
            qualities.length +
            ', subtitles: ' +
            subtitles.length +
            ')'
        );

        var result = {
          url: hlsStream.playlist,
          quality: 'Auto',
          provider: 'Videasy',
          headers: streamHeaders,
          subtitles: subtitles,
          qualities: qualities,
        };

        var finalRes = await attachAmharicAudioTrack(result, tmdbId, isTvShow, season, episode, title);
        if (finalRes && finalRes.url) {
          return finalRes;
        }
      } catch (err) {
        console.warn(TAG + ' ⚠️ Server ' + server + ' failed: ' + (err.message || err));
      }
    }

    console.warn(TAG + ' ❌ All servers failed or returned unplayable streams');
    return null;
  }

  var extractor = {
    name: 'Videasy',
    extract: extract,
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = extractor;
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
    gObj.VideasyExtractor = extractor;
    gObj.Videasy = extractor;
  }
})();
