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

      var tokenUrl = streamOrigin + '/generate.php';
      var res = await fetch(tokenUrl, {
        headers: {
          'User-Agent': USER_AGENT,
          'Referer': referer,
          'Origin': origin || new URL(referer).origin,
        },
      });
      if (!res.ok) return '';
      var text = (await res.text()).trim();
      if (!text || text.indexOf('eyJ') !== 0) return '';

      tokenCache[streamOrigin] = {
        token: text,
        exp: now + 3.5 * 3600,
      };
      return text;
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

    var finalUrl = token
      ? primaryUrl + (primaryUrl.indexOf('?') > -1 ? '&' : '?') + 'token=' + encodeURIComponent(token)
      : primaryUrl;

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

    console.log(TAG + ' ✅ Extracted stream successfully');

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
    };
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
      var finalUrl = token
        ? rawUrl + (rawUrl.indexOf('?') > -1 ? '&' : '?') + 'token=' + encodeURIComponent(token)
        : rawUrl;

      return {
        url: finalUrl,
        quality: data.quality || 'Auto',
        provider: 'LordFlix',
        headers: data.headers || {
          'User-Agent': USER_AGENT,
          'Referer': VIDSRC_BASE + '/',
        },
        subtitles: data.subtitles || [],
      };
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

    // 1. Direct WebAssembly extraction (V8 / Node.js / Android TV / Web)
    if (typeof WebAssembly !== 'undefined') {
      try {
        var directResult = await extractDirect(id, isTvShow, season, episode);
        if (directResult) return directResult;
      } catch (directErr) {
        console.warn(TAG + ' ⚠️ Direct extraction failed: ' + (directErr.message || directErr));
      }
    }

    // 2. Fallback: Backend Proxy
    try {
      return await extractViaBackend(tmdbId, imdbId, isTvShow, season, episode);
    } catch (err) {
      return null;
    }
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
