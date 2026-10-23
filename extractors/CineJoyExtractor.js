/**
 * Vidly / CineJoy Extractor
 * Powered by https://vidly.pro
 *
 * Supports movies, TV series, multi-audio separate streams (mapped to audioTracks),
 * native HLS resolution variants (mapped to qualities), and multi-language subtitles.
 * Remote hot-update CommonJS module for Android TV and React Native Mobile.
 */
(function () {
  'use strict';

  var TAG = '[CineJoyExtractor]';
  var DOMAIN = 'https://vidly.pro';
  var CIPHER_KEY = 'vY7#qL2!mZ9@wK4$';
  var USER_AGENT =
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36';

  // Base64 decoder compatible with Hermes, V8, Node, and browser
  function decodeBase64(b64) {
    if (typeof atob === 'function') {
      return atob(b64);
    }
    if (typeof Buffer !== 'undefined') {
      return Buffer.from(b64, 'base64').toString('binary');
    }
    var chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=';
    var str = String(b64).replace(/[=]+$/, '');
    var output = '';
    for (
      var bc = 0, bs = 0, buffer, idx = 0;
      (buffer = str.charAt(idx++));
      ~buffer && ((bs = bc % 4 ? bs * 64 + buffer : buffer), bc++ % 4)
        ? (output += String.fromCharCode(255 & (bs >> ((-2 * bc) & 6))))
        : 0
    ) {
      buffer = chars.indexOf(buffer);
    }
    return output;
  }

  // UTF-8 decoder compatible with Hermes, V8, Node, and browser
  function decodeUtf8(bytes) {
    if (typeof TextDecoder !== 'undefined') {
      return new TextDecoder().decode(bytes);
    }
    if (typeof Buffer !== 'undefined') {
      return Buffer.from(bytes).toString('utf8');
    }
    var out = '';
    var i = 0;
    while (i < bytes.length) {
      var c = bytes[i++];
      if (c >> 7 === 0) {
        out += String.fromCharCode(c);
      } else if (c >> 5 === 0x06) {
        out += String.fromCharCode(((c & 0x1f) << 6) | (bytes[i++] & 0x3f));
      } else if (c >> 4 === 0x0e) {
        out += String.fromCharCode(
          ((c & 0x0f) << 12) | ((bytes[i++] & 0x3f) << 6) | (bytes[i++] & 0x3f)
        );
      }
    }
    return out;
  }

  /**
   * Decrypts Vidly's v1. sealed payload
   */
  function decryptPayload(sealed) {
    if (!sealed || typeof sealed !== 'string' || sealed.indexOf('v1.') !== 0) {
      return null;
    }
    try {
      var b64 = sealed.slice(3).replace(/-/g, '+').replace(/_/g, '/');
      var binaryStr = decodeBase64(b64);
      var rawBytes = new Uint8Array(binaryStr.length);
      for (var i = 0; i < binaryStr.length; i++) {
        rawBytes[i] = binaryStr.charCodeAt(i);
      }

      var nonce = rawBytes.subarray(0, 12);
      var payload = rawBytes.slice(12);

      // Key schedule
      var state = [];
      for (var s = 0; s < 4; s++) {
        var n = (0x811c9dc5 ^ (0x9e3779b9 * s)) >>> 0;
        for (var k = 0; k < CIPHER_KEY.length; k++) {
          n = Math.imul(n ^ CIPHER_KEY.charCodeAt(k), 0x1000193) >>> 0;
        }
        for (var p = 0; p < nonce.length; p++) {
          n = Math.imul(n ^ nonce[p], 0x1000193) >>> 0;
        }
        state.push(n);
      }

      var s0 = state[0],
        s1 = state[1],
        s2 = state[2],
        s3 = state[3];
      var keystreamWord = 0;

      for (var t = 0; t < payload.length; t++) {
        if ((3 & t) === 0) {
          s2 >>>= 0;
          s3 >>>= 0;
          var eSum = ((s0 >>>= 0) + (s1 >>>= 0)) | 0;
          s0 = s1 ^ (s1 >>> 9);
          s1 = (s2 + (s2 << 3)) | 0;
          s3 = (s3 + 1) | 0;
          s2 = ((s2 << 21) | (s2 >>> 11)) + (eSum = (eSum + s3) | 0) | 0;
          keystreamWord = eSum >>> 0;
        }
        payload[t] ^= (keystreamWord >>> ((3 & t) * 8)) & 255;
      }

      var jsonStr = decodeUtf8(payload);
      return JSON.parse(jsonStr);
    } catch (err) {
      return null;
    }
  }

  /**
   * Main extract function supporting dual calling conventions:
   *   Mobile: (tmdbId, isTv, season, episode)
   *   TV:     (tmdbId, imdbId, title, isTv, season, episode, year)
   */
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

    var pageUrl = isTvShow
      ? DOMAIN + '/tv/' + id + '/' + (season || 1) + '/' + (episode || 1)
      : DOMAIN + '/movie/' + id;

    console.log(TAG + ' 🚀 Fetching embed page: ' + pageUrl);

    try {
      var pageRes = await fetch(pageUrl, {
        headers: {
          'User-Agent': USER_AGENT,
          Referer: DOMAIN + '/',
          Origin: DOMAIN,
        },
      });

      if (!pageRes.ok) {
        console.warn(TAG + ' ❌ HTTP ' + pageRes.status + ' for ' + pageUrl);
        return null;
      }

      var html = await pageRes.text();

      // Extract session token from HTML script props
      var tokenMatch = html.match(/\\*"token\\*":\s*\\*"([^\\"]+)/);
      var token = tokenMatch ? tokenMatch[1] : null;

      // Find all encrypted v1. payloads in page HTML
      var v1Matches = html.match(/v1\.[a-zA-Z0-9_-]{50,}/g) || [];
      var streams = [];
      var servers = [];

      for (var vi = 0; vi < v1Matches.length; vi++) {
        var data = decryptPayload(v1Matches[vi]);
        if (data) {
          if (Array.isArray(data.streams) && data.streams.length > 0) {
            streams = streams.concat(data.streams);
          }
          if (Array.isArray(data.servers) && servers.length === 0) {
            servers = data.servers;
          }
        }
      }

      // If initial streams don't have multi-audio languages, query MULTI servers (Prism / Citadel)
      var hasMultiAudio = false;
      for (var si = 0; si < streams.length; si++) {
        if (streams[si].language && streams[si].language.toLowerCase() !== 'undefined') {
          hasMultiAudio = true;
          break;
        }
      }

      if (!hasMultiAudio && token && servers.length > 0) {
        for (var svi = 0; svi < servers.length; svi++) {
          var sItem = servers[svi];
          var sId = (sItem && sItem.id) || sItem;
          var sTag = sItem && sItem.tag ? String(sItem.tag).toUpperCase() : '';
          if (sTag === 'MULTI' || sId === 'prism' || sId === 'citadel') {
            try {
              var qParams = 'kind=' + (isTvShow ? 'tv' : 'movie') +
                '&provider=' + encodeURIComponent(sId) +
                '&t=' + encodeURIComponent(token) +
                '&tmdb=' + encodeURIComponent(id);
              if (isTvShow) {
                qParams += '&season=' + encodeURIComponent(season || 1) +
                  '&episode=' + encodeURIComponent(episode || 1);
              }
              var sRes = await fetch(DOMAIN + '/api/sources?' + qParams, {
                headers: {
                  'User-Agent': USER_AGENT,
                  Referer: pageUrl,
                  Origin: DOMAIN,
                },
              });
              if (sRes.ok) {
                var sText = await sRes.text();
                var sData = decryptPayload(sText);
                if (sData && Array.isArray(sData.streams) && sData.streams.length > 0) {
                  streams = streams.concat(sData.streams);
                }
              }
            } catch (svErr) {
              // Ignore single server query error
            }
          }
        }
      }

      // Fallback: If no streams decrypted from v1., extract raw .m3u8 URLs from HTML
      if (streams.length === 0) {
        var m3u8Links = html.match(/https?:\/\/[^\s"'`\\]+\.m3u8[^\s"'`\\]*/g) || [];
        for (var mi = 0; mi < m3u8Links.length; mi++) {
          var cleanUrl = m3u8Links[mi].replace(/&amp;/g, '&').replace(/\\u0026/g, '&');
          streams.push({
            url: cleanUrl,
            quality: 'Auto',
            type: 'hls',
          });
        }
      }

      if (streams.length === 0) {
        console.warn(TAG + ' ❌ No streams found on vidly.pro');
        return null;
      }

      // Group all streams by audio language:
      // Map: language -> [{ quality: '1080p', url: '...' }]
      var langMap = {};
      var langOrder = [];
      var seenStreamUrls = {};

      for (var stIdx = 0; stIdx < streams.length; stIdx++) {
        var sObj = streams[stIdx];
        if (!sObj || !sObj.url) continue;
        var sUrl = sObj.url.replace(/&amp;/g, '&').replace(/\\u0026/g, '&');
        if (seenStreamUrls[sUrl]) continue;
        seenStreamUrls[sUrl] = true;

        var rawLang = (sObj.language || '').trim();
        if (!rawLang || rawLang.toLowerCase() === 'undefined') {
          if (sObj.label && sObj.label.indexOf('·') !== -1) {
            rawLang = sObj.label.split('·')[0].trim();
          } else {
            rawLang = 'English';
          }
        }
        // Normalize language label
        var langName = rawLang.charAt(0).toUpperCase() + rawLang.slice(1);
        if (langName.toLowerCase() === 'original') {
          langName = 'English';
        }

        if (!langMap[langName]) {
          langMap[langName] = [];
          langOrder.push(langName);
        }

        var qLabel = sObj.quality || 'Auto';
        langMap[langName].push({
          quality: qLabel,
          url: sUrl,
        });
      }

      // Sort audio languages so English is ALWAYS FIRST at index 0
      langOrder.sort(function (a, b) {
        var aIsEng = a.toLowerCase().indexOf('english') === 0;
        var bIsEng = b.toLowerCase().indexOf('english') === 0;
        if (aIsEng && !bIsEng) return -1;
        if (!aIsEng && bIsEng) return 1;
        return a.localeCompare(b);
      });

      // Build AudioTrackVariant array for Mobile and TV app
      var audioTracks = [];
      for (var lo = 0; lo < langOrder.length; lo++) {
        var lKey = langOrder[lo];
        var qArr = langMap[lKey];
        if (qArr && qArr.length > 0) {
          audioTracks.push({
            language: lKey,
            url: qArr[0].url,
            qualities: qArr,
          });
        }
      }

      // Helper to discover all resolution variants (1080p, 720p, 480p) from an HLS master playlist
      async function parseM3u8Qualities(masterUrl) {
        if (!masterUrl || masterUrl.indexOf('.m3u8') === -1) return [];
        try {
          var res = await fetch(masterUrl, {
            headers: {
              'User-Agent': USER_AGENT,
              Referer: DOMAIN + '/',
              Origin: DOMAIN,
            },
          });
          if (!res.ok) return [];
          var text = await res.text();
          var lines = text.split('\n');
          var list = [];
          var seen = {};

          for (var i = 0; i < lines.length; i++) {
            var line = lines[i].trim();
            if (line.indexOf('#EXT-X-STREAM-INF:') === 0) {
              var resMatch = line.match(/RESOLUTION=(\d+x\d+)/i);
              var bwMatch = line.match(/BANDWIDTH=(\d+)/i);
              var nextLine = lines[i + 1] ? lines[i + 1].trim() : '';
              if (nextLine && nextLine.indexOf('#') !== 0) {
                var absUrl = nextLine;
                try {
                  absUrl = new URL(nextLine, masterUrl).href;
                } catch (e) {
                  if (nextLine.indexOf('http') !== 0) {
                    var lastSlash = masterUrl.lastIndexOf('/');
                    absUrl = masterUrl.substring(0, lastSlash + 1) + nextLine;
                  }
                }

                var qLabel = '1080p';
                if (resMatch) {
                  var parts = resMatch[1].split('x');
                  var h = parts[1] || parts[0];
                  qLabel = h + 'p';
                } else if (bwMatch) {
                  var bw = parseInt(bwMatch[1], 10);
                  if (bw > 3000000) qLabel = '1080p';
                  else if (bw > 1500000) qLabel = '720p';
                  else if (bw > 600000) qLabel = '480p';
                  else qLabel = '360p';
                }

                if (!seen[qLabel]) {
                  seen[qLabel] = true;
                  list.push({ quality: qLabel, url: absUrl });
                }
              }
            }
          }

          list.sort(function (a, b) {
            var aNum = parseInt(a.quality.replace(/\D/g, ''), 10) || 0;
            var bNum = parseInt(b.quality.replace(/\D/g, ''), 10) || 0;
            return bNum - aNum;
          });

          return list;
        } catch (err) {
          return [];
        }
      }

      // Choose primary audio track (English is guaranteed at index 0)
      var primaryTrack = audioTracks[0];
      var primaryUrl = primaryTrack.url;

      // Expand master playlist into distinct resolution options: Auto, 1080p, 720p, 480p
      var parsedVariants = await parseM3u8Qualities(primaryUrl);
      var finalQualities = [];
      finalQualities.push({ quality: 'Auto', url: primaryUrl });

      if (parsedVariants.length > 0) {
        for (var vi = 0; vi < parsedVariants.length; vi++) {
          finalQualities.push(parsedVariants[vi]);
        }
      } else if (primaryTrack.qualities && primaryTrack.qualities.length > 0) {
        for (var pq = 0; pq < primaryTrack.qualities.length; pq++) {
          if (primaryTrack.qualities[pq].quality !== 'Auto') {
            finalQualities.push(primaryTrack.qualities[pq]);
          }
        }
      }
      primaryTrack.qualities = finalQualities;

      // Fetch full subtitle catalog from /api/subtitles
      var subtitles = [];
      var seenSubUrls = {};

      // 1. Add subtitles embedded in streams
      for (var sc = 0; sc < streams.length; sc++) {
        var strItem = streams[sc];
        if (strItem && Array.isArray(strItem.subtitles)) {
          for (var psubi = 0; psubi < strItem.subtitles.length; psubi++) {
            var subObj = strItem.subtitles[psubi];
            if (subObj && subObj.url && !seenSubUrls[subObj.url]) {
              seenSubUrls[subObj.url] = true;
              subtitles.push({
                url: subObj.url,
                lang: subObj.lang || subObj.label || 'English',
                label: subObj.label || subObj.lang || 'English',
              });
            }
          }
        }
      }

      // 2. Fetch all external subtitles via /api/subtitles
      try {
        var subParams = 'kind=' + (isTvShow ? 'tv' : 'movie') +
          '&tmdb=' + encodeURIComponent(id);
        if (isTvShow) {
          subParams += '&s=' + encodeURIComponent(season || 1) +
            '&e=' + encodeURIComponent(episode || 1);
        }

        var subRes = await fetch(DOMAIN + '/api/subtitles?' + subParams, {
          headers: {
            'User-Agent': USER_AGENT,
            Referer: pageUrl,
            Origin: DOMAIN,
          },
        });

        if (subRes.ok) {
          var subData = await subRes.json();
          if (subData && Array.isArray(subData.subtitles)) {
            for (var sj = 0; sj < subData.subtitles.length; sj++) {
              var sSub = subData.subtitles[sj];
              if (sSub && sSub.url && !seenSubUrls[sSub.url]) {
                seenSubUrls[sSub.url] = true;
                subtitles.push({
                  url: sSub.url,
                  lang: sSub.lang || sSub.label || 'Unknown',
                  label: sSub.label || sSub.lang || 'Unknown',
                });
              }
            }
          }
        }
      } catch (subErr) {
        // Subtitles are non-fatal
      }

      console.log(
        TAG +
          ' ✅ Extracted vidly stream: ' +
          primaryUrl.slice(0, 60) +
          '... (audioTracks: ' +
          audioTracks.length +
          ', qualities: ' +
          finalQualities.length +
          ', subtitles: ' +
          subtitles.length +
          ')'
      );

      return {
        url: primaryUrl,
        quality: 'Auto',
        provider: 'CineJoy',
        headers: {
          'User-Agent': USER_AGENT,
          Referer: DOMAIN + '/',
          Origin: DOMAIN,
        },
        subtitles: subtitles,
        qualities: finalQualities,
        audioTracks: audioTracks.length > 1 ? audioTracks : undefined,
      };
    } catch (err) {
      console.error(TAG + ' ❌ Extraction failed: ' + (err.message || err));
      return null;
    }
  }

  var extractor = { extract: extract };
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
    gObj.CineJoyExtractor = extractor;
  }
})();
