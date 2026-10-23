/**
 * Vidly / CineJoy Extractor
 * Powered by https://vidly.pro
 *
 * Supports movies, TV series, multi-audio HLS streams and multi-language subtitles.
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

      // Find all encrypted v1. payloads in page HTML / Next.js chunks
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

      // Choose best primary stream: prefer English if available, otherwise first stream
      var primaryStream = streams[0];
      for (var si = 0; si < streams.length; si++) {
        var curStream = streams[si];
        if (
          curStream &&
          curStream.language &&
          String(curStream.language).toLowerCase() === 'english'
        ) {
          primaryStream = curStream;
          break;
        }
      }

      // Build quality options from all available streams
      var qualities = [];
      var seenUrls = {};
      for (var qi = 0; qi < streams.length; qi++) {
        var sObj = streams[qi];
        if (sObj && sObj.url && !seenUrls[sObj.url]) {
          seenUrls[sObj.url] = true;
          var qLabel = sObj.language
            ? sObj.language + (sObj.quality ? ' · ' + sObj.quality : '')
            : sObj.quality || sObj.label || 'Auto';
          qualities.push({
            quality: qLabel,
            url: sObj.url.replace(/&amp;/g, '&').replace(/\\u0026/g, '&'),
          });
        }
      }

      // Fetch full subtitle catalog from /api/subtitles
      var subtitles = [];
      var seenSubUrls = {};

      // 1. Add inline subtitles from primaryStream (if any)
      if (Array.isArray(primaryStream.subtitles)) {
        for (var psi = 0; psi < primaryStream.subtitles.length; psi++) {
          var pSub = primaryStream.subtitles[psi];
          if (pSub && pSub.url && !seenSubUrls[pSub.url]) {
            seenSubUrls[pSub.url] = true;
            subtitles.push({
              url: pSub.url,
              lang: pSub.lang || pSub.label || 'English',
              label: pSub.label || pSub.lang || 'English',
            });
          }
        }
      }

      // 2. Fetch all external subtitles via /api/subtitles
      try {
        var subParams = new URLSearchParams({
          kind: isTvShow ? 'tv' : 'movie',
          tmdb: String(id),
        });
        if (isTvShow) {
          subParams.set('s', String(season || 1));
          subParams.set('e', String(episode || 1));
        }

        var subRes = await fetch(DOMAIN + '/api/subtitles?' + subParams.toString(), {
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
              var sItem = subData.subtitles[sj];
              if (sItem && sItem.url && !seenSubUrls[sItem.url]) {
                seenSubUrls[sItem.url] = true;
                subtitles.push({
                  url: sItem.url,
                  lang: sItem.lang || sItem.label || 'Unknown',
                  label: sItem.label || sItem.lang || 'Unknown',
                });
              }
            }
          }
        }
      } catch (subErr) {
        // Subtitles are non-fatal
      }

      var finalUrl = primaryStream.url.replace(/&amp;/g, '&').replace(/\\u0026/g, '&');
      console.log(
        TAG +
          ' ✅ Extracted vidly stream: ' +
          finalUrl.slice(0, 60) +
          '... (qualities: ' +
          qualities.length +
          ', subtitles: ' +
          subtitles.length +
          ')'
      );

      return {
        url: finalUrl,
        quality: primaryStream.quality || 'Auto',
        provider: 'CineJoy',
        headers: {
          'User-Agent': USER_AGENT,
          Referer: DOMAIN + '/',
          Origin: DOMAIN,
        },
        subtitles: subtitles,
        qualities: qualities,
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
