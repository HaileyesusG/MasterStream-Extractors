/**
 * LordFlix / VidSrcMe Fast Remote Extractor
 * Hot-loaded via RemoteJsExtractor (TV) and RemoteExtractorLoader (Mobile).
 *
 * Strategy:
 *   - Android TV (V8/WebView): Runs direct WASM decryption locally — ~400ms.
 *   - Mobile (React Native Hermes): No WebAssembly, calls backend proxy — ~300ms.
 *
 * Works 100% without WebView sniffer. Zero CPU lag on Android TV devices.
 */

var USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36';
var REFERER = 'https://cloudorchestranova.com/';
var API_BASE = 'https://data.vidsrcme.ru/api.php';

// Backend proxy for React Native Hermes (no WebAssembly support)
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

async function getWasmModule(windowId, wasmUrl, wasmBase64) {
  var key = 'w_' + windowId;
  if (wasmModuleCache[key]) {
    return wasmModuleCache[key];
  }

  var promise;
  if (wasmUrl) {
    promise = fetch(wasmUrl, {
      headers: {
        'User-Agent': USER_AGENT,
        'Referer': REFERER,
      },
    })
      .then(function (r) { return r.arrayBuffer(); })
      .then(function (bytes) { return WebAssembly.compile(bytes); });
  } else if (wasmBase64) {
    var bytes = getBase64Bytes(wasmBase64);
    promise = WebAssembly.compile(bytes.buffer);
  } else {
    return null;
  }

  wasmModuleCache[key] = promise;
  return promise;
}

async function decryptStreamUrls(vs, encryptedB64) {
  if (!vs || !encryptedB64) return [];

  var modPromise = getWasmModule(vs.w, vs.wasm_url, vs.wasm);
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

// In-memory token cache by origin (JWT is valid for 4 hours)
var tokenCache = {};

async function fetchStreamToken(streamUrl) {
  try {
    var u = new URL(streamUrl);
    var origin = u.origin;
    var now = Math.floor(Date.now() / 1000);
    var cached = tokenCache[origin];
    if (cached && cached.token && cached.exp > now + 300) {
      return cached.token;
    }

    var tokenUrl = origin + '/generate.php';
    var res = await fetch(tokenUrl, {
      headers: {
        'User-Agent': USER_AGENT,
        'Referer': REFERER,
        'Origin': REFERER.replace(/\/+$/, ''),
      },
    });
    if (!res.ok) return '';
    var text = (await res.text()).trim();
    if (!text || text.indexOf('eyJ') !== 0) return '';

    tokenCache[origin] = {
      token: text,
      exp: now + 3.5 * 3600,
    };
    return text;
  } catch (e) {
    return '';
  }
}

/** Called when Hermes has no WebAssembly — delegates to backend for decryption, then mints token on client */
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

    // Strip any server-minted token (tokens are bound to the client's IP)
    var rawUrl = data.url.replace(/([?&])token=[^&]*/g, '').replace(/[?&]$/, '');

    // Mint fresh token directly from the client device
    var token = await fetchStreamToken(rawUrl);
    var finalUrl = token
      ? rawUrl + (rawUrl.indexOf('?') > -1 ? '&' : '?') + 'token=' + encodeURIComponent(token)
      : rawUrl;

    return {
      url: finalUrl,
      quality: data.quality || 'Auto',
      provider: 'LordFlix',
      headers: data.headers || {
        'User-Agent': USER_AGENT,
        'Referer': REFERER,
        'Origin': REFERER.replace(/\/+$/, ''),
      },
      subtitles: data.subtitles || [],
    };
  } catch (e) {
    return null;
  }
}

async function extract(tmdbId, imdbId, title, isTv, season, episode, year) {
  try {
    // ── Hermes (React Native) has no WebAssembly → use backend proxy ──────────
    if (typeof WebAssembly === 'undefined') {
      return await extractViaBackend(tmdbId, imdbId, isTv, season, episode);
    }

    // ── Android TV WebView / Node: run WASM decryption locally ────────────────
    var isTvShow = isTv === true || String(isTv) === 'true' || String(isTv) === 'tv';
    var idParam;

    if (imdbId && typeof imdbId === 'string' && imdbId.startsWith('tt')) {
      idParam = 'imdb=' + encodeURIComponent(imdbId);
    } else {
      idParam = 'tmdb=' + encodeURIComponent(String(tmdbId));
    }

    var apiUrl = isTvShow
      ? API_BASE + '?type=tv&' + idParam + '&season=' + (season || 1) + '&episode=' + (episode || 1) + '&stream_urls'
      : API_BASE + '?type=movie&' + idParam + '&stream_urls';

    var apiRes = await fetch(apiUrl, {
      headers: {
        'User-Agent': USER_AGENT,
        'Referer': REFERER,
        'Origin': REFERER.replace(/\/+$/, ''),
        'Accept': 'application/json',
      },
    });

    if (!apiRes.ok) return null;
    var json = await apiRes.json();
    if (!json || !json.data || !json.data.stream_urls) return null;

    var streamUrls = [];
    if (typeof json.data.stream_urls === 'string' && json.vs) {
      streamUrls = await decryptStreamUrls(json.vs, json.data.stream_urls);
    } else if (Array.isArray(json.data.stream_urls)) {
      streamUrls = json.data.stream_urls;
    }

    if (!streamUrls || streamUrls.length === 0) return null;

    var primaryUrl = streamUrls[0];
    var token = await fetchStreamToken(primaryUrl);

    var finalUrl = token
      ? primaryUrl + (primaryUrl.indexOf('?') > -1 ? '&' : '?') + 'token=' + encodeURIComponent(token)
      : primaryUrl;

    return {
      url: finalUrl,
      quality: 'Auto',
      provider: 'LordFlix',
      headers: {
        'User-Agent': USER_AGENT,
        'Referer': REFERER,
        'Origin': REFERER.replace(/\/+$/, ''),
      },
      subtitles: [],
    };
  } catch (err) {
    return null;
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { extract: extract };
}
