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

    // Money Heist & Lupin legacy normalizer
    if (isTvShow) {
      var sNum = Number(season) || 1;
      var eNum = Number(episode) || 1;
      if (String(tmdbId) === '71446' || String(id) === '71446' || (typeof imdbId === 'string' && imdbId === 'tt6468322') || (title && /money\s*heist|casa\s*de\s*papel/i.test(title))) {
        if (sNum === 2 && eNum > 8) {
          season = 4; episode = eNum - 8;
          console.log(TAG + ' 🔄 Money Heist legacy S' + sNum + 'E' + eNum + ' -> S' + season + 'E' + episode);
        } else if (sNum === 2 && (eNum === 7 || eNum === 8)) {
          season = 3; episode = eNum;
          console.log(TAG + ' 🔄 Money Heist legacy S' + sNum + 'E' + eNum + ' -> S' + season + 'E' + episode);
        } else if (sNum === 1 && eNum > 9) {
          season = 2; episode = eNum - 9;
          console.log(TAG + ' 🔄 Money Heist legacy S' + sNum + 'E' + eNum + ' -> S' + season + 'E' + episode);
        }
      } else if (String(tmdbId) === '96677' || String(id) === '96677' || (typeof imdbId === 'string' && imdbId === 'tt2531336') || (title && /lupin/i.test(title))) {
        if (sNum === 1 && eNum > 5) {
          season = 2; episode = eNum - 5;
          console.log(TAG + ' 🔄 Lupin legacy S' + sNum + 'E' + eNum + ' -> S' + season + 'E' + episode);
        }
      }
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

        // Special case: Lupin (TMDB 96677) Season 3+ has English audio mistakenly labeled as 'French' on Vidly
        var isLupinS3Plus = (
          String(id) === '96677' ||
          String(tmdbId) === '96677' ||
          (typeof imdbId === 'string' && imdbId === 'tt2531336') ||
          (typeof id === 'string' && id === 'tt2531336') ||
          (title && /lupin/i.test(title))
        ) && isTvShow && Number(season) >= 3;
        if (isLupinS3Plus && (langName.toLowerCase() === 'french' || langName.toLowerCase() === 'français' || langName.toLowerCase() === 'francais')) {
          console.log(TAG + ' 🔄 Lupin S' + season + ': mapping French track to English');
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

      // Sort audio languages: English is FIRST. If English is not listed, French is default at index 0.
      langOrder.sort(function (a, b) {
        var aLow = a.toLowerCase();
        var bLow = b.toLowerCase();
        var aIsEng = aLow.indexOf('english') === 0;
        var bIsEng = bLow.indexOf('english') === 0;
        if (aIsEng && !bIsEng) return -1;
        if (!aIsEng && bIsEng) return 1;
        if (aIsEng && bIsEng) return a.localeCompare(b);

        var aIsFr =
          aLow.indexOf('french') === 0 ||
          aLow.indexOf('français') === 0 ||
          aLow.indexOf('francais') === 0 ||
          aLow === 'fr';
        var bIsFr =
          bLow.indexOf('french') === 0 ||
          bLow.indexOf('français') === 0 ||
          bLow.indexOf('francais') === 0 ||
          bLow === 'fr';
        if (aIsFr && !bIsFr) return -1;
        if (!aIsFr && bIsFr) return 1;

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

      var BACKEND_URL = 'https://backendmasterstream.onrender.com';

      // Helper to extract audio URI for a specific language from an m3u8 playlist text
      function extractAudioUri(m3u8Text, masterUrl, targetLang, allowFallback) {
        if (!m3u8Text) return null;
        var lines = m3u8Text.split('\n');
        var audioLines = [];
        for (var i = 0; i < lines.length; i++) {
          if (lines[i].trim().indexOf('#EXT-X-MEDIA:TYPE=AUDIO') === 0) {
            audioLines.push(lines[i].trim());
          }
        }
        if (audioLines.length === 0) return null;

        var tLow = (targetLang || '').toLowerCase().trim();
        var bestLine = null;

        // 1. Try to find matching line by NAME or LANGUAGE
        for (var j = 0; j < audioLines.length; j++) {
          var al = audioLines[j];
          var nameMatch = al.match(/NAME=["']?([^"',]+)["']?/i);
          var langMatch = al.match(/LANGUAGE=["']?([^"',]+)["']?/i);
          var n = (nameMatch ? nameMatch[1] : '').toLowerCase();
          var l = (langMatch ? langMatch[1] : '').toLowerCase();

          if (tLow === 'english' || tLow === 'en') {
            if (n.indexOf('eng') !== -1 || l === 'eng' || l === 'en' || n.indexOf('original') !== -1) {
              bestLine = al;
              break;
            }
          } else if (tLow === 'french' || tLow === 'fr') {
            if (
              n.indexOf('fren') !== -1 ||
              n.indexOf('fran') !== -1 ||
              l === 'fra' ||
              l === 'fre' ||
              l === 'fr'
            ) {
              bestLine = al;
              break;
            }
          } else if (tLow === 'hindi' || tLow === 'hi') {
            if (n.indexOf('hin') !== -1 || l === 'hin' || l === 'hi') {
              bestLine = al;
              break;
            }
          } else if (tLow === 'tamil' || tLow === 'ta') {
            if (n.indexOf('tam') !== -1 || l === 'tam' || l === 'ta') {
              bestLine = al;
              break;
            }
          } else if (tLow === 'telugu' || tLow === 'te') {
            if (n.indexOf('tel') !== -1 || l === 'tel' || l === 'te') {
              bestLine = al;
              break;
            }
          } else if (tLow === 'esla' || tLow === 'spanish' || tLow === 'es') {
            if (n.indexOf('span') !== -1 || n.indexOf('esla') !== -1 || l === 'spa' || l === 'es') {
              bestLine = al;
              break;
            }
          } else if (tLow === 'ptbr' || tLow === 'portuguese' || tLow === 'pt') {
            if (n.indexOf('port') !== -1 || n.indexOf('ptbr') !== -1 || l === 'por' || l === 'pt') {
              bestLine = al;
              break;
            }
          } else {
            if (n.indexOf(tLow) !== -1 || l.indexOf(tLow) !== -1) {
              bestLine = al;
              break;
            }
          }
        }

        // 2. Fallback to DEFAULT=YES if looking for English
        if (!bestLine && (tLow === 'english' || tLow === 'en')) {
          for (var k = 0; k < audioLines.length; k++) {
            if (/DEFAULT=YES/i.test(audioLines[k])) {
              bestLine = audioLines[k];
              break;
            }
          }
        }

        // 3. Fallback to first line ONLY if allowFallback is true (e.g. single audio stream)
        if (!bestLine && allowFallback) {
          bestLine = audioLines[0];
        }

        if (!bestLine) return null;

        var uriMatch = bestLine.match(/URI=["']([^"']+)["']/i);
        if (!uriMatch) return null;
        var uri = uriMatch[1];
        if (uri.indexOf('http') !== 0) {
          try {
            uri = new URL(uri, masterUrl).href;
          } catch (e) {
            var lastSlash = masterUrl.lastIndexOf('/');
            uri = masterUrl.substring(0, lastSlash + 1) + uri;
          }
        }
        return uri;
      }

      // Choose primary audio track (English is guaranteed at index 0)
      var primaryTrack = audioTracks[0];
      var primaryUrl = primaryTrack.url;

      // Fetch primary master playlist text
      var primaryManifestText = '';
      try {
        var pmRes = await fetch(primaryUrl, {
          headers: {
            'User-Agent': USER_AGENT,
            Referer: DOMAIN + '/',
            Origin: DOMAIN,
          },
        });
        if (pmRes.ok) {
          primaryManifestText = await pmRes.text();
        }
      } catch (pmErr) {}

      // Discover video variants from primaryManifestText
      var parsedVariants = [];
      if (primaryManifestText) {
        var pLines = primaryManifestText.split('\n');
        var seenVar = {};
        for (var pi = 0; pi < pLines.length; pi++) {
          var pLine = pLines[pi].trim();
          if (pLine.indexOf('#EXT-X-STREAM-INF:') === 0) {
            var resM = pLine.match(/RESOLUTION=(\d+x\d+)/i);
            var bwM = pLine.match(/BANDWIDTH=(\d+)/i);
            var nextL = pLines[pi + 1] ? pLines[pi + 1].trim() : '';
            if (nextL && nextL.indexOf('#') !== 0) {
              var absVUrl = nextL;
              try {
                absVUrl = new URL(nextL, primaryUrl).href;
              } catch (e) {
                if (nextL.indexOf('http') !== 0) {
                  var lastSlash = primaryUrl.lastIndexOf('/');
                  absVUrl = primaryUrl.substring(0, lastSlash + 1) + nextL;
                }
              }
              var qLab = '1080p';
              if (resM) {
                var rParts = resM[1].split('x');
                qLab = (rParts[1] || rParts[0]) + 'p';
              } else if (bwM) {
                var bwVal = parseInt(bwM[1], 10);
                if (bwVal > 3000000) qLab = '1080p';
                else if (bwVal > 1500000) qLab = '720p';
                else if (bwVal > 600000) qLab = '480p';
                else qLab = '360p';
              }
              if (!seenVar[qLab]) {
                seenVar[qLab] = true;
                parsedVariants.push({ quality: qLab, url: absVUrl, line: pLine });
              }
            }
          }
        }
        parsedVariants.sort(function (a, b) {
          var aNum = parseInt(a.quality.replace(/\D/g, ''), 10) || 0;
          var bNum = parseInt(b.quality.replace(/\D/g, ''), 10) || 0;
          return bNum - aNum;
        });
      }

      // If we have multiple audio tracks and demuxed audio, fetch audio URIs for all languages
      // and construct a unified master playlist containing ALL audio dubs (like Money Heist)
      var synthesizedPlaylist = null;
      var primaryAudioUri = extractAudioUri(primaryManifestText, primaryUrl, primaryTrack.language, true);

      if (primaryManifestText && primaryAudioUri && audioTracks.length > 1) {
        try {
          var audioUriMap = {};
          audioUriMap[primaryTrack.language] = primaryAudioUri;

          // Check if primary master playlist already has other languages embedded (strict, no fallback)
          for (var pli = 0; pli < audioTracks.length; pli++) {
            var plName = audioTracks[pli].language;
            if (!audioUriMap[plName]) {
              var pFound = extractAudioUri(primaryManifestText, primaryUrl, plName, false);
              if (pFound && pFound !== primaryAudioUri) {
                audioUriMap[plName] = pFound;
              }
            }
          }

          var fetchPromises = [];
          for (var ati = 1; ati < audioTracks.length; ati++) {
            (function (track) {
              if (audioUriMap[track.language]) return;
              var p = (async function () {
                try {
                  var atRes = await fetch(track.url, {
                    headers: {
                      'User-Agent': USER_AGENT,
                      Referer: DOMAIN + '/',
                      Origin: DOMAIN,
                    },
                  });
                  if (atRes.ok) {
                    var atTxt = await atRes.text();
                    var aUri = extractAudioUri(atTxt, track.url, track.language, true);
                    if (aUri) {
                      audioUriMap[track.language] = aUri;
                    }
                  }
                } catch (e) {}
              })();
              fetchPromises.push(p);
            })(audioTracks[ati]);
          }

          await Promise.all(fetchPromises);

          var langCodes = {
            english: 'en',
            hindi: 'hi',
            arabic: 'ar',
            spanish: 'es',
            esla: 'es',
            french: 'fr',
            francais: 'fr',
            'français': 'fr',
            kannada: 'kn',
            malayalam: 'ml',
            portuguese: 'pt',
            ptbr: 'pt',
            tamil: 'ta',
            telugu: 'te',
            german: 'de',
            italian: 'it',
            russian: 'ru',
            japanese: 'ja',
            korean: 'ko',
            chinese: 'zh',
          };

          var masterLines = [];
          masterLines.push('#EXTM3U');
          masterLines.push('#EXT-X-VERSION:7');

          // Audio track declarations: English first (DEFAULT=YES), other languages DEFAULT=NO
          for (var li = 0; li < audioTracks.length; li++) {
            var lName = audioTracks[li].language;
            var aUrl = audioUriMap[lName];
            if (!aUrl) continue;
            var lCode = langCodes[lName.toLowerCase()] || lName.substring(0, 2).toLowerCase();
            var isDef = li === 0 ? 'YES' : 'NO';
            var isAuto = li === 0 ? 'YES' : 'NO';
            masterLines.push(
              '#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="audio",LANGUAGE="' +
                lCode +
                '",NAME="' +
                lName +
                '",DEFAULT=' +
                isDef +
                ',AUTOSELECT=' +
                isAuto +
                ',URI="' +
                aUrl +
                '"'
            );
          }

          // Video variant declarations
          for (var pvi = 0; pvi < parsedVariants.length; pvi++) {
            var vLine = parsedVariants[pvi].line;
            if (vLine.indexOf('AUDIO=') !== -1) {
              vLine = vLine.replace(/AUDIO=["']?[^"',]+["']?/i, 'AUDIO="audio"');
            } else {
              vLine = vLine + ',AUDIO="audio"';
            }
            masterLines.push(vLine);
            masterLines.push(parsedVariants[pvi].url);
          }

          synthesizedPlaylist = masterLines.join('\n');
        } catch (synthErr) {
          console.warn(TAG + ' ⚠️ Failed to synthesize multi-audio playlist: ' + synthErr.message);
        }
      }

      var finalQualities = [];
      var storedId = null;

      if (synthesizedPlaylist) {
        try {
          var storeRes = await fetch(BACKEND_URL + '/api/cinejoy/playlist/store', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ playlist: synthesizedPlaylist }),
          });
          if (storeRes.ok) {
            var storeData = await storeRes.json();
            if (storeData && storeData.id) {
              storedId = storeData.id;
            }
          }
        } catch (stErr) {
          console.warn(TAG + ' ⚠️ Backend store failed: ' + stErr.message);
        }
      }

      if (storedId) {
        var baseMasterUrl =
          BACKEND_URL + '/api/cinejoy/playlist?id=' + encodeURIComponent(storedId) + '&ext=.m3u8';
        primaryUrl = baseMasterUrl;
        finalQualities.push({ quality: 'Auto', url: baseMasterUrl });
        for (var qi = 0; qi < parsedVariants.length; qi++) {
          finalQualities.push({
            quality: parsedVariants[qi].quality,
            url: baseMasterUrl + '&res=' + encodeURIComponent(parsedVariants[qi].quality),
          });
        }
      } else {
        finalQualities.push({ quality: 'Auto', url: primaryUrl });
        for (var qi = 0; qi < parsedVariants.length; qi++) {
          finalQualities.push({
            quality: parsedVariants[qi].quality,
            url:
              BACKEND_URL +
              '/api/cinejoy/playlist?master=' +
              encodeURIComponent(primaryUrl) +
              '&res=' +
              encodeURIComponent(parsedVariants[qi].quality) +
              '&ext=.m3u8',
          });
        }
      }

      // Assign language-specific master playlist qualities to each audio track
      for (var atIdx = 0; atIdx < audioTracks.length; atIdx++) {
        var trackLang = audioTracks[atIdx].language;
        var trackQualities = [];
        if (storedId) {
          var tBaseUrl = baseMasterUrl + '&lang=' + encodeURIComponent(trackLang);
          audioTracks[atIdx].url = tBaseUrl;
          trackQualities.push({ quality: 'Auto', url: tBaseUrl });
          for (var qi = 0; qi < parsedVariants.length; qi++) {
            trackQualities.push({
              quality: parsedVariants[qi].quality,
              url: tBaseUrl + '&res=' + encodeURIComponent(parsedVariants[qi].quality),
            });
          }
        } else {
          trackQualities = finalQualities;
        }
        audioTracks[atIdx].qualities = trackQualities;
      }
      primaryTrack.url = primaryUrl;

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
