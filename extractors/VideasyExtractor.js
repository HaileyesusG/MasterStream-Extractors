/**
 * Videasy / CineJoy Extractor
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
  var TMDB_KEY = 'a2dc7e427ce7dc4a54a518f239a51909';

  // In-memory cache for media metadata (title, year, imdbId)
  var metaCache = {};

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
          }, 5000)
        : null;
      var reqHeaders = Object.assign({}, headers || {});
      var res = await fetch(url, {
        method: 'GET',
        headers: reqHeaders,
        signal: controller ? controller.signal : undefined,
      });
      if (timeoutId) clearTimeout(timeoutId);
      if (!res || !res.ok) return false;
      var text = await res.text();
      if (text.indexOf('<html') > -1 || text.indexOf('<!DOCTYPE') > -1) {
        return false;
      }
      return text.indexOf('#EXTM3U') > -1 || (res.status >= 200 && res.status < 400);
    } catch (e) {
      return false;
    }
  }

  async function attachAmharicAudioTrack(result, tmdbId, isTvShow, season, episode, title) {
    if (!result || !result.url) return null;

    if (!result.isPlayableVerified) {
      var isPlayable = await isStreamPlayable(result.url, result.headers);
      if (!isPlayable) {
        console.warn(TAG + ' ⚠️ Primary stream health check failed (unplayable/403/dead) — rejecting result');
        return null;
      }
      result.isPlayableVerified = true;
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

  var B64_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

  function base64UrlEncode(bytes) {
    if (typeof Buffer !== 'undefined') {
      return Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength)
        .toString('base64')
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=+$/, '');
    }
    var len = bytes.length;
    var base64 = '';
    for (var i = 0; i < len; i += 3) {
      var b0 = bytes[i];
      var b1 = i + 1 < len ? bytes[i + 1] : 0;
      var b2 = i + 2 < len ? bytes[i + 2] : 0;
      base64 += B64_CHARS.charAt(b0 >> 2);
      base64 += B64_CHARS.charAt(((b0 & 3) << 4) | (b1 >> 4));
      base64 += i + 1 < len ? B64_CHARS.charAt(((b1 & 15) << 2) | (b2 >> 6)) : '';
      base64 += i + 2 < len ? B64_CHARS.charAt(b2 & 63) : '';
    }
    return base64.replace(/\+/g, '-').replace(/\//g, '_');
  }

  function base64UrlDecodeToUint8(str) {
    var b64 = str.replace(/-/g, '+').replace(/_/g, '/');
    while (b64.length % 4) b64 += '=';
    if (typeof Buffer !== 'undefined') {
      var buf = Buffer.from(b64, 'base64');
      return new Uint8Array(buf.buffer, buf.byteOffset, buf.length);
    }
    if (typeof atob === 'function') {
      var bin = atob(b64);
      var bytes = new Uint8Array(bin.length);
      for (var i = 0; i < bin.length; i++) {
        bytes[i] = bin.charCodeAt(i);
      }
      return bytes;
    }
    var b64Lookup = new Uint8Array(256);
    for (var j = 0; j < B64_CHARS.length; j++) b64Lookup[B64_CHARS.charCodeAt(j)] = j;
    var rawLen = (b64.length * 3) / 4 - (b64.endsWith('==') ? 2 : b64.endsWith('=') ? 1 : 0);
    var out = new Uint8Array(rawLen);
    var p = 0;
    for (var k = 0; k < b64.length; k += 4) {
      var c0 = b64Lookup[b64.charCodeAt(k)];
      var c1 = b64Lookup[b64.charCodeAt(k + 1)];
      var c2 = b64Lookup[b64.charCodeAt(k + 2)];
      var c3 = b64Lookup[b64.charCodeAt(k + 3)];
      out[p++] = (c0 << 2) | (c1 >> 4);
      if (p < rawLen) out[p++] = ((c1 & 15) << 4) | (c2 >> 2);
      if (p < rawLen) out[p++] = ((c2 & 3) << 6) | c3;
    }
    return out;
  }

  /**
   * Post binary data reliably across React Native (Hermes/JSC), Android TV (WebView), and Node.js.
   * Sends ArrayBuffer with explicit 'Content-Type': 'application/octet-stream' so React Native's
   * native NetworkingModule converts it to base64 byte payload instead of throwing
   * "Payload is set but no content-type header specified" or failing on broken user-space Blobs.
   */
  function postBinary(url, headers, uint8Array, timeoutMs) {
    var reqHeaders = Object.assign(
      {
        'Content-Type': 'application/octet-stream',
        Accept: '*/*',
      },
      headers || {}
    );

    if (typeof XMLHttpRequest !== 'undefined') {
      return new Promise(function (resolve, reject) {
        try {
          var xhr = new XMLHttpRequest();
          xhr.open('POST', url, true);
          xhr.responseType = 'arraybuffer';
          xhr.timeout = timeoutMs || 8000;
          for (var k in reqHeaders) {
            try {
              xhr.setRequestHeader(k, reqHeaders[k]);
            } catch (e) {}
          }
          xhr.onload = function () {
            if (xhr.status >= 200 && xhr.status < 300) {
              if (xhr.response) {
                resolve(new Uint8Array(xhr.response));
              } else {
                reject(new Error('Empty response from ' + url));
              }
            } else {
              reject(new Error('HTTP status ' + xhr.status));
            }
          };
          xhr.onerror = function () {
            reject(new Error('XHR Network request failed'));
          };
          xhr.ontimeout = function () {
            reject(new Error('XHR request timeout'));
          };

          // Pass ArrayBuffer directly. Never wrap in new Blob(), which is not supported by React Native's native BlobStore
          var bodyToSend = (uint8Array && uint8Array.buffer) ? uint8Array.buffer : uint8Array;
          xhr.send(bodyToSend);
        } catch (err) {
          reject(err);
        }
      });
    }

    // Node.js fallback
    var nodeBody = uint8Array;
    if (typeof Buffer !== 'undefined' && !(uint8Array instanceof Buffer)) {
      nodeBody = Buffer.from(uint8Array.buffer, uint8Array.byteOffset, uint8Array.byteLength);
    }
    return fetch(url, {
      method: 'POST',
      headers: reqHeaders,
      body: nodeBody,
    }).then(function (res) {
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return res.arrayBuffer();
    }).then(function (buf) {
      return new Uint8Array(buf);
    });
  }

  /**
   * Resolve movie or TV title, release year, and IMDB ID from TMDB.
   * Essential when mobile apps invoke extract(tmdbId, isTv, season, episode)
   * where title/year are omitted.
   */
  async function resolveMediaMeta(tmdbId, isTvShow) {
    if (!tmdbId) return { title: '', year: '', imdbId: '' };
    var key = (isTvShow ? 'tv_' : 'm_') + tmdbId;
    if (metaCache[key]) return metaCache[key];

    try {
      var controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
      var timeoutId = controller ? setTimeout(function () { controller.abort(); }, 3500) : null;
      var endpoint = isTvShow ? 'tv/' + tmdbId : 'movie/' + tmdbId;
      var res = await fetch('https://api.themoviedb.org/3/' + endpoint + '?api_key=' + TMDB_KEY, {
        headers: { 'User-Agent': USER_AGENT },
        signal: controller ? controller.signal : undefined,
      });
      if (timeoutId) clearTimeout(timeoutId);

      if (res && res.ok) {
        var data = await res.json();
        var title = data.name || data.title || data.original_name || data.original_title || '';
        var year = (data.first_air_date || data.release_date || '').slice(0, 4);
        var imdbId = data.imdb_id || '';

        var meta = { title: title, year: year, imdbId: imdbId };
        metaCache[key] = meta;
        return meta;
      }
    } catch (e) {}

    return { title: '', year: '', imdbId: '' };
  }

  async function parseM3u8Qualities(m3u8Text, masterUrl) {
    var qualities = [{ quality: 'Auto', url: masterUrl }];
    if (!m3u8Text) return qualities;

    var lines = m3u8Text.split('\n');
    var hasDemuxedAudio = m3u8Text.indexOf('#EXT-X-MEDIA:TYPE=AUDIO') !== -1;

    var headerLines = [];
    var audioLines = [];
    var rawVariants = [];

    for (var i = 0; i < lines.length; i++) {
      var line = lines[i].trim();
      if (
        line.indexOf('#EXTM3U') === 0 ||
        line.indexOf('#EXT-X-VERSION') === 0 ||
        line.indexOf('#EXT-X-INDEPENDENT-SEGMENTS') === 0
      ) {
        headerLines.push(line);
      } else if (line.indexOf('#EXT-X-MEDIA:TYPE=AUDIO') === 0) {
        var absAudioLine = line.replace(/URI="([^"]+)"/, function (match, uri) {
          try {
            return 'URI="' + new URL(uri, masterUrl).href + '"';
          } catch (e) {
            return match;
          }
        });
        audioLines.push(absAudioLine);
      } else if (line.indexOf('#EXT-X-STREAM-INF') === 0) {
        var resMatch = line.match(/RESOLUTION=\d+x(\d+)/i);
        var nameMatch = line.match(/NAME="([^"]+)"/i);
        var qualityName = (nameMatch && nameMatch[1]) || (resMatch ? resMatch[1] + 'p' : null);

        var nextLine = (lines[i + 1] || '').trim();
        if (qualityName && nextLine && nextLine.indexOf('#') !== 0) {
          try {
            var variantUrl = new URL(nextLine, masterUrl).toString();
            rawVariants.push({
              quality: qualityName,
              infLine: line,
              variantUrl: variantUrl,
            });
          } catch (e) {}
        }
      }
    }

    if (rawVariants.length === 0) return qualities;

    // If HLS has separate demuxed audio tracks, synthesize mini-master playlists
    // so each resolution quality variant plays with full synchronized audio!
    if (hasDemuxedAudio && audioLines.length > 0) {
      try {
        var storePromises = rawVariants.map(function (v) {
          var miniMaster = [
            headerLines.join('\n'),
            '',
            audioLines.join('\n'),
            '',
            v.infLine,
            v.variantUrl,
          ].join('\n');

          return fetch('https://backendmasterstream.onrender.com/api/cinejoy/playlist/store', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ playlist: miniMaster }),
          })
            .then(function (res) { return res.ok ? res.json() : null; })
            .then(function (data) {
              return {
                quality: v.quality,
                url: (data && data.url) ? data.url : v.variantUrl,
              };
            })
            .catch(function () {
              return { quality: v.quality, url: v.variantUrl };
            });
        });

        var resolvedVariants = await Promise.all(storePromises);
        var seen = { 'Auto': true };
        for (var r = 0; r < resolvedVariants.length; r++) {
          var rv = resolvedVariants[r];
          if (!seen[rv.quality]) {
            seen[rv.quality] = true;
            qualities.push(rv);
          }
        }
        return qualities;
      } catch (storeErr) {
        // Fallback quietly if backend is unreachable
      }
    }

    // Fallback for non-demuxed HLS or if store failed
    var seenFallback = { 'Auto': true };
    for (var k = 0; k < rawVariants.length; k++) {
      if (!seenFallback[rawVariants[k].quality]) {
        seenFallback[rawVariants[k].quality] = true;
        qualities.push({ quality: rawVariants[k].quality, url: rawVariants[k].variantUrl });
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

    // Auto-resolve missing title / year / imdbId from TMDB
    if (!title || !year || !imdbId) {
      var meta = await resolveMediaMeta(tmdbId, isTvShow);
      if (!title && meta.title) title = meta.title;
      if (!year && meta.year) year = meta.year;
      if (!imdbId && meta.imdbId) imdbId = meta.imdbId;
    }

    console.log(
      TAG +
        ' 🚀 Extracting "' +
        (title || tmdbId) +
        '" (' +
        (year || '?') +
        ') isTv=' +
        isTvShow +
        (isTvShow ? ' s=' + season + ' e=' + episode : '')
    );

    var defaultServers = ['Light', 'Lisbon', 'Nebula', 'Comet', 'Zenith'];
    var servers = defaultServers;
    try {
      var sController = typeof AbortController !== 'undefined' ? new AbortController() : null;
      var sTimeout = sController ? setTimeout(function () { sController.abort(); }, 2500) : null;
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
        var sList = Array.isArray(sData) ? sData : (sData && Array.isArray(sData.servers) ? sData.servers : []);
        if (sList.length > 0) {
          var dynNames = sList.map(function (s) { return s.name; }).filter(Boolean);
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

        // Step 1: Encrypt request payload via enc-dec.app
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

        var encText = await encRes.text();
        var encData = null;
        try {
          encData = JSON.parse(encText);
        } catch (_) {
          continue;
        }
        if (!encData || !encData.result || !encData.result.data || !encData.result.state) continue;

        // Step 2: Post binary data to api.wing.st/g via XHR / Node postBinary
        var postBody = base64UrlDecodeToUint8(encData.result.data);
        var gBytes = null;
        try {
          gBytes = await postBinary(
            'https://api.wing.st/g',
            {
              Origin: 'https://cinejoy.pk',
              Referer: 'https://cinejoy.pk/',
              'User-Agent': USER_AGENT,
            },
            postBody,
            7000
          );
        } catch (xhrErr) {
          console.warn(TAG + ' ⚠️ Binary post to api.wing.st/g failed for [' + server + ']: ' + (xhrErr.message || xhrErr));
          continue;
        }

        if (!gBytes || gBytes.length === 0) continue;
        var gBase64Url = base64UrlEncode(gBytes);

        // Step 3: Decrypt response payload via enc-dec.app
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

        var decText = await decRes.text();
        var decData = null;
        try {
          decData = JSON.parse(decText);
        } catch (_) {
          continue;
        }

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
            var parsed = await parseM3u8Qualities(m3u8Text, hlsStream.playlist);
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
          isPlayableVerified: true,
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
