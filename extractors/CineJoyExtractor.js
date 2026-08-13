/**
 * CineJoyExtractor — self-contained CommonJS JS for remote hot-update.
 * Hosted at: HaileyesusG/MasterStream-Extractors/extractors/CineJoyExtractor.js
 * Works out-of-the-box on Mobile App (React Native) and Native TV App (Android WebView).
 * Noble scrypt bundle target: ES6 + no template literals (Hermes compatible).
 *
 * Protocol: lumen-gate-v1 (fully reversed from cinejoy.to BOqDcafn.js)
 *   Base URL: https://api.shegu.st  (j = u(311,"2ZD)") from BOqDcafn.js)
 *   Handshake: POST /h  (binary ECDH wire, ~304 bytes, application/octet-stream)
 *   Session:   POST /g/{schema.path}  (AES-GCM JSON, application/json)
 *   Subtitles: GET  https://subtitles.shegu.st/subtitles?type=movie|tv&tmdb={id}
 *
 * Key insight: instead of re-implementing the full Sx/Cx/kx/ux/mx chain
 * (which includes |pipeline, |schema, |drbg HKDF derivations and schema obfuscation),
 * we load and sandbox cinejoy.to's own BOqDcafn.js to use its native implementation.
 *
 * Verified working: 2026-08-14
 *   Obsession (2026) tmdb=1339713 → https://info.movieboxnoob.cc/playlist/ZgRENwVpICUbvjgdTAAjvA.m3u8
 */
