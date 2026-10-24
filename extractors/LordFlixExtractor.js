/**
 * LordFlix / VidSrc (vidsrc.sh) Fast Remote Extractor
 * Hot-loaded via RemoteJsExtractor (TV) and RemoteExtractorLoader (Mobile).
 *
 * Flow:
 *   1. Embed page: https://vidsrc.sh/embed/movie/{id} or /embed/tv/{id}/{s}/{e}
 *   2. Gate endpoint: /vs_src.php -> returns landing iframe URL
 *   3. Landing page: extracts CFG.playerUrl
 *   4. Player page: extracts CONFIG.api + CONFIG.apiToken
 *   5. API call: CONFIG.api + api_token -> encrypted ChaCha20 payload + wasm_url
 *   6. WASM decryption: compiles and decrypts stream URLs
 *   7. Client-bound IP token: mints fresh JWT via /generate.php
 *
 * Supports both Android TV (V8 / WASM) and Mobile fallback.
 */

(function () {
  'use strict';

  var TAG = '[LordFlixExtractor]';
  var VIDSRC_BASE = 'https://vidsrc.sh';
  var USER_AGENT =
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36';

  // Backend proxy fallback for environments without WebAssembly
  var BACKEND_URL = 'https://backendmasterstream.onrender.com/api/cinejoy/vidsrcme';

  // In-memory WASM module cache by window ID (w)
  var wasmModuleCache = {};

  function getBase64Bytes(b64) {
    var bin = typeof atob === 'function' ? atob(b64) : Buffer.from(b64, 'base64').toString('binary');
    var bytes = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) {
      bytes[i] = bin.charCodeAt(i);
    }
    return bytes;
  }

  function fetchArrayBuffer(url, headers) {
    if (typeof XMLHttpRequest !== 'undefined') {
      return new Promise(function (resolve, reject) {
        try {
          var xhr = new XMLHttpRequest();
          xhr.open('GET', url, true);
          xhr.responseType = 'arraybuffer';
          if (headers) {
            for (var k in headers) {
              try { xhr.setRequestHeader(k, headers[k]); } catch (e) {}
            }
          }
          xhr.onload = function () {
            if (xhr.status >= 200 && xhr.status < 300 && xhr.response) {
              resolve(xhr.response);
            } else {
              reject(new Error('XHR status ' + xhr.status));
            }
          };
          xhr.onerror = function () { reject(new Error('XHR network error')); };
          xhr.send();
        } catch (e) {
          reject(e);
        }
      });
    }
    return fetch(url, { headers: headers }).then(function (r) {
      if (typeof r.arrayBuffer === 'function') return r.arrayBuffer();
      throw new Error('No arrayBuffer support');
    });
  }

  async function getWasmModule(windowId, wasmUrl, wasmBase64, referer) {
    var key = 'w_' + windowId;
    if (wasmModuleCache[key]) {
      return wasmModuleCache[key];
    }

    var promise;
    if (wasmUrl) {
      promise = fetchArrayBuffer(wasmUrl, {
        'User-Agent': USER_AGENT,
        'Referer': referer || VIDSRC_BASE + '/',
      }).then(function (bytes) { return WebAssembly.compile(bytes); });
    } else if (wasmBase64) {
      var bytes = getBase64Bytes(wasmBase64);
      promise = WebAssembly.compile(bytes.buffer);
    } else {
      return null;
    }

    wasmModuleCache[key] = promise;
    return promise;
  }

  async function decryptStreamUrls(vs, encryptedB64, referer) {
    if (!vs || !encryptedB64) return [];

    var modPromise = getWasmModule(vs.w, vs.wasm_url, vs.wasm, referer);
    if (!modPromise) return [];

    var mod = await modPromise;
    var inst = await WebAssembly.instantiate(mod, {});
    var ex = inst.exports;

    var encBytes = getBase64Bytes(encryptedB64);
    var ptr = ex.alloc(encBytes.length);
    new Uint8Array(ex.memory.buffer, ptr, encBytes.length).set(encBytes);

    var outLen = ex.decrypt(ptr, encBytes.length);
    var rawDecoded = new Uint8Array(ex.memory.buffer, ptr + 12, outLen);
    var text = typeof TextDecoder !== 'undefined'
      ? new TextDecoder().decode(rawDecoded)
      : Buffer.from(rawDecoded).toString('utf8');

    return text.split('\n').map(function (s) { return s.trim(); }).filter(Boolean);
  }

  // In-memory token cache by origin (JWT is valid for ~3.5 hours)
  var tokenCache = {};

  async function fetchStreamToken(streamUrl, referer, origin) {
    try {
      var u = new URL(streamUrl);
      var streamOrigin = u.origin;
      var now = Math.floor(Date.now() / 1000);
      var cached = tokenCache[streamOrigin];
      if (cached && cached.token && cached.exp > now + 300) {
        return cached.token;
      }

      // Candidate token endpoints:
      // 1. Plain HTTP first: On Android TV, OkHttpClient's FetchBridge throws
      //    "Chain validation failed" on HTTPS due to outdated system root CA stores.
      //    Plain HTTP connects without TLS handshake, completely avoiding SSL failure.
      // 2. HTTPS as fallback (works in browsers / Node / modern mobile).
      var candidateUrls = [
        streamOrigin.replace(/^https:/i, 'http:') + '/generate.php',
        streamOrigin + '/generate.php',
      ];

      var headers = {
        'User-Agent': USER_AGENT,
        'Referer': referer,
        'Origin': origin || new URL(referer).origin,
      };

      for (var i = 0; i < candidateUrls.length; i++) {
        var tokenUrl = candidateUrls[i];
        try {
          var res = await fetch(tokenUrl, { headers: headers });
          if (res && res.ok) {
            var text = (await res.text()).trim();
            if (text && text.indexOf('eyJ') === 0) {
              tokenCache[streamOrigin] = {
                token: text,
                exp: now + 3.5 * 3600,
              };
              return text;
            }
          }
        } catch (fetchErr) {
          console.warn(TAG + ' ⚠️ Failed token fetch from ' + tokenUrl + ': ' + (fetchErr.message || fetchErr));
        }

        // Also try native XMLHttpRequest (bypasses FetchBridge, uses Chromium's own cert store)
        try {
          var xhrText = await new Promise(function (resolve) {
            try {
              if (typeof XMLHttpRequest === 'undefined') return resolve('');
              var xhr = new XMLHttpRequest();
              xhr.open('GET', tokenUrl, true);
              xhr.timeout = 5000;
              xhr.onload = function () {
                if (xhr.status >= 200 && xhr.status < 300) {
                  resolve((xhr.responseText || '').trim());
                } else {
                  resolve('');
                }
              };
              xhr.onerror = function () { resolve(''); };
              xhr.ontimeout = function () { resolve(''); };
              xhr.send();
            } catch (xe) {
              resolve('');
            }
          });
          if (xhrText && xhrText.indexOf('eyJ') === 0) {
            tokenCache[streamOrigin] = {
              token: xhrText,
              exp: now + 3.5 * 3600,
            };
            return xhrText;
          }
        } catch (xhrErr) {}
      }

      return '';
    } catch (e) {
      return '';
    }
  }

  /** Direct extraction via vidsrc.sh */
  async function extractDirect(id, isTv, season, episode) {
    var embedUrl = isTv
      ? VIDSRC_BASE + '/embed/tv/' + id + '/' + (season || 1) + '/' + (episode || 1)
      : VIDSRC_BASE + '/embed/movie/' + id;

    console.log(TAG + ' 🚀 Fetching embed page: ' + embedUrl);

    // 1. Fetch vidsrc.sh embed page
    var embedRes = await fetch(embedUrl, {
      headers: {
        'User-Agent': USER_AGENT,
        'Referer': VIDSRC_BASE + '/',
      },
    });
    if (!embedRes.ok) {
      console.warn(TAG + ' ❌ Embed HTTP ' + embedRes.status);
      return null;
    }
    var embedHtml = await embedRes.text();

    var apiMatch = embedHtml.match(/data-api="([^"]+)"/);
    if (!apiMatch) {
      console.warn(TAG + ' ❌ Could not find data-api in embed HTML');
      return null;
    }

    var vsSrcPath = apiMatch[1].replace(/&amp;/g, '&');
    var vsSrcUrl = vsSrcPath.indexOf('http') === 0 ? vsSrcPath : VIDSRC_BASE + vsSrcPath;

    // 2. Fetch vs_src.php gate
    var vsRes = await fetch(vsSrcUrl, {
      headers: {
        'User-Agent': USER_AGENT,
        'Referer': embedUrl,
      },
    });
    if (!vsRes.ok) {
      console.warn(TAG + ' ❌ vs_src HTTP ' + vsRes.status);
      return null;
    }
    var vsJson = await vsRes.json();
    if (!vsJson || !vsJson.src) {
      console.warn(TAG + ' ❌ No landing src in vs_src response');
      return null;
    }

    var landingUrlsToTry = [];
    if (vsJson.src.indexOf('cloudorchestranova.com') > -1) {
      landingUrlsToTry.push(vsJson.src.replace('cloudorchestranova.com', 'stellarconductornexus.com'));
      landingUrlsToTry.push(vsJson.src);
    } else if (vsJson.src.indexOf('stellarconductornexus.com') > -1) {
      landingUrlsToTry.push(vsJson.src);
      landingUrlsToTry.push(vsJson.src.replace('stellarconductornexus.com', 'cloudorchestranova.com'));
    } else {
      landingUrlsToTry.push(vsJson.src);
    }

    var landingUrl = null;
    var landingOrigin = null;
    var cfg = null;

    // 3. Fetch landing page to get CFG.playerUrl
    for (var li = 0; li < landingUrlsToTry.length; li++) {
      var candidateUrl = landingUrlsToTry[li];
      var candidateOrigin = new URL(candidateUrl).origin;
      try {
        var landingRes = await fetch(candidateUrl, {
          headers: {
            'User-Agent': USER_AGENT,
            'Referer': VIDSRC_BASE + '/',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
            'Accept-Language': 'en-US,en;q=0.9',
            'Sec-Fetch-Dest': 'iframe',
            'Sec-Fetch-Mode': 'navigate',
            'Sec-Fetch-Site': 'cross-site',
          },
        });
        if (!landingRes.ok) continue;
        var landingHtml = await landingRes.text();
        var cfgMatch = landingHtml.match(/window\.CFG\s*=\s*({[^;]+});/) ||
                       landingHtml.match(/window\.CFG\s*=\s*({[\s\S]*?});/);
        if (!cfgMatch) continue;
        var parsedCfg = JSON.parse(cfgMatch[1]);
        if (!parsedCfg.playerUrl) continue;

        landingUrl = candidateUrl;
        landingOrigin = candidateOrigin;
        cfg = parsedCfg;
        break;
      } catch (err) {}
    }

    if (!landingUrl || !cfg) {
      console.warn(TAG + ' ❌ No working landing page found');
      return null;
    }

    var playerUrl = cfg.playerUrl.indexOf('http') === 0 ? cfg.playerUrl : landingOrigin + cfg.playerUrl;

    // 4. Fetch player page to get CONFIG.api and CONFIG.apiToken
    var playerRes = await fetch(playerUrl, {
      headers: {
        'User-Agent': USER_AGENT,
        'Referer': landingUrl,
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
        'Sec-Fetch-Dest': 'iframe',
        'Sec-Fetch-Mode': 'navigate',
        'Sec-Fetch-Site': 'same-origin',
      },
    });
    if (!playerRes.ok) {
      console.warn(TAG + ' ❌ Player page HTTP ' + playerRes.status);
      return null;
    }
    var playerHtml = await playerRes.text();

    var configMatch = playerHtml.match(/window\.CONFIG\s*=\s*({[^;]+});/) ||
                      playerHtml.match(/window\.CONFIG\s*=\s*({[\s\S]*?});/);
    if (!configMatch) {
      console.warn(TAG + ' ❌ No window.CONFIG found in player page');
      return null;
    }
    var config = JSON.parse(configMatch[1]);
    var streamApiUrl = config.api;
    if (!streamApiUrl && config.streamBase) {
      streamApiUrl = config.streamBase + '&season=' + encodeURIComponent(season || config.season || 1) + '&episode=' + encodeURIComponent(episode || config.episode || 1) + '&stream_urls';
    }
    if (!streamApiUrl) {
      console.warn(TAG + ' ❌ No api/streamBase URL in CONFIG');
      return null;
    }

    // 5. Call API with api_token
    if (config.apiToken) {
      streamApiUrl += (streamApiUrl.indexOf('?') > -1 ? '&' : '?') + 'api_token=' + encodeURIComponent(config.apiToken);
    }

    var streamApiRes = await fetch(streamApiUrl, {
      headers: {
        'User-Agent': USER_AGENT,
        'Referer': playerUrl,
        'Origin': landingOrigin,
        'Accept': 'application/json',
      },
    });
    if (!streamApiRes.ok) {
      console.warn(TAG + ' ❌ Stream API HTTP ' + streamApiRes.status);
      return null;
    }
    var streamData = await streamApiRes.json();
    if (!streamData || !streamData.data || !streamData.data.stream_urls) {
      console.warn(TAG + ' ❌ No stream_urls in API response');
      return null;
    }

    // 6. Decrypt stream URLs via ChaCha20 WASM
    var streamUrls = [];
    if (typeof streamData.data.stream_urls === 'string' && streamData.vs) {
      streamUrls = await decryptStreamUrls(streamData.vs, streamData.data.stream_urls, playerUrl);
    } else if (Array.isArray(streamData.data.stream_urls)) {
      streamUrls = streamData.data.stream_urls;
    }

    if (!streamUrls || streamUrls.length === 0) {
      console.warn(TAG + ' ❌ Decrypted stream URLs empty');
      return null;
    }

    // 7. Mint stream token for playback
    var primaryUrl = streamUrls[0];
    var token = await fetchStreamToken(primaryUrl, playerUrl, landingOrigin);

    if (!token) {
      console.warn(TAG + ' ⚠️ Token mint failed (generate.php unavailable) — rejecting direct result');
      return null;
    }

    var finalUrl = primaryUrl + (primaryUrl.indexOf('?') > -1 ? '&' : '?') + 'token=' + encodeURIComponent(token);

    // Subtitles
    var subtitles = [];
    if (Array.isArray(streamData.default_subs)) {
      for (var i = 0; i < streamData.default_subs.length; i++) {
        var sub = streamData.default_subs[i];
        if (sub && sub.url) {
          subtitles.push({
            url: sub.url,
            lang: sub.language || sub.label || 'English',
            label: sub.label || sub.language || 'English',
          });
        }
      }
    }

    // Parse HLS master playlist for resolution variants (Auto, 1080p, 720p, 360p, etc.)
    var qualities = await parseMasterQualities(finalUrl, {
      'User-Agent': USER_AGENT,
      'Referer': playerUrl,
      'Origin': landingOrigin,
    });

    console.log(TAG + ' ✅ Extracted stream successfully (' + qualities.length + ' qualities)');

    return {
      url: finalUrl,
      quality: 'Auto',
      provider: 'LordFlix',
      headers: {
        'User-Agent': USER_AGENT,
        'Referer': playerUrl,
        'Origin': landingOrigin,
      },
      subtitles: subtitles,
      qualities: qualities,
    };
  }

  /** Parse HLS master playlist variants into QualityOption array */
  async function parseMasterQualities(masterUrl, headers) {
    var qualities = [{ quality: 'Auto', url: masterUrl }];
    try {
      var res = await fetch(masterUrl, { headers: headers });
      if (!res.ok) return qualities;
      var text = await res.text();
      var lines = text.split('\n');
      for (var i = 0; i < lines.length; i++) {
        var line = lines[i].trim();
        if (line.indexOf('#EXT-X-STREAM-INF:') === 0) {
          var nextLine = (lines[i + 1] || '').trim();
          if (!nextLine || nextLine.indexOf('#') === 0) continue;
          var resMatch = line.match(/RESOLUTION=(\d+x\d+)/i);
          var qLabel = 'Unknown';
          if (resMatch) {
            var parts = resMatch[1].split('x');
            var h = parseInt(parts[1] || parts[0], 10);
            if (h > 0) qLabel = h + 'p';
          }
          var absUrl = new URL(nextLine, masterUrl).href;
          qualities.push({ quality: qLabel, url: absUrl });
        }
      }
      qualities.sort(function (a, b) {
        if (a.quality === 'Auto') return -1;
        if (b.quality === 'Auto') return 1;
        var na = parseInt(a.quality, 10) || 0;
        var nb = parseInt(b.quality, 10) || 0;
        return nb - na;
      });
    } catch (e) {
      console.warn(TAG + ' ⚠️ Failed to parse master qualities: ' + (e.message || e));
    }
    return qualities;
  }

  /** Backend fallback when Hermes has no WebAssembly */
  async function extractViaBackend(tmdbId, imdbId, isTv, season, episode) {
    try {
      var isTvShow = isTv === true || String(isTv) === 'true' || String(isTv) === 'tv';
      var query = 'type=' + (isTvShow ? 'tv' : 'movie');
      if (tmdbId) query += '&tmdbId=' + encodeURIComponent(String(tmdbId));
      if (imdbId) query += '&imdbId=' + encodeURIComponent(String(imdbId));
      if (isTvShow && season) query += '&season=' + encodeURIComponent(String(season));
      if (isTvShow && episode) query += '&episode=' + encodeURIComponent(String(episode));

      var res = await fetch(BACKEND_URL + '?' + query, {
        headers: { Accept: 'application/json' },
      });
      if (!res.ok) return null;
      var data = await res.json();
      if (!data || !data.url) return null;

      var rawUrl = data.url.replace(/([?&])token=[^&]*/g, '').replace(/[?&]$/, '');
      var token = await fetchStreamToken(rawUrl, VIDSRC_BASE + '/', VIDSRC_BASE);
      if (!token && data.url.indexOf('token=') > -1) {
        var match = data.url.match(/[?&]token=([^&]+)/);
        if (match) token = decodeURIComponent(match[1]);
      }
      if (!token) {
        console.warn(TAG + ' ⚠️ Backend stream has no valid token — rejecting');
        return null;
      }
      var finalUrl = rawUrl + (rawUrl.indexOf('?') > -1 ? '&' : '?') + 'token=' + encodeURIComponent(token);
      var qualities = await parseMasterQualities(finalUrl, {
        'User-Agent': USER_AGENT,
        'Referer': VIDSRC_BASE + '/',
      });

      return {
        url: finalUrl,
        quality: data.quality || 'Auto',
        provider: 'LordFlix',
        headers: data.headers || {
          'User-Agent': USER_AGENT,
          'Referer': VIDSRC_BASE + '/',
        },
        subtitles: data.subtitles || [],
        qualities: qualities,
      };
    } catch (e) {
      return null;
    }
  }

  // ── Vidly / CineJoy Collaboration Helper ────────────────────────────────────
  var VIDLY_DOMAIN = 'https://vidly.pro';
  var VIDLY_CIPHER_KEY = 'vY7#qL2!mZ9@wK4$';

  function decodeVidlyPayload(sealed) {
    if (!sealed || typeof sealed !== 'string' || sealed.indexOf('v1.') !== 0) return null;
    try {
      var b64 = sealed.slice(3).replace(/-/g, '+').replace(/_/g, '/');
      var binaryStr = typeof atob === 'function' ? atob(b64) : Buffer.from(b64, 'base64').toString('binary');
      var rawBytes = new Uint8Array(binaryStr.length);
      for (var i = 0; i < binaryStr.length; i++) rawBytes[i] = binaryStr.charCodeAt(i);

      var nonce = rawBytes.subarray(0, 12);
      var payload = rawBytes.slice(12);

      var state = [];
      for (var s = 0; s < 4; s++) {
        var n = (0x811c9dc5 ^ (0x9e3779b9 * s)) >>> 0;
        for (var k = 0; k < VIDLY_CIPHER_KEY.length; k++) {
          n = Math.imul(n ^ VIDLY_CIPHER_KEY.charCodeAt(k), 0x1000193) >>> 0;
        }
        for (var p = 0; p < nonce.length; p++) {
          n = Math.imul(n ^ nonce[p], 0x1000193) >>> 0;
        }
        state.push(n);
      }
      var s0 = state[0], s1 = state[1], s2 = state[2], s3 = state[3];
      var kw = 0;
      for (var t = 0; t < payload.length; t++) {
        if ((3 & t) === 0) {
          s2 >>>= 0; s3 >>>= 0;
          var eSum = ((s0 >>>= 0) + (s1 >>>= 0)) | 0;
          s0 = s1 ^ (s1 >>> 9);
          s1 = (s2 + (s2 << 3)) | 0;
          s3 = (s3 + 1) | 0;
          s2 = ((s2 << 21) | (s2 >>> 11)) + (eSum = (eSum + s3) | 0) | 0;
          kw = eSum >>> 0;
        }
        payload[t] ^= (kw >>> ((3 & t) * 8)) & 255;
      }
      var str = typeof TextDecoder !== 'undefined' ? new TextDecoder().decode(payload) : Buffer.from(payload).toString('utf8');
      return JSON.parse(str);
    } catch (e) {
      return null;
    }
  }

  async function extractVidlyStandalone(tmdbId, imdbId, isTvShow, season, episode) {
    var id = tmdbId || imdbId;
    if (!id) return null;
    var pageUrl = isTvShow
      ? VIDLY_DOMAIN + '/tv/' + id + '/' + (season || 1) + '/' + (episode || 1)
      : VIDLY_DOMAIN + '/movie/' + id;

    var pageRes = await fetch(pageUrl, {
      headers: { 'User-Agent': USER_AGENT, Referer: VIDLY_DOMAIN + '/', Origin: VIDLY_DOMAIN },
    });
    if (!pageRes.ok) return null;
    var html = await pageRes.text();
    var tokenMatch = html.match(/\\*"token\\*":\s*\\*"([^\\"]+)/);
    if (!tokenMatch) return null;
    var token = tokenMatch[1];

    var srcRes = await fetch(VIDLY_DOMAIN + '/api/source/' + token, {
      method: 'POST',
      headers: { 'User-Agent': USER_AGENT, Referer: pageUrl, Origin: VIDLY_DOMAIN },
    });
    if (!srcRes.ok) return null;
    var srcJson = await srcRes.json();
    if (!srcJson || !srcJson.data) return null;
    var decrypted = decodeVidlyPayload(srcJson.data);
    if (!decrypted || !Array.isArray(decrypted.streams) || decrypted.streams.length === 0) return null;

    var streams = decrypted.streams;
    var audioTracks = [];
    var seenLang = {};

    for (var i = 0; i < streams.length; i++) {
      var item = streams[i];
      if (!item || !item.url) continue;
      var lang = item.language || item.name || (i === 0 ? 'English' : 'Track ' + (i + 1));
      lang = lang.replace(/\s*\(.*?\)\s*/g, '').trim();
      var key = lang.toLowerCase();
      if (!seenLang[key]) {
        seenLang[key] = true;
        audioTracks.push({ language: lang, url: item.url });
      }
    }

    var subtitles = [];
    var seenSubUrls = {};
    for (var sc = 0; sc < streams.length; sc++) {
      var strItem = streams[sc];
      if (strItem && Array.isArray(strItem.subtitles)) {
        for (var si = 0; si < strItem.subtitles.length; si++) {
          var sObj = strItem.subtitles[si];
          if (sObj && sObj.url && !seenSubUrls[sObj.url]) {
            seenSubUrls[sObj.url] = true;
            subtitles.push({
              url: sObj.url,
              lang: sObj.lang || sObj.label || 'English',
              label: sObj.label || sObj.lang || 'English',
            });
          }
        }
      }
    }

    try {
      var subParams = 'kind=' + (isTvShow ? 'tv' : 'movie') + '&tmdb=' + encodeURIComponent(id);
      if (isTvShow) subParams += '&s=' + encodeURIComponent(season || 1) + '&e=' + encodeURIComponent(episode || 1);
      var subRes = await fetch(VIDLY_DOMAIN + '/api/subtitles?' + subParams, {
        headers: { 'User-Agent': USER_AGENT, Referer: pageUrl, Origin: VIDLY_DOMAIN },
      });
      if (subRes.ok) {
        var subData = await subRes.json();
        if (subData && Array.isArray(subData.subtitles)) {
          for (var sj = 0; sj < subData.subtitles.length; sj++) {
            var extSub = subData.subtitles[sj];
            if (extSub && extSub.url && !seenSubUrls[extSub.url]) {
              seenSubUrls[extSub.url] = true;
              subtitles.push({
                url: extSub.url,
                lang: extSub.lang || extSub.label || 'Unknown',
                label: extSub.label || extSub.lang || 'Unknown',
              });
            }
          }
        }
      }
    } catch (e) {}

    var primaryUrl = streams[0].url;
    var parsedVariants = [];
    try {
      var vRes = await fetch(primaryUrl);
      if (vRes.ok) {
        var vText = await vRes.text();
        var vLines = vText.split('\n');
        for (var vi = 0; vi < vLines.length; vi++) {
          var vl = vLines[vi].trim();
          if (vl.indexOf('#EXT-X-STREAM-INF:') === 0) {
            var nvl = (vLines[vi + 1] || '').trim();
            if (!nvl || nvl.indexOf('#') === 0) continue;
            var rMatch = vl.match(/RESOLUTION=(\d+x\d+)/i);
            var ql = 'Unknown';
            if (rMatch) {
              var p = rMatch[1].split('x');
              var h = parseInt(p[1] || p[0], 10);
              if (h > 0) ql = h + 'p';
            }
            parsedVariants.push({ quality: ql, url: new URL(nvl, primaryUrl).href, line: vl });
          }
        }
      }
    } catch (e) {}

    var audioUriMap = {};
    for (var ai = 0; ai < audioTracks.length; ai++) {
      try {
        var aRes = await fetch(audioTracks[ai].url);
        if (aRes.ok) {
          var aText = await aRes.text();
          var aLines = aText.split('\n');
          for (var ali = 0; ali < aLines.length; ali++) {
            var al = aLines[ali].trim();
            if (al.indexOf('#EXT-X-MEDIA:TYPE=AUDIO') === 0) {
              var uMatch = al.match(/URI=["']?([^"',\s]+)["']?/i);
              if (uMatch) {
                audioUriMap[audioTracks[ai].language] = new URL(uMatch[1], audioTracks[ai].url).href;
                break;
              }
            }
          }
        }
      } catch (e) {}
    }

    var masterLines = ['#EXTM3U', '#EXT-X-VERSION:7'];
    for (var li = 0; li < audioTracks.length; li++) {
      var lName = audioTracks[li].language;
      var aUrl = audioUriMap[lName];
      if (!aUrl) continue;
      masterLines.push(
        '#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="audio",LANGUAGE="' +
          lName.substring(0, 2).toLowerCase() +
          '",NAME="' +
          lName +
          '",DEFAULT=' +
          (li === 0 ? 'YES' : 'NO') +
          ',AUTOSELECT=' +
          (li === 0 ? 'YES' : 'NO') +
          ',URI="' +
          aUrl +
          '"'
      );
    }
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

    var storedId = null;
    try {
      var storeRes = await fetch('https://backendmasterstream.onrender.com/api/cinejoy/playlist/store', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ playlist: masterLines.join('\n') }),
      });
      if (storeRes.ok) {
        var sData = await storeRes.json();
        if (sData && sData.id) storedId = sData.id;
      }
    } catch (e) {}

    var baseMasterUrl = storedId
      ? 'https://backendmasterstream.onrender.com/api/cinejoy/playlist?id=' + encodeURIComponent(storedId) + '&ext=.m3u8'
      : primaryUrl;

    var finalAudioTracks = [];
    for (var ati = 0; ati < audioTracks.length; ati++) {
      var aLang = audioTracks[ati].language;
      var tUrl = storedId ? baseMasterUrl + '&lang=' + encodeURIComponent(aLang) : audioTracks[ati].url;
      var tQualities = [{ quality: 'Auto', url: tUrl }];
      for (var pqi = 0; pqi < parsedVariants.length; pqi++) {
        tQualities.push({
          quality: parsedVariants[pqi].quality,
          url: storedId ? tUrl + '&res=' + encodeURIComponent(parsedVariants[pqi].quality) : parsedVariants[pqi].url,
        });
      }
      finalAudioTracks.push({
        language: aLang,
        url: tUrl,
        qualities: tQualities,
      });
    }

    return {
      url: baseMasterUrl,
      audioTracks: finalAudioTracks,
      subtitles: subtitles,
    };
  }

  async function fetchCineJoyCollaboration(tmdbId, imdbId, title, isTvShow, season, episode, year) {
    var g = typeof globalThis !== 'undefined' ? globalThis : typeof window !== 'undefined' ? window : null;
    if (g && g.CineJoyExtractor && typeof g.CineJoyExtractor.extract === 'function') {
      try {
        var res = await g.CineJoyExtractor.extract(tmdbId, imdbId, title, isTvShow, season, episode, year);
        if (res && res.audioTracks) return res;
      } catch (e) {}
    }
    if (typeof require === 'function') {
      try {
        var cj = require('./CineJoyExtractor.js');
        if (cj && typeof cj.extract === 'function') {
          var res = await cj.extract(tmdbId, imdbId, title, isTvShow, season, episode, year);
          if (res && res.audioTracks) return res;
        }
      } catch (e) {}
    }
    try {
      return await extractVidlyStandalone(tmdbId, imdbId, isTvShow, season, episode);
    } catch (e) {
      return null;
    }
  }

  async function extract(tmdbId, arg1, arg2, arg3, arg4, arg5, arg6) {
    // Calling convention detection:
    //   4-param: (tmdbId, isTv, season, episode)
    //   5-param: (tmdbId, imdbId, isTv, season, episode)
    //   7-param: (tmdbId, imdbId, title, isTv, season, episode, year)
    var imdbId, title, isTv, season, episode, year;

    if (typeof arg1 === 'boolean') {
      isTv = arg1; season = arg2; episode = arg3;
    } else if (typeof arg2 === 'boolean') {
      imdbId = arg1; isTv = arg2; season = arg3; episode = arg4;
    } else {
      imdbId = arg1; title = arg2; isTv = arg3; season = arg4; episode = arg5; year = arg6;
    }

    var isTvShow = isTv === true || String(isTv) === 'true' || String(isTv) === 'tv';
    var id = (imdbId && typeof imdbId === 'string' && imdbId.indexOf('tt') === 0) ? imdbId : tmdbId;

    if (!id) {
      console.warn(TAG + ' ❌ Missing both tmdbId and imdbId');
      return null;
    }

    // Launch CineJoy collaboration in background concurrently
    var cineJoyPromise = fetchCineJoyCollaboration(tmdbId, imdbId, title, isTvShow, season, episode, year);

    var lordFlixResult = null;

    // 1. Direct WebAssembly extraction (V8 / Node.js / Android TV / Web)
    if (typeof WebAssembly !== 'undefined') {
      try {
        lordFlixResult = await extractDirect(id, isTvShow, season, episode);
      } catch (directErr) {
        console.warn(TAG + ' ⚠️ Direct extraction failed: ' + (directErr.message || directErr));
      }
    }

    // 2. Fallback: Backend Proxy
    if (!lordFlixResult) {
      try {
        lordFlixResult = await extractViaBackend(tmdbId, imdbId, isTvShow, season, episode);
      } catch (err) {}
    }

    if (!lordFlixResult) {
      return null;
    }

    // Await CineJoy collaboration with a 12000ms timeout so LordFlix has all multi-audio tracks
    try {
      var cjResult = await Promise.race([
        cineJoyPromise,
        new Promise(function (resolve) { setTimeout(function () { resolve(null); }, 12000); }),
      ]);

      if (cjResult && Array.isArray(cjResult.audioTracks) && cjResult.audioTracks.length > 0) {
        var combinedTracks = [];
        // Track 0 is LordFlix English (with its low-resolution 360p / 720p / 1080p options)
        combinedTracks.push({
          language: 'English',
          url: lordFlixResult.url,
          qualities: lordFlixResult.qualities || [{ quality: 'Auto', url: lordFlixResult.url }],
        });

        for (var cti = 0; cti < cjResult.audioTracks.length; cti++) {
          var ct = cjResult.audioTracks[cti];
          if (ct && ct.language && ct.language.toLowerCase() !== 'english') {
            combinedTracks.push({
              language: ct.language,
              url: ct.url,
              qualities: ct.qualities || [],
            });
          }
        }

        if (combinedTracks.length > 1) {
          lordFlixResult.audioTracks = combinedTracks;
          console.log(TAG + ' 🤝 Collab success: merged ' + combinedTracks.length + ' audio tracks with CineJoy');
        }
      }

      // Merge subtitles from CineJoy
      if (cjResult && Array.isArray(cjResult.subtitles) && cjResult.subtitles.length > 0) {
        var seenSubs = {};
        for (var si = 0; si < lordFlixResult.subtitles.length; si++) {
          seenSubs[lordFlixResult.subtitles[si].url] = true;
        }
        for (var sj = 0; sj < cjResult.subtitles.length; sj++) {
          var cs = cjResult.subtitles[sj];
          if (cs && cs.url && !seenSubs[cs.url]) {
            seenSubs[cs.url] = true;
            lordFlixResult.subtitles.push(cs);
          }
        }
        console.log(TAG + ' 📝 Subtitles merged: total ' + lordFlixResult.subtitles.length);
      }
    } catch (collabErr) {
      console.warn(TAG + ' ⚠️ Collab warning: ' + (collabErr.message || collabErr));
    }

    return lordFlixResult;
  }

  var extractor = { extract: extract };
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = extractor;
  }
  var gObj = typeof globalThis !== 'undefined' ? globalThis
    : typeof window !== 'undefined' ? window
    : typeof global !== 'undefined' ? global : this;
  if (gObj) {
    gObj.LordFlixExtractor = extractor;
  }
})();
