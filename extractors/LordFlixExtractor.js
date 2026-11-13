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

    // 1. Native WebAssembly (Node.js, Android TV WebView / V8)
    if (typeof WebAssembly !== 'undefined') {
      try {
        var modPromise = getWasmModule(vs.w, vs.wasm_url, vs.wasm, referer);
        if (modPromise) {
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

          var localUrls = text.split('\n').map(function (s) { return s.trim(); }).filter(Boolean);
          if (localUrls.length > 0) return localUrls;
        }
      } catch (wasmErr) {
        console.warn(TAG + ' ⚠️ Local WASM decrypt failed, falling back to remote decrypt: ' + (wasmErr.message || wasmErr));
      }
    }

    // 2. Remote WASM decryption service (React Native / Hermes where WebAssembly is not available)
    try {
      console.log(TAG + ' ⚡ Decrypting stream URLs via remote WASM service...');
      var controller = (typeof AbortController !== 'undefined') ? new AbortController() : null;
      var timer = controller ? setTimeout(function () { try { controller.abort(); } catch (_) {} }, 10000) : null;
      var res = await fetch('https://master-stream-web2.vercel.app/api/decrypt', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
        },
        body: JSON.stringify({
          vs: vs,
          encryptedB64: encryptedB64,
          referer: referer,
        }),
        signal: controller ? controller.signal : undefined,
      });
      if (timer) clearTimeout(timer);
      if (res && res.ok) {
        var json = await res.json();
        if (json && json.ok && Array.isArray(json.urls) && json.urls.length > 0) {
          console.log(TAG + ' ✅ Remote WASM decrypted ' + json.urls.length + ' streams');
          return json.urls;
        }
      }
    } catch (remoteErr) {
      console.warn(TAG + ' ⚠️ Remote WASM decrypt failed: ' + (remoteErr.message || remoteErr));
    }

    return [];
  }

    // In-memory token cache by origin (JWT is valid for ~3.5 hours)
  var tokenCache = {};

  async function fetchClientApiToken(id, isTv, season, episode) {
    try {
      var embedUrl = isTv
        ? VIDSRC_BASE + '/embed/tv/' + id + '/' + (season || 1) + '/' + (episode || 1)
        : VIDSRC_BASE + '/embed/movie/' + id;

      var controller = (typeof AbortController !== 'undefined') ? new AbortController() : null;
      var timer = controller ? setTimeout(function () { try { controller.abort(); } catch (_) {} }, 8000) : null;

      var embedRes = await fetch(embedUrl, {
        headers: { 'User-Agent': USER_AGENT, 'Referer': VIDSRC_BASE + '/' },
        signal: controller ? controller.signal : undefined,
      });
      if (timer) clearTimeout(timer);
      if (!embedRes || !embedRes.ok) return null;
      var embedHtml = await embedRes.text();
      var apiMatch = embedHtml.match(/data-api="([^"]+)"/);
      if (!apiMatch) return null;

      var vsSrcPath = apiMatch[1].replace(/&amp;/g, '&');
      var vsSrcUrl = vsSrcPath.indexOf('http') === 0 ? vsSrcPath : VIDSRC_BASE + vsSrcPath;

      controller = (typeof AbortController !== 'undefined') ? new AbortController() : null;
      timer = controller ? setTimeout(function () { try { controller.abort(); } catch (_) {} }, 8000) : null;
      var vsRes = await fetch(vsSrcUrl, {
        headers: { 'User-Agent': USER_AGENT, 'Referer': embedUrl },
        signal: controller ? controller.signal : undefined,
      });
      if (timer) clearTimeout(timer);
      if (!vsRes || !vsRes.ok) return null;
      var vsJson = await vsRes.json();
      if (!vsJson || !vsJson.src) return null;

      var landingUrlsToTry = [];
      if (vsJson.src.indexOf('cloudorchestranova.com') > -1) {
        landingUrlsToTry.push(vsJson.src);
        landingUrlsToTry.push(vsJson.src.replace('cloudorchestranova.com', 'stellarconductornexus.com'));
      } else if (vsJson.src.indexOf('stellarconductornexus.com') > -1) {
        landingUrlsToTry.push(vsJson.src);
        landingUrlsToTry.push(vsJson.src.replace('stellarconductornexus.com', 'cloudorchestranova.com'));
      } else {
        landingUrlsToTry.push(vsJson.src);
      }

      for (var li = 0; li < landingUrlsToTry.length; li++) {
        var landingUrl = landingUrlsToTry[li];
        var landingOrigin = new URL(landingUrl).origin;

        try {
          controller = (typeof AbortController !== 'undefined') ? new AbortController() : null;
          timer = controller ? setTimeout(function () { try { controller.abort(); } catch (_) {} }, 8000) : null;
          var landingRes = await fetch(landingUrl, {
            headers: {
              'User-Agent': USER_AGENT,
              'Referer': VIDSRC_BASE + '/',
              'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
            },
            signal: controller ? controller.signal : undefined,
          });
          if (timer) clearTimeout(timer);
          if (!landingRes || !landingRes.ok) continue;
          var landingHtml = await landingRes.text();
          var cfgMatch = landingHtml.match(/window\.CFG\s*=\s*({[^;]+});/) ||
                         landingHtml.match(/window\.CFG\s*=\s*({[\s\S]*?});/);
          if (!cfgMatch) continue;
          var cfg = JSON.parse(cfgMatch[1]);
          if (!cfg.playerUrl) continue;

          var playerUrl = cfg.playerUrl.indexOf('http') === 0 ? cfg.playerUrl : landingOrigin + cfg.playerUrl;

          controller = (typeof AbortController !== 'undefined') ? new AbortController() : null;
          timer = controller ? setTimeout(function () { try { controller.abort(); } catch (_) {} }, 8000) : null;
          var playerRes = await fetch(playerUrl, {
            headers: { 'User-Agent': USER_AGENT, 'Referer': landingUrl },
            signal: controller ? controller.signal : undefined,
          });
          if (timer) clearTimeout(timer);
          if (!playerRes || !playerRes.ok) continue;
          var playerHtml = await playerRes.text();
          var confMatch = playerHtml.match(/window\.CONFIG\s*=\s*({[^;]+});/) ||
                          playerHtml.match(/window\.CONFIG\s*=\s*({[\s\S]*?});/);
          if (!confMatch) continue;
          var config = JSON.parse(confMatch[1]);

          // If rate-limited on this mirror, try the other mirror
          if (config.rateLimited || !config.apiToken) {
            console.warn(TAG + ' ⚠️ Mirror ' + landingOrigin + ' rate-limited, trying alternate mirror...');
            continue;
          }

          return {
            apiToken: config.apiToken,
            playerUrl: playerUrl,
            landingOrigin: landingOrigin,
          };
        } catch (_) {}
      }

      return null;
    } catch (_) {
      return null;
    }
  }

  async function fetchStreamToken(streamUrl, referer, origin, apiToken, cacheId) {
    try {
      var u = new URL(streamUrl);
      var streamOrigin = u.origin;
      var now = Math.floor(Date.now() / 1000);
      var cacheKey = (cacheId ? (String(cacheId) + '_') : '') + streamOrigin;
      var cached = tokenCache[cacheKey];
      if (cached && cached.token && cached.exp > now + 300) {
        return cached.token;
      }

      if (!apiToken) return '';

      var candidateUrls = [
        streamOrigin + '/generate.php?api_token=' + encodeURIComponent(apiToken),
        streamOrigin.replace(/^https:/i, 'http:') + '/generate.php?api_token=' + encodeURIComponent(apiToken),
        streamOrigin + '/generate.php',
      ];

      var headerCandidates = [
        {
          'User-Agent': USER_AGENT,
          'Referer': referer || VIDSRC_BASE + '/',
          'Origin': origin || (referer ? new URL(referer).origin : VIDSRC_BASE),
        },
        {
          'User-Agent': USER_AGENT,
          'Referer': VIDSRC_BASE + '/',
          'Origin': VIDSRC_BASE,
        },
      ];

      for (var i = 0; i < candidateUrls.length; i++) {
        var tokenUrl = candidateUrls[i];
        for (var h = 0; h < headerCandidates.length; h++) {
          var headers = headerCandidates[h];
          try {
            var tokCtrl = (typeof AbortController !== 'undefined') ? new AbortController() : null;
            var tokTimer = tokCtrl ? setTimeout(function () { try { tokCtrl.abort(); } catch (_) {} }, 6000) : null;
            var res = await fetch(tokenUrl, { headers: headers, signal: tokCtrl ? tokCtrl.signal : undefined });
            if (tokTimer) clearTimeout(tokTimer);
            if (res && res.ok) {
              var text = (await res.text()).trim();
              if (text && text.indexOf('eyJ') === 0) {
                var entry = {
                  token: text,
                  exp: now + 3.5 * 3600,
                };
                tokenCache[cacheKey] = entry;
                console.log(TAG + ' 🔑 Successfully minted token for ' + cacheKey);
                return text;
              }
            }
          } catch (fetchErr) {}
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
            var xhrEntry = {
              token: xhrText,
              exp: now + 3.5 * 3600,
            };
            tokenCache[cacheKey] = xhrEntry;
            console.log(TAG + ' 🔑 Successfully minted token via XHR for ' + cacheKey);
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

    var landingUrlsToTry = [vsJson.src];
    if (vsJson.src.indexOf('cloudorchestranova.com') > -1) {
      landingUrlsToTry.push(vsJson.src.replace('cloudorchestranova.com', 'stellarconductornexus.com'));
    } else if (vsJson.src.indexOf('stellarconductornexus.com') > -1) {
      landingUrlsToTry.push(vsJson.src.replace('stellarconductornexus.com', 'cloudorchestranova.com'));
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
    var effectiveReferer = landingOrigin ? (landingOrigin + '/') : (playerUrl || (VIDSRC_BASE + '/'));
    var effectiveOrigin = landingOrigin || (effectiveReferer ? new URL(effectiveReferer).origin : VIDSRC_BASE);
    var streamHeaders = {
      'User-Agent': USER_AGENT,
      'Referer': effectiveReferer,
      'Origin': effectiveOrigin,
    };

    var primaryUrl = streamUrls[0];
    var token = await fetchStreamToken(primaryUrl, effectiveReferer, effectiveOrigin, config ? config.apiToken : null, id);

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
    var qualities = await parseMasterQualities(finalUrl, streamHeaders);

    console.log(TAG + ' ✅ Extracted stream successfully (' + qualities.length + ' qualities)');

    return {
      url: finalUrl,
      quality: 'Auto',
      provider: 'LordFlix',
      headers: streamHeaders,
      subtitles: subtitles,
      qualities: qualities,
    };
  }

  /** Parse HLS master playlist variants into QualityOption array */
  async function parseMasterQualities(masterUrl, headers) {
    var qualities = [{ quality: 'Auto', url: masterUrl }];
    var timer = null;
    try {
      var controller = (typeof AbortController !== 'undefined') ? new AbortController() : null;
      timer = controller ? setTimeout(function () { try { controller.abort(); } catch (e) {} }, 8000) : null;
      var res = await fetch(masterUrl, { headers: headers, signal: controller ? controller.signal : undefined });
      if (timer) clearTimeout(timer);
      if (!res || !res.ok) return qualities;
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
          var parsedAbsUrl = new URL(nextLine, masterUrl);
          if (!parsedAbsUrl.search && masterUrl.indexOf('token=') > -1) {
            var tokenParam = masterUrl.match(/[?&](token=[^&]+)/);
            if (tokenParam) {
              parsedAbsUrl.search = '?' + tokenParam[1];
            }
          }
          var absUrl = parsedAbsUrl.href;
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
      if (timer) clearTimeout(timer);
      if (e && (e.name === 'AbortError' || /abort/i.test(e.message || ''))) {
        console.log(TAG + ' ⏱️ Master qualities parse skipped (network latency)');
      } else {
        console.warn(TAG + ' ⚠️ Failed to parse master qualities: ' + (e.message || e));
      }
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

      var controller = (typeof AbortController !== 'undefined') ? new AbortController() : null;
      var timer = controller ? setTimeout(function () { try { controller.abort(); } catch (e) {} }, 22000) : null;
      var res = await fetch(BACKEND_URL + '?' + query, {
        headers: { Accept: 'application/json' },
        signal: controller ? controller.signal : undefined,
      });
      if (timer) clearTimeout(timer);
      if (!res || !res.ok) return null;
      var data = await res.json();
      if (!data || !data.url) return null;

      var rawUrl = data.url.replace(/([?&])token=[^&]*/g, '').replace(/[?&]$/, '');
      var u = new URL(rawUrl);
      var streamOrigin = u.origin;
      var now = Math.floor(Date.now() / 1000);

      // Check cache first for 0ms token resolution
      var cacheId = tmdbId || imdbId;
      var cacheKey = (cacheId ? (String(cacheId) + '_') : '') + streamOrigin;
      var cached = tokenCache[cacheKey];
      var token = (cached && cached.exp > now + 300)
        ? cached.token
        : (tokenCache[streamOrigin] && tokenCache[streamOrigin].exp > now + 300)
        ? tokenCache[streamOrigin].token
        : null;

      var playerReferer = (data.headers && (data.headers.Referer || data.headers.referer)) || (VIDSRC_BASE + '/');
      var playerOrigin = (data.headers && (data.headers.Origin || data.headers.origin)) || VIDSRC_BASE;

      if (token) {
        console.log(TAG + ' ⚡ Reusing active client token for ' + cacheKey);
      } else {
        // Mint client-bound token using client's IP
        var clientInfo = await fetchClientApiToken(cacheId, isTvShow, season, episode);
        if (clientInfo && clientInfo.apiToken) {
          playerReferer = clientInfo.landingOrigin ? (clientInfo.landingOrigin + '/') : clientInfo.playerUrl;
          playerOrigin = clientInfo.landingOrigin || VIDSRC_BASE;
          token = await fetchStreamToken(rawUrl, playerReferer, playerOrigin, clientInfo.apiToken, cacheId);
        }
      }

      // Fallback 1: check if data.url already had token
      if (!token && data.url.indexOf('token=') > -1) {
        var match = data.url.match(/[?&]token=([^&]+)/);
        if (match) token = decodeURIComponent(match[1]);
      }

      // Fallback 2: check if any active cached token exists
      if (!token && tokenCache['__latest__'] && tokenCache['__latest__'].exp > now + 60) {
        token = tokenCache['__latest__'].token;
        console.log(TAG + ' ⚡ Fallback: Reusing active token from cache');
      }

      if (!token) {
        console.warn(TAG + ' ⚠️ Backend stream has no valid token — rejecting');
        return null;
      }

      var finalUrl = rawUrl + (rawUrl.indexOf('?') > -1 ? '&' : '?') + 'token=' + encodeURIComponent(token);
      var streamHeaders = {
        'User-Agent': USER_AGENT,
        'Referer': playerReferer,
        'Origin': playerOrigin,
      };
      var qualities = await parseMasterQualities(finalUrl, streamHeaders);

      return {
        url: finalUrl,
        quality: data.quality || 'Auto',
        provider: 'LordFlix',
        headers: streamHeaders,
        subtitles: data.subtitles || [],
        qualities: qualities,
      };
    } catch (e) {
      return null;
    }
  }

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

  var amharicTokenCache = {};

  var dynamicCatalogCache = null;
  var dynamicCatalogExpiry = 0;

  async function getAmharicCatalog() {
    var now = Date.now();
    if (dynamicCatalogCache && now < dynamicCatalogExpiry) {
      return dynamicCatalogCache;
    }
    try {
      var controller = (typeof AbortController !== 'undefined') ? new AbortController() : null;
      var timeoutId = controller ? setTimeout(function () { controller.abort(); }, 5000) : null;
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
          dynamicCatalogExpiry = now + (5 * 60 * 1000);
          return dynamicCatalogCache;
        }
      }
    } catch (fetchErr) {
      // Fall back quietly
    }
    return AMHARIC_CATALOG;
  }


  
  async function isStreamPlayable(url, headers) {
    if (!url) return false;
    try {
      var controller = (typeof AbortController !== 'undefined') ? new AbortController() : null;
      var timeoutId = controller ? setTimeout(function () { try { controller.abort(); } catch (e) {} }, 5000) : null;
      var reqHeaders = Object.assign({}, headers || {}, { 'Range': 'bytes=0-10' });
      
      // Step 1: Probe master URL
      var res = await fetch(url, {
        method: 'GET',
        headers: reqHeaders,
        signal: controller ? controller.signal : undefined
      });
      if (!res || !res.ok) {
        if (timeoutId) clearTimeout(timeoutId);
        return false;
      }

      // Step 2: For HLS (.m3u8), deeply validate actual media segments!
      // Master playlist returning 200 is a common false positive when segments are blocked/403.
      if (url.indexOf('.m3u8') > -1) {
        var text = await res.text();
        if (!text || text.indexOf('#EXTM3U') === -1) {
          if (timeoutId) clearTimeout(timeoutId);
          return false;
        }

        var lines = text.split('\n').map(function (l) { return l.trim(); }).filter(function (l) {
          return l && l.indexOf('#') !== 0;
        });
        if (lines.length === 0) {
          if (timeoutId) clearTimeout(timeoutId);
          return false;
        }

        var candidateUrl = lines[0].indexOf('http') === 0 ? lines[0] : new URL(lines[0], url).href;

        // If candidateUrl is another playlist (variant / quality stream), fetch it to get actual media segment
        if (candidateUrl.indexOf('.m3u8') > -1 || text.indexOf('#EXT-X-STREAM-INF') > -1) {
          var subRes = await fetch(candidateUrl, {
            method: 'GET',
            headers: reqHeaders,
            signal: controller ? controller.signal : undefined
          });
          if (!subRes || !subRes.ok) {
            if (timeoutId) clearTimeout(timeoutId);
            return false;
          }
          var subText = await subRes.text();
          var subLines = subText.split('\n').map(function (l) { return l.trim(); }).filter(function (l) {
            return l && l.indexOf('#') !== 0;
          });
          if (subLines.length === 0) {
            if (timeoutId) clearTimeout(timeoutId);
            return false;
          }
          candidateUrl = subLines[0].indexOf('http') === 0 ? subLines[0] : new URL(subLines[0], candidateUrl).href;
        }

        // Probe the actual media segment with reqHeaders (Referer & Origin forwarded by ExoPlayer)
        var segRes = await fetch(candidateUrl, {
          method: 'GET',
          headers: reqHeaders,
          signal: controller ? controller.signal : undefined
        });
        if (timeoutId) clearTimeout(timeoutId);

        if (!segRes || (segRes.status !== 200 && segRes.status !== 206)) {
          console.warn(TAG + ' ❌ Segment health check failed (HTTP ' + (segRes ? segRes.status : 'null') + ') — rejecting false positive');
          return false;
        }
      } else {
        if (timeoutId) clearTimeout(timeoutId);
        if (res.status !== 200 && res.status !== 206) return false;
      }

      return true;
    } catch (e) {
      return false;
    }
  }

  async function attachAmharicAudioTrack(result, tmdbId, isTvShow, season, episode, title) {
    if (!result || !result.url) return null;

    // Validate that the primary stream is actually playable before returning success or attaching any dub!
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

      // Use backend 302 redirect ending in .mp4 so ExoPlayer initializes ProgressiveMediaSource / Mp4Extractor
      var amharicUrl = item.uniqueId
        ? 'https://backendmasterstream.onrender.com/api/cinejoy/telegram/' + encodeURIComponent(item.uniqueId) + '.mp4'
        : (item.fallbackUrl || item.streamUrl);

      var englishQualities = (result.qualities && result.qualities.length > 0)
        ? result.qualities
        : [{ quality: result.quality || 'Auto', url: result.url }];

      var amharicQualities = [
        { quality: '1080p', url: amharicUrl },
        { quality: 'Auto', url: amharicUrl },
      ];

      var amharicLabel = 'Amharic (\u1260\u1275\u122d\u1309\u121d)';

      result.audioTracks = [
        {
          language: 'English',
          url: result.url,
          qualities: englishQualities,
        },
        {
          language: amharicLabel,
          url: amharicUrl,
          qualities: amharicQualities,
        },
      ];

      console.log(TAG + ' 🇪🇹 Attached Amharic audio track (.mp4 redirect) to result');
    } catch (attachErr) {
      console.warn(TAG + ' ⚠️ attachAmharicAudioTrack error: ' + (attachErr.message || attachErr));
    }
    return result;
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

    // Special case: Lupin (TMDB 96677 / tt2531336) Season 3+ has French audio on vidsrc,
    // while CineJoy (Vidly) has English audio. Defer to CineJoy so users get English audio.
    var isLupinS3Plus = (
      String(tmdbId) === '96677' ||
      String(id) === '96677' ||
      (typeof imdbId === 'string' && imdbId === 'tt2531336') ||
      (typeof id === 'string' && id === 'tt2531336') ||
      (title && /lupin/i.test(title))
    ) && isTvShow && Number(season) >= 3;

    if (isLupinS3Plus) {
      console.log(TAG + ' 🔄 Lupin S' + season + ': delegating to CineJoy for English audio...');
      var cjExt = null;
      for (var w = 0; w < 30; w++) {
        cjExt = (typeof globalThis !== 'undefined' && globalThis.CineJoyExtractor)
          ? globalThis.CineJoyExtractor
          : (typeof window !== 'undefined' && window.CineJoyExtractor)
          ? window.CineJoyExtractor
          : null;
        if (cjExt && typeof cjExt.extract === 'function') break;
        await new Promise(function (r) { setTimeout(r, 100); });
      }

      if (cjExt && typeof cjExt.extract === 'function') {
        try {
          var cjRes = await cjExt.extract(tmdbId, imdbId, title || 'Lupin', isTvShow, season, episode, year);
          if (cjRes && cjRes.url) {
            console.log(TAG + ' ✅ Lupin S' + season + ': successfully extracted English stream via CineJoy');
            var res = Object.assign({}, cjRes, { provider: 'LordFlix' });
            return await attachAmharicAudioTrack(res, tmdbId, isTvShow, season, episode, title);
          }
        } catch (e) {
          console.warn(TAG + ' ⚠️ CineJoy delegation failed: ' + (e.message || e));
        }
      }
      return null;
    }

    // 1. Direct extraction (native client residential IP + local V8 or remote Hermes WASM decryption)
    try {
      console.log(TAG + ' 🔄 Starting direct client extraction...');
      var directResult = await extractDirect(id, isTvShow, season, episode);
      if (directResult && directResult.url) {
        var dirWithDub = await attachAmharicAudioTrack(directResult, tmdbId, isTvShow, season, episode, title);
        if (dirWithDub && dirWithDub.url) {
          console.log(TAG + ' 🚀 Direct client extraction succeeded');
          return dirWithDub;
        }
        console.warn(TAG + ' ⚠️ Direct stream rejected by health check');
      }
    } catch (directErr) {
      console.warn(TAG + ' ⚠️ Direct extraction failed: ' + (directErr.message || directErr));
    }

    // 2. Fast backend fallback
    try {
      console.log(TAG + ' ⚡ Attempting backend extraction fallback...');
      var fastResult = await extractViaBackend(tmdbId, imdbId, isTvShow, season, episode);
      if (fastResult && fastResult.url) {
        var fastWithDub = await attachAmharicAudioTrack(fastResult, tmdbId, isTvShow, season, episode, title);
        if (fastWithDub && fastWithDub.url) {
          console.log(TAG + ' 🚀 Backend extraction fallback succeeded');
          return fastWithDub;
        }
      }
    } catch (fastErr) {
      console.warn(TAG + ' ⚠️ Backend extraction fallback failed: ' + (fastErr.message || fastErr));
    }

    return null;
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