(function () {
  'use strict';

  var TAG = '[CineJoyExtractor]';
  var API_BASE = 'https://api.shegu.st';
  var SUBS_BASE = 'https://subtitles.shegu.st';
  var BOQ_URL = 'https://cinejoy.to/_app/immutable/chunks/BOqDcafn.js';

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

  var SUBS_HEADERS = {
    'Accept': 'application/json',
    'Origin': 'https://cinejoy.to',
    'Referer': 'https://cinejoy.to/',
    'User-Agent': 'Mozilla/5.0',
  };

  // ──────────────────────────────────────────────────────────────────
  // ENVIRONMENT DETECTION
  // ──────────────────────────────────────────────────────────────────

  var IS_NODE = typeof process !== 'undefined' && process.versions && process.versions.node;
  var IS_RN = typeof global !== 'undefined' && typeof global.__fbBatchedBridge !== 'undefined';

  // ──────────────────────────────────────────────────────────────────
  // HTTP HELPERS
  // ──────────────────────────────────────────────────────────────────

  /**
   * Binary POST - uses https.request in Node.js (to bypass undici sec-* stripping),
   * falls back to fetch() in React Native / WebView.
   */
  function binaryPost(url, body, headers) {
    if (IS_NODE) {
      return new Promise(function (resolve, reject) {
        var https = require('https');
        var parsed = new URL(url);
        var buf = Buffer.isBuffer(body) ? body : Buffer.from(body);
        var req = https.request({
          hostname: parsed.hostname,
          port: parseInt(parsed.port) || 443,
          path: parsed.pathname + (parsed.search || ''),
          method: 'POST',
          headers: Object.assign({}, headers, { 'Content-Length': buf.length }),
        }, function (res) {
          var chunks = [];
          res.on('data', function (d) { chunks.push(d); });
          res.on('end', function () {
            var rb = Buffer.concat(chunks);
            resolve({
              ok: res.statusCode === 200,
              status: res.statusCode,
              arrayBuffer: function () { return Promise.resolve(rb.buffer.slice(rb.byteOffset, rb.byteOffset + rb.byteLength)); },
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

  /**
   * JSON POST - uses fetch() everywhere (JSON bodies don't trigger the sec-* stripping issue).
   */
  function jsonPost(url, obj, headers) {
    var body = JSON.stringify(obj);
    return fetch(url, { method: 'POST', headers: headers, body: body }).then(function (r) {
      return r.json().then(function (data) { return { ok: r.ok, status: r.status, data: data }; });
    });
  }

  /**
   * Fetch text/JSON with a timeout.
   */
  function fetchJson(url, opts) {
    return new Promise(function (resolve, reject) {
      var timer = setTimeout(function () { reject(new Error('timeout')); }, TIMEOUT_MS);
      fetch(url, opts || {}).then(function (r) {
        clearTimeout(timer);
        return r.json();
      }).then(resolve).catch(function (e) { clearTimeout(timer); reject(e); });
    });
  }

  // ──────────────────────────────────────────────────────────────────
  // BOqDcafn.js LOADER — lazy loads and sandboxes CineJoy's crypto code
  // ──────────────────────────────────────────────────────────────────

  var _boqPromise = null;

  /**
   * Returns a promise that resolves to the BOqDcafn.js sandbox with Sx/Cx/ux/mx available.
   */
  function loadBoq() {
    if (_boqPromise) return _boqPromise;

    _boqPromise = (function () {
      // Detect sandbox execution capability (Node.js vm module)
      if (IS_NODE) {
        return loadBoqNode();
      }
      // React Native / WebView: use eval-based sandboxing
      return loadBoqEval();
    })().catch(function (e) {
      _boqPromise = null;
      throw e;
    });

    return _boqPromise;
  }

  /** Node.js: use vm.createContext for isolated execution */
  function loadBoqNode() {
    var vm = require('vm');
    var https = require('https');

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

            var noop = function () {};
            var getCrypto = function () {
              if (typeof global !== 'undefined' && global.crypto) return global.crypto;
              return require('crypto').webcrypto;
            };
            var cryptoObj = getCrypto();

            var sb = vm.createContext({
              console: console,
              Object: Object, Array: Array, parseInt: parseInt, parseFloat: parseFloat,
              String: String, Number: Number, Boolean: Boolean,
              decodeURIComponent: decodeURIComponent, encodeURIComponent: encodeURIComponent,
              atob: function (s) { return Buffer.from(s, 'base64').toString('binary'); },
              btoa: function (s) { return Buffer.from(s, 'binary').toString('base64'); },
              TextEncoder: TextEncoder, TextDecoder: TextDecoder,
              Uint8Array: Uint8Array, ArrayBuffer: ArrayBuffer, DataView: DataView,
              Int8Array: Int8Array, Uint16Array: Uint16Array, Int32Array: Int32Array,
              Uint32Array: Uint32Array, Float32Array: Float32Array, Float64Array: Float64Array,
              Uint8ClampedArray: Uint8ClampedArray,
              crypto: cryptoObj,
              Promise: Promise, Map: Map, Set: Set, WeakMap: WeakMap,
              RegExp: RegExp, Math: Math, JSON: JSON, Date: Date,
              Error: Error, TypeError: TypeError, Symbol: Symbol, Proxy: Proxy, Reflect: Reflect,
              setTimeout: noop, setInterval: noop, clearTimeout: noop,
              fetch: function () { return Promise.resolve({ ok: false, status: 404, json: function () { return Promise.resolve({}); }, text: function () { return Promise.resolve(''); } }); },
              URL: URL, URLSearchParams: URLSearchParams, Buffer: Buffer,
              isNaN: isNaN, isFinite: isFinite, NaN: NaN, Infinity: Infinity,
              Intl: global.Intl || Intl,
              window: { location: { href: 'https://cinejoy.to/' }, navigator: { userAgent: '' }, addEventListener: noop },
              document: { querySelector: function () { return null; }, querySelectorAll: function () { return []; }, createElement: function () { return { style: {}, classList: { add: noop } }; }, cookie: '', currentScript: null, addEventListener: noop },
              navigator: { userAgent: 'Mozilla/5.0', language: 'en', hardwareConcurrency: 4 },
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
              require: require,
            });
            sb.self = sb;
            sb.globalThis = sb;

            new vm.Script(clean).runInContext(sb);

            // Expose the session API
            resolve({
              Sx: function () { return vm.runInContext('Sx(V(v0))', sb); },
              Cx: function (sx, serverBytes) {
                sb._sx = sx;
                sb._serverBytes = serverBytes;
                return vm.runInContext('Cx(_sx, _serverBytes)', sb);
              },
              ux: function (session, seq, payload) {
                sb._session = session;
                sb._seq = seq;
                sb._payload = payload;
                return vm.runInContext('ux(_session, _seq, _payload)', sb);
              },
              mx: function (session, msg) {
                sb._session = session;
                sb._msg = msg;
                return vm.runInContext('mx(_session, _msg)', sb);
              },
            });
          } catch (e) {
            reject(e);
          }
        });
        res.on('error', reject);
      }).on('error', reject);
    });
  }

  /** React Native / WebView: use Function constructor for sandbox */
  function loadBoqEval() {
    return fetch(BOQ_URL, { headers: { 'User-Agent': 'Mozilla/5.0' } })
      .then(function (r) { return r.text(); })
      .then(function (code) {
        var clean = code
          .replace(/import\{[^}]*\}from["'][^"']+["'];?/g, '')
          .replace(/export\{[^}]*\};?/g, '');

        // Create a sandboxed scope with the required globals
        var exports = {};
        /* eslint-disable no-new-func */
        var fn = new Function(
          'exports', 'atob', 'btoa', 'crypto', 'fetch', 'location', 'navigator', 'window',
          '"use strict";\n' + clean + '\n' +
          'exports.Sx=function(){return Sx(V(v0));};' +
          'exports.Cx=Cx;exports.ux=ux;exports.mx=mx;'
        );
        /* eslint-enable no-new-func */
        fn(
          exports,
          typeof atob !== 'undefined' ? atob : function (s) { return Buffer.from(s, 'base64').toString('binary'); },
          typeof btoa !== 'undefined' ? btoa : function (s) { return Buffer.from(s, 'binary').toString('base64'); },
          typeof crypto !== 'undefined' ? crypto : (typeof window !== 'undefined' ? window.crypto : null),
          function () { return Promise.resolve({ ok: false, status: 404, json: function () { return Promise.resolve({}); } }); },
          { href: 'https://cinejoy.to/', hostname: 'cinejoy.to', origin: 'https://cinejoy.to', pathname: '/' },
          { userAgent: 'Mozilla/5.0', language: 'en', hardwareConcurrency: 4 },
          { location: { href: 'https://cinejoy.to/' }, navigator: { userAgent: '' }, addEventListener: function () {} }
        );

        return {
          Sx: function () { return exports.Sx(); },
          Cx: function (sx, serverBytes) { return exports.Cx(sx, serverBytes); },
          ux: function (session, seq, payload) { return exports.ux(session, seq, payload); },
          mx: function (session, msg) { return exports.mx(session, msg); },
        };
      });
  }

  // ──────────────────────────────────────────────────────────────────
  // SESSION MANAGEMENT
  // ──────────────────────────────────────────────────────────────────

  var _session = null;
  var _sessionPromise = null;
  var _boq = null;

  function resetSession() {
    _session = null;
    _sessionPromise = null;
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

  // ──────────────────────────────────────────────────────────────────
  // REQUEST: Send encrypted message to server
  // ──────────────────────────────────────────────────────────────────

  function sessionRequest(route, payload) {
    return getSession().then(function (session) {
      session.seq = (session.seq || 0) + 1;
      var seq = session.seq;
      return _boq.ux(session, seq, { path: route, payload: payload || null });
    }).then(function (msg) {
      return getSession().then(function (session) {
        var gPath = '/g/' + session.schema.path;
        return jsonPost(API_BASE + gPath, msg, G_HEADERS).then(function (resp) {
          if (!resp.ok) {
            resetSession();
            throw new Error(TAG + ' /g/ failed: ' + resp.status);
          }
          return _boq.mx(session, resp.data);
        });
      });
    });
  }

  // ──────────────────────────────────────────────────────────────────
  // SUBTITLES (no auth required)
  // ──────────────────────────────────────────────────────────────────

  function fetchSubtitles(tmdbId, isTv, season, episode) {
    var type = isTv ? 'tv' : 'movie';
    var url = SUBS_BASE + '/subtitles?type=' + type + '&tmdb=' + tmdbId;
    if (isTv && season != null && episode != null) {
      url += '&season=' + season + '&episode=' + episode;
    }
    return fetchJson(url, { headers: SUBS_HEADERS }).then(function (data) {
      return (data.subtitles || []).map(function (s) {
        return { url: s.url, language: s.language, type: s.type || 'srt', label: s.display || s.language };
      });
    }).catch(function (e) {
      console.warn(TAG, 'subtitles error:', e.message);
      return [];
    });
  }

  // ──────────────────────────────────────────────────────────────────
  // SERVER EXTRACTION
  // ──────────────────────────────────────────────────────────────────

  function tryServer(serverName, tmdbId, isTv, season, episode) {
    var contentType = isTv ? 'tv' : 'movie';
    var route = '/' + serverName + '/' + contentType;
    var payload = { tmdb: tmdbId };
    if (isTv && season != null && episode != null) {
      payload.season = season;
      payload.episode = episode;
    }

    return sessionRequest(route, payload).then(function (result) {
      // result: {data: {stream: [{type, id, playlist, captions}]}, status: 200}
      if (!result || result.status !== 200 || !result.data) return null;

      var streams = result.data.stream || result.data.sources || result.data.links || [];
      if (!streams.length) return null;

      var hlsStream = null;
      for (var i = 0; i < streams.length; i++) {
        if (streams[i].type === 'hls' || (streams[i].playlist && streams[i].playlist.indexOf('.m3u8') !== -1)) {
          hlsStream = streams[i];
          break;
        }
      }
      var bestStream = hlsStream || streams[0];
      var m3u8Url = bestStream.playlist || bestStream.url || bestStream.src;
      if (!m3u8Url) return null;

      var captions = (bestStream.captions || []).map(function (c) {
        return { url: c.url || c.src, language: c.language || c.lang, type: 'vtt', label: c.label || c.language };
      });

      return { stream: m3u8Url, captions: captions, server: serverName };
    }).catch(function (e) {
      console.warn(TAG, serverName, 'error:', e.message);
      if (e.message && (e.message.indexOf('decrypt') !== -1 || e.message.indexOf('session') !== -1 || e.message.indexOf('/g/') !== -1)) {
        resetSession();
      }
      return null;
    });
  }

  // ──────────────────────────────────────────────────────────────────
  // MAIN EXTRACT
  // ──────────────────────────────────────────────────────────────────

  function extractAsync(params) {
    var tmdbId = params.tmdbId || params.id;
    var isTv = params.isTv || params.type === 'tv' || params.type === 2;
    var season = params.season;
    var episode = params.episode;

    console.log(TAG, 'Extracting tmdb:', tmdbId, isTv ? '(TV s' + season + 'e' + episode + ')' : '(Movie)');

    var idx = 0;

    function tryNext() {
      if (idx >= SERVERS.length) {
        return Promise.reject(new Error(TAG + ' All servers failed for tmdb:' + tmdbId));
      }
      var server = SERVERS[idx++];
      console.log(TAG, 'Trying server:', server);
      return tryServer(server, tmdbId, isTv, season, episode).then(function (result) {
        if (result) {
          return fetchSubtitles(tmdbId, isTv, season, episode).then(function (subs) {
            return {
              stream: result.stream,
              subtitles: (result.captions || []).concat(subs),
              server: result.server,
              type: 'hls',
            };
          });
        }
        return tryNext();
      });
    }

    return tryNext();
  }

  function extract(params, callback) {
    extractAsync(params).then(function (result) {
      callback(null, result);
    }).catch(function (e) {
      callback(e, null);
    });
  }

  // ──────────────────────────────────────────────────────────────────
  // MODULE EXPORT / REGISTRATION
  // ──────────────────────────────────────────────────────────────────

  var extractor = {
    name: 'CineJoy',
    version: '3.1.0',
    description: 'CineJoy extractor using lumen-gate-v1 Rx session protocol (BOqDcafn.js sandbox)',
    extract: extract,
    fetchSubtitles: fetchSubtitles,
    resetSession: resetSession,
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = extractor;
  }
  if (typeof window !== 'undefined') {
    window.CineJoyExtractor = extractor;
  }
  if (typeof registerExtractor === 'function') {
    registerExtractor('cinejoy', extractor);
  }
})();
