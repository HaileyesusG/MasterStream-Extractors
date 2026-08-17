/**
 * LordFlix / VidSrcMe Fast Remote Extractor
 * Hot-loaded via RemoteJsExtractor (TV) and RemoteExtractorLoader (Mobile).
 * 
 * Works 100% over direct JSON API + WebAssembly ChaCha20 in ~400-800ms.
 * Zero WebView overhead, zero CPU lag on Android TV devices.
 */

var USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36';
var REFERER = 'https://cloudorchestranova.com/';
var API_BASE = 'https://data.vidsrcme.ru/api.php';

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

async function fetchStreamToken(streamUrl) {
  try {
    var u = new URL(streamUrl);
    var tokenUrl = u.origin + '/generate.php';
    var res = await fetch(tokenUrl, {
      headers: {
        'User-Agent': USER_AGENT,
        'Referer': REFERER,
        'Origin': REFERER.replace(/\/+$/, ''),
      },
    });
    if (!res.ok) return '';
    var text = await res.text();
    return text.trim();
  } catch (e) {
    return '';
  }
}

async function extract(tmdbId, imdbId, title, isTv, season, episode, year) {
  try {
    var isTvShow = isTv === true || String(isTv) === 'true' || String(isTv) === 'tv';
    var apiUrl = '';

    if (isTvShow) {
      var s = season || 1;
      var e = episode || 1;
      var idParam = (imdbId && typeof imdbId === 'string' && imdbId.startsWith('tt'))
        ? 'imdb=' + encodeURIComponent(imdbId)
        : 'tmdb=' + encodeURIComponent(String(tmdbId));
      apiUrl = API_BASE + '?type=tv&' + idParam + '&season=' + s + '&episode=' + e + '&stream_urls';
    } else {
      var idParam = (imdbId && typeof imdbId === 'string' && imdbId.startsWith('tt'))
        ? 'imdb=' + encodeURIComponent(imdbId)
        : 'tmdb=' + encodeURIComponent(String(tmdbId));
      apiUrl = API_BASE + '?type=movie&' + idParam + '&stream_urls';
    }

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

    // Grab first stream & mint its IP-bound JWT token
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
