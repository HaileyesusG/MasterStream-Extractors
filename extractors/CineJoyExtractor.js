/**
 * CineJoyExtractor v3.2.1 — self-contained CommonJS for remote hot-update.
 *
 * Strategy: Use cinejoy.to's own BOqDcafn.js (sandboxed) for the lumen-gate-v1
 * session protocol. This guarantees correctness as the site updates its crypto.
 *
 * React Native / Hermes compatibility:
 *   - Sandbox provides all required globals (HTMLElement, URL, etc.)
 *   - extract() returns a Promise AND calls callback (dual API)
 *   - No `import` or `export` statements (stripped from BOqDcafn.js)
 *
 * Node.js: Uses vm.createContext() sandbox (safe, isolated).
 * React Native: Uses new Function() with explicit global shims.
 *
 * Fixes over v3.1.0:
 *   - extract() now returns Promise (fixes 'Cannot read property then of undefined')
 *   - loadBoqEval() provides HTMLElement, AbortController and other RN-missing globals
 *   - binaryPost also used for /g/ JSON requests (Node.js undici header stripping fix)
 */
(function () {
  'use strict';

  var TAG = '[CineJoyExtractor]';
  var API_BASE = 'https://api.shegu.st';
  var SUBS_BASE = 'https://subtitles.shegu.st';
  var BOQ_URL = 'https://cinejoy.to/_app/immutable/chunks/BOqDcafn.js';
  var SERVER_PUB_B64 = 'BDneWBpzICIVPCtCd8JbpLNxmJiqhCWJaEHar4kp7Yivrp3ZpGS6Rv1rCvDuFrmhnWxUviPpnJhcUJPE-P9Simk';

  var SERVERS = ['Lisbon', 'Solara', 'Athens', 'Joy', 'Castle'];
  var TIMEOUT_MS = 15000;

  var H_HEADERS = {
    'Content-Type': 'application/octet-stream',
    'Accept': '*/*',
    'Origin': 'https://cinejoy.to',
    'Referer': 'https://cinejoy.to/',
    'User-Agent': 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Mobile Safari/537.36',
    'sec-fetch-site': 'cross-site',
    'sec-fetch-mode': 'cors',
    'sec-fetch-dest': 'empty',
  };

  var G_HEADERS = {
    'Content-Type': 'application/json',
    'Accept': '*/*',
    'Origin': 'https://cinejoy.to',
    'Referer': 'https://cinejoy.to/',
    'User-Agent': 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Mobile Safari/537.36',
    'sec-fetch-site': 'cross-site',
    'sec-fetch-mode': 'cors',
    'sec-fetch-dest': 'empty',
  };

  // ─── Environment ─────────────────────────────────────────────────────────────
  var IS_NODE = typeof process !== 'undefined' && process.versions && !!process.versions.node;

  // ─── Helpers ─────────────────────────────────────────────────────────────────
  function u8ToB64url(arr) {
    var bin = '';
    for (var i = 0; i < arr.length; i++) bin += String.fromCharCode(arr[i]);
    var b64 = typeof btoa !== 'undefined' ? btoa(bin) : Buffer.from(bin, 'binary').toString('base64');
    return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
  }

  function buildFingerprint() {
    var tz = 'UTC';
    try { if (typeof Intl !== 'undefined' && Intl.DateTimeFormat) tz = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'; } catch (e) {}
    var lang = 'en';
    try { if (typeof navigator !== 'undefined' && navigator.language) lang = navigator.language.split('-')[0]; } catch (e) {}
    var hc = 4;
    try { if (typeof navigator !== 'undefined' && navigator.hardwareConcurrency) hc = navigator.hardwareConcurrency; } catch (e) {}
    var cr = typeof crypto !== 'undefined' && crypto.getRandomValues ? crypto : (typeof window !== 'undefined' && window.crypto ? window.crypto : null);
    var rnd = new Uint8Array(16);
    if (cr) cr.getRandomValues(rnd);
    return {
      tz: tz, lang: lang, langs: '', pf: 'na', hc: hc, dm: 0,
      dpr: (typeof window !== 'undefined' && window.devicePixelRatio) ? window.devicePixelRatio : 2,
      sw: (typeof window !== 'undefined' && window.screen) ? (window.screen.width || 390) : 390,
      sh: (typeof window !== 'undefined' && window.screen) ? (window.screen.height || 844) : 844,
      cd: (typeof window !== 'undefined' && window.screen) ? (window.screen.colorDepth || 24) : 24,
      tp: (typeof navigator !== 'undefined' && navigator.maxTouchPoints) ? navigator.maxTouchPoints : 5,
      cvs: 'na', wgl: 'na', jit: '32,38,54,48,47',
    };
  }

  // ─── BOqDcafn sandbox loader ──────────────────────────────────────────────────
  var _boqPromise = null;

  function loadBoqNode() {
    var vm = require('vm');
    var https = require('https');
    var nodeCrypto = require('crypto');
    var webcrypto = nodeCrypto.webcrypto;
    var noop = function () {};

    return new Promise(function (resolve, reject) {
      https.get(BOQ_URL, { headers: { 'User-Agent': 'Mozilla/5.0' } }, function (res) {
        var chunks = [];
        res.on('data', function (d) { chunks.push(d); });
        res.on('end', function () {
          try {
            var code = Buffer.concat(chunks).toString();
            var clean = code
              .replace(/import\{[^}]*\}from["'][^"']+["'];?/g, '')
              .replace(/export\{[^}]*\};?/g, '');

            var nativeAtob = function (s) { return Buffer.from(s, 'base64').toString('binary'); };
            var nativeBtoa = function (s) { return Buffer.from(s, 'binary').toString('base64'); };
            var fp = buildFingerprint();

            var sb = vm.createContext({
              console: console,
              Object: Object, Array: Array, parseInt: parseInt, parseFloat: parseFloat,
              String: String, Number: Number, Boolean: Boolean, Math: Math, JSON: JSON, Date: Date,
              decodeURIComponent: decodeURIComponent, encodeURIComponent: encodeURIComponent,
              atob: nativeAtob, btoa: nativeBtoa,
              TextEncoder: TextEncoder, TextDecoder: TextDecoder,
              Uint8Array: Uint8Array, ArrayBuffer: ArrayBuffer, DataView: DataView,
              Int8Array: Int8Array, Uint16Array: Uint16Array, Int32Array: Int32Array,
              Uint32Array: Uint32Array, Float32Array: Float32Array, Float64Array: Float64Array,
              Uint8ClampedArray: Uint8ClampedArray,
              crypto: webcrypto, Promise: Promise, Map: Map, Set: Set, WeakMap: WeakMap,
              RegExp: RegExp, Error: Error, TypeError: TypeError, Symbol: Symbol,
              Proxy: Proxy, Reflect: Reflect, isNaN: isNaN, isFinite: isFinite,
              NaN: NaN, Infinity: Infinity, Intl: typeof Intl !== 'undefined' ? Intl : null,
              URL: URL, URLSearchParams: URLSearchParams, Buffer: Buffer, require: require,
              setTimeout: noop, setInterval: noop, clearTimeout: noop, clearInterval: noop,
              fetch: function () { return Promise.resolve({ ok: false, status: 404, json: function () { return Promise.resolve({}); }, text: function () { return Promise.resolve(''); } }); },
              window: { location: { href: 'https://cinejoy.to/', hostname: 'cinejoy.to' }, navigator: { userAgent: '' }, addEventListener: noop },
              document: { querySelector: function () { return null; }, querySelectorAll: function () { return []; }, createElement: function () { return { style: {}, classList: { add: noop } }; }, cookie: '', currentScript: null, addEventListener: noop },
              navigator: { userAgent: 'Mozilla/5.0', language: fp.lang, hardwareConcurrency: fp.hc },
              location: { href: 'https://cinejoy.to/', hostname: 'cinejoy.to', origin: 'https://cinejoy.to', pathname: '/' },
              history: { pushState: noop, replaceState: noop, state: null },
              performance: { now: function () { return Date.now(); }, mark: noop, measure: noop },
              customElements: { define: noop, get: function () { return null; } },
              HTMLElement: function () {}, Event: function (t) { this.type = t; },
              requestAnimationFrame: noop, cancelAnimationFrame: noop,
              addEventListener: noop, removeEventListener: noop, dispatchEvent: noop,
              MutationObserver: function () { this.observe = noop; this.disconnect = noop; },
              AbortController: function () { this.signal = { aborted: false, addEventListener: noop }; this.abort = noop; },
              AbortSignal: { timeout: function () { return { aborted: false, addEventListener: noop }; } },
              structuredClone: function (x) { return JSON.parse(JSON.stringify(x)); },
              self: null, globalThis: null,
            });
            sb.self = sb;
            sb.globalThis = sb;

            new vm.Script(clean).runInContext(sb);

            var v0 = vm.runInContext('v0', sb);
            var V = vm.runInContext('V', sb);
            var Sx = vm.runInContext('Sx', sb);
            var Cx = vm.runInContext('Cx', sb);
            var ux = vm.runInContext('ux', sb);
            var mx = vm.runInContext('mx', sb);
            var serverPub = V(v0);

            resolve({
              Sx: function () { return Sx(serverPub); },
              Cx: function (sxResult, serverBytes) { return Cx(sxResult, serverBytes); },
              ux: function (session, seq, payload) { return ux(session, seq, payload); },
              mx: function (session, msg) { return mx(session, msg); },
            });
          } catch (e) {
            reject(e);
          }
        });
      }).on('error', reject);
    });
  }

  function loadBoqEval() {
    var noop = function () {};
    var fakeFetch = function () { return Promise.resolve({ ok: false, status: 404, json: function () { return Promise.resolve({}); }, text: function () { return Promise.resolve(''); } }); };
    var fp = buildFingerprint();

    // Provide ALL globals that BOqDcafn.js may reference as class base classes or constructors
    var HTMLElementShim = function HTMLElement() {};
    var EventShim = function Event(t) { this.type = t; };

    // Gather real globals where available
    var realCrypto = (typeof crypto !== 'undefined' && crypto.subtle) ? crypto
      : (typeof window !== 'undefined' && window.crypto && window.crypto.subtle) ? window.crypto
      : null;
    var realAtob = typeof atob === 'function' ? atob : function (s) { return null; };
    var realBtoa = typeof btoa === 'function' ? btoa : function (s) { return null; };
    var realTextEncoder = typeof TextEncoder !== 'undefined' ? TextEncoder : null;
    var realTextDecoder = typeof TextDecoder !== 'undefined' ? TextDecoder : null;
    var realURL = typeof URL !== 'undefined' ? URL : null;
    var realURLSearchParams = typeof URLSearchParams !== 'undefined' ? URLSearchParams : null;
    var realPromise = Promise;
    var realIntl = typeof Intl !== 'undefined' ? Intl : null;

    return fetch(BOQ_URL, { headers: { 'User-Agent': 'Mozilla/5.0', 'Accept': '*/*' } })
      .then(function (r) { return r.text(); })
      .then(function (code) {
        var clean = code
          .replace(/import\{[^}]*\}from["'][^"']+["'];?/g, '')
          .replace(/export\{[^}]*\};?/g, '');

        var exps = {};
        // eslint-disable-next-line no-new-func
        var fn = new Function(
          'exports', 'globalThis', 'self', 'window', 'document', 'navigator', 'location',
          'history', 'performance', 'customElements', 'HTMLElement', 'Event',
          'MutationObserver', 'AbortController', 'AbortSignal',
          'crypto', 'atob', 'btoa', 'TextEncoder', 'TextDecoder',
          'fetch', 'URL', 'URLSearchParams', 'Promise', 'Intl',
          'setTimeout', 'setInterval', 'clearTimeout', 'clearInterval',
          'requestAnimationFrame', 'cancelAnimationFrame',
          'addEventListener', 'removeEventListener', 'dispatchEvent', 'structuredClone',
          '"use strict";\n' + clean + '\n' +
          'exports.Sx=Sx;exports.Cx=Cx;exports.ux=ux;exports.mx=mx;exports.v0=v0;exports.V=V;'
        );

        var globalSelf = { crypto: realCrypto, atob: realAtob, btoa: realBtoa };

        fn(
          exps,
          globalSelf, globalSelf,
          { location: { href: 'https://cinejoy.to/' }, navigator: { userAgent: '' }, addEventListener: noop },
          { querySelector: function () { return null; }, querySelectorAll: function () { return []; }, createElement: function () { return { style: {}, classList: { add: noop } }; }, cookie: '', currentScript: null, addEventListener: noop },
          { userAgent: 'Mozilla/5.0', language: fp.lang, hardwareConcurrency: fp.hc, maxTouchPoints: fp.tp },
          { href: 'https://cinejoy.to/', hostname: 'cinejoy.to', origin: 'https://cinejoy.to', pathname: '/' },
          { pushState: noop, replaceState: noop, state: null },
          { now: function () { return Date.now(); }, mark: noop, measure: noop },
          { define: noop, get: function () { return null; } },
          HTMLElementShim, EventShim,
          function () { this.observe = noop; this.disconnect = noop; }, // MutationObserver
          function () { this.signal = { aborted: false, addEventListener: noop }; this.abort = noop; }, // AbortController
          { timeout: function () { return { aborted: false, addEventListener: noop }; } }, // AbortSignal
          realCrypto, realAtob, realBtoa, realTextEncoder, realTextDecoder,
          fakeFetch, realURL, realURLSearchParams, realPromise, realIntl,
          noop, noop, noop, noop, noop, noop, noop, noop,
          function (x) { return JSON.parse(JSON.stringify(x)); }
        );

        var serverPub = exps.V(exps.v0);
        return {
          Sx: function () { return exps.Sx(serverPub); },
          Cx: function (sx, serverBytes) { return exps.Cx(sx, serverBytes); },
          ux: function (session, seq, payload) { return exps.ux(session, seq, payload); },
          mx: function (session, msg) { return exps.mx(session, msg); },
        };
      });
  }

  function loadBoq() {
    if (_boqPromise) return _boqPromise;
    _boqPromise = (IS_NODE ? loadBoqNode() : loadBoqEval()).catch(function (e) {
      _boqPromise = null;
      throw e;
    });
    return _boqPromise;
  }

  // ─── Session management ───────────────────────────────────────────────────────
  var _boq = null;
  var _session = null;
  var _sessionPromise = null;

  function resetSession() {
    _session = null;
    _sessionPromise = null;
  }

  // ─── HTTP helpers ─────────────────────────────────────────────────────────────
  // Binary POST: use https.request in Node.js (undici/fetch strips sec-fetch-* headers)
  function binaryPost(url, body, headers) {
    if (IS_NODE) {
      return new Promise(function (resolve, reject) {
        var https = require('https');
        var parsed = new URL(url);
        var buf = Buffer.isBuffer(body) ? body : Buffer.from(body);
        var req = https.request({
          hostname: parsed.hostname, port: parseInt(parsed.port) || 443,
          path: parsed.pathname + (parsed.search || ''), method: 'POST',
          headers: Object.assign({}, headers, { 'Content-Length': buf.length }),
        }, function (res) {
          var chunks = [];
          res.on('data', function (d) { chunks.push(d); });
          res.on('end', function () {
            var rb = Buffer.concat(chunks);
            resolve({
              ok: res.statusCode === 200, status: res.statusCode,
              arrayBuffer: function () { return Promise.resolve(rb.buffer.slice(rb.byteOffset, rb.byteOffset + rb.byteLength)); },
              json: function () { return Promise.resolve(JSON.parse(rb.toString())); },
            });
          });
        });
        req.setTimeout(TIMEOUT_MS, function () { req.destroy(); reject(new Error('timeout')); });
        req.on('error', reject);
        req.write(buf);
        req.end();
      });
    }
    return fetch(url, { method: 'POST', headers: headers, body: body });
  }

  function fetchJson(url, opts) {
    return new Promise(function (resolve, reject) {
      var timer = setTimeout(function () { reject(new Error('timeout')); }, TIMEOUT_MS);
      fetch(url, opts || {}).then(function (r) {
        clearTimeout(timer);
        return r.json();
      }).then(resolve).catch(function (e) { clearTimeout(timer); reject(e); });
    });
  }

  function getSession() {
    if (_session) return Promise.resolve(_session);
    if (_sessionPromise) return _sessionPromise;

    _sessionPromise = loadBoq().then(function (boq) {
      _boq = boq;
      return boq.Sx();
    }).then(function (sx) {
      console.log(TAG, 'Sx wire:', sx.wire.length, 'bytes');
      return binaryPost(API_BASE + '/h', sx.wire, H_HEADERS).then(function (resp) {
        if (!resp.ok) throw new Error(TAG + ' /h failed: ' + resp.status);
        return resp.arrayBuffer().then(function (ab) {
          var serverBytes = new Uint8Array(ab);
          console.log(TAG, '/h response:', serverBytes.length, 'bytes');
          return _boq.Cx(sx, serverBytes);
        });
      }).then(function (session) {
        console.log(TAG, 'Session ready. path:', session.schema.path);
        _session = session;
        return session;
      });
    }).catch(function (e) {
      _sessionPromise = null;
      throw e;
    });

    return _sessionPromise;
  }

  function sessionRequest(route, payload) {
    var capturedSession;
    return getSession().then(function (session) {
      capturedSession = session;
      capturedSession.seq = (capturedSession.seq || 0) + 1;
      var seq = capturedSession.seq;
      return _boq.ux(capturedSession, seq, { path: route, payload: payload });
    }).then(function (msg) {
      var gPath = '/g/' + capturedSession.schema.path;
      return binaryPost(API_BASE + gPath, Buffer.from ? Buffer.from(JSON.stringify(msg)) : JSON.stringify(msg), G_HEADERS)
        .then(function (r) {
          return r.json().then(function (data) { return { ok: r.ok, status: r.status, data: data }; });
        });
    }).then(function (resp) {
      if (!resp.ok) {
        resetSession();
        throw new Error(TAG + ' /g/ failed: ' + resp.status);
      }
      return _boq.mx(capturedSession, resp.data);
    });
  }

  // ─── Subtitles ────────────────────────────────────────────────────────────────
  function fetchSubtitles(tmdbId, isTv, season, episode) {
    var type = isTv ? 'tv' : 'movie';
    var url = SUBS_BASE + '/subtitles?type=' + type + '&tmdb=' + tmdbId;
    if (isTv && season != null && episode != null) url += '&season=' + season + '&episode=' + episode;
    return fetchJson(url, { headers: { 'Accept': 'application/json', 'Origin': 'https://cinejoy.to', 'Referer': 'https://cinejoy.to/', 'User-Agent': 'Mozilla/5.0' } })
      .then(function (data) {
        return (data.subtitles || []).map(function (s) {
          return { url: s.url, language: s.language, type: s.type || 'srt', label: s.display || s.language };
        });
      }).catch(function () { return []; });
  }

  // ─── Server extraction ────────────────────────────────────────────────────────
  function tryServer(serverName, tmdbId, isTv, season, episode) {
    var contentType = isTv ? 'tv' : 'movie';
    var route = '/' + serverName + '/' + contentType;
    var payload = { tmdb: tmdbId };
    if (isTv && season != null && episode != null) {
      payload.season = season;
      payload.episode = episode;
    }
    console.log(TAG, 'Trying server:', serverName);
    return sessionRequest(route, payload).then(function (result) {
      if (!result || result.status !== 200 || !result.data) return null;
      var streams = result.data.stream || result.data.sources || result.data.links || [];
      if (!streams.length) return null;
      var best = null;
      for (var i = 0; i < streams.length; i++) {
        if (streams[i].type === 'hls' || (streams[i].playlist && streams[i].playlist.indexOf('.m3u8') !== -1)) {
          best = streams[i]; break;
        }
      }
      best = best || streams[0];
      var url = best.playlist || best.url || best.src;
      if (!url) return null;
      var captions = (best.captions || []).map(function (c) {
        return { url: c.url || c.src, language: c.language || c.lang, type: 'vtt', label: c.label || c.language };
      });
      return { stream: url, captions: captions, server: serverName };
    }).catch(function (e) {
      console.warn(TAG, serverName, 'error:', e.message);
      if (e.message && (e.message.indexOf('decrypt') !== -1 || e.message.indexOf('/g/') !== -1)) resetSession();
      return null;
    });
  }

  // ─── Main extract ─────────────────────────────────────────────────────────────
  function extractAsync(params) {
    var tmdbId = params.tmdbId || params.tmdb || params.id;
    var isTv = params.isTv || params.type === 'tv' || params.type === 2;
    var season = params.season;
    var episode = params.episode;
    console.log(TAG, 'Extracting tmdb:', tmdbId, isTv ? '(TV s' + season + 'e' + episode + ')' : '(Movie)');
    var idx = 0;
    function tryNext() {
      if (idx >= SERVERS.length) return Promise.reject(new Error(TAG + ' All servers failed for tmdb:' + tmdbId));
      var server = SERVERS[idx++];
      return tryServer(server, tmdbId, isTv, season, episode).then(function (result) {
        if (result) {
          return fetchSubtitles(tmdbId, isTv, season, episode).then(function (subs) {
            return { stream: result.stream, subtitles: (result.captions || []).concat(subs), server: result.server, type: 'hls' };
          });
        }
        return tryNext();
      });
    }
    return tryNext();
  }

  // Dual API: returns Promise AND calls callback (supports both MultiExtractor styles)
  function extract(params, callback) {
    var promise = extractAsync(params);
    if (typeof callback === 'function') {
      promise.then(function (r) { callback(null, r); }).catch(function (e) { callback(e, null); });
    }
    return promise;
  }

  // ─── Export ───────────────────────────────────────────────────────────────────
  var extractor = {
    name: 'CineJoy',
    version: '3.2.1',
    description: 'CineJoy lumen-gate-v1 sandbox — BOqDcafn.js (fixed RN compat + Promise API)',
    extract: extract,
    fetchSubtitles: fetchSubtitles,
    resetSession: resetSession,
  };

  if (typeof module !== 'undefined' && module.exports) { module.exports = extractor; }
  if (typeof window !== 'undefined') { window.CineJoyExtractor = extractor; }
  if (typeof registerExtractor === 'function') { registerExtractor('cinejoy', extractor); }
})();
