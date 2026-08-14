/**
 * CineJoyExtractor v3.4.0 — self-contained CommonJS for remote hot-update.
 *
 * Strategy: Use cinejoy.to's own BOqDcafn.js bundle for the lumen-gate-v1
 * session protocol. Uses native Ax() master extractor for automatic server
 * negotiation (Lisbon, Solara, Athens, Joy, Castle, Sakura, Canaias) and stream
 * discovery with fallback to manual server iterate.
 *
 * Compatible with React Native (Hermes) and Node.js.
 */
(function () {
  'use strict';

  var TAG = '[CineJoyExtractor]';
  var BOQ_URL = 'https://cinejoy.to/_app/immutable/chunks/BOqDcafn.js';
  var SUBS_BASE = 'https://subtitles.shegu.st';
  var SERVERS = ['Lisbon', 'Solara', 'Athens', 'Joy', 'Castle'];
  var TIMEOUT_MS = 15000;

  var IS_NODE = typeof process !== 'undefined' && process.versions && !!process.versions.node;

  // ─── Fingerprint helper ──────────────────────────────────────────────────────
  function buildFingerprint() {
    var tz = 'UTC';
    try { if (typeof Intl !== 'undefined' && Intl.DateTimeFormat) tz = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'; } catch (e) {}
    var lang = 'en';
    try { if (typeof navigator !== 'undefined' && navigator.language) lang = navigator.language.split('-')[0]; } catch (e) {}
    var hc = 4;
    try { if (typeof navigator !== 'undefined' && navigator.hardwareConcurrency) hc = navigator.hardwareConcurrency; } catch (e) {}
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

  // ─── Pure JS Base64 (Hermes safe) ────────────────────────────────────────────
  var B64_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  function pureAtob(s) {
    if (!s) return '';
    s = String(s).replace(/-/g, '+').replace(/_/g, '/').replace(/[^A-Za-z0-9+/]/g, '');
    var out = '', i = 0;
    while (i < s.length) {
      var c0 = B64_CHARS.indexOf(s[i++]), c1 = B64_CHARS.indexOf(s[i++]);
      var c2 = i <= s.length ? B64_CHARS.indexOf(s[i++]) : 64;
      var c3 = i <= s.length ? B64_CHARS.indexOf(s[i++]) : 64;
      if (c1 >= 0) out += String.fromCharCode((c0 << 2) | (c1 >> 4));
      if (c2 >= 0 && c2 < 64) out += String.fromCharCode(((c1 & 0xf) << 4) | (c2 >> 2));
      if (c3 >= 0 && c3 < 64) out += String.fromCharCode(((c2 & 0x3) << 6) | c3);
    }
    return out;
  }

  function pureBtoa(s) {
    if (!s) return '';
    s = String(s);
    var out = '';
    for (var i = 0; i < s.length; i += 3) {
      var b0 = s.charCodeAt(i) & 0xff;
      var b1 = i + 1 < s.length ? s.charCodeAt(i + 1) & 0xff : 0;
      var b2 = i + 2 < s.length ? s.charCodeAt(i + 2) & 0xff : 0;
      out += B64_CHARS[b0 >> 2] + B64_CHARS[((b0 & 3) << 4) | (b1 >> 4)] +
        (i + 1 < s.length ? B64_CHARS[((b1 & 0xf) << 2) | (b2 >> 6)] : '=') +
        (i + 2 < s.length ? B64_CHARS[b2 & 0x3f] : '=');
    }
    return out;
  }

  // ─── BOqDcafn Sandbox Loader ──────────────────────────────────────────────────
  var _boqPromise = null;

  function loadBoqNode() {
    var vm = require('vm');
    var https = require('https');
    var nodeCrypto = require('crypto');
    var noop = function () {};
    var fp = buildFingerprint();

    return new Promise(function (resolve, reject) {
      https.get(BOQ_URL, { headers: { 'User-Agent': 'Mozilla/5.0' } }, function (res) {
        var chunks = [];
        res.on('data', function (d) { chunks.push(d); });
        res.on('end', function () {
          try {
            var code = Buffer.concat(chunks).toString();
            var clean = code
              .replace(/import\{[^}]*\}from["'][^"']+["'];?/g, 'var X = {};')
              .replace(/export\{[^}]*\};?/g, '');

            var sb = vm.createContext({
              console: console,
              crypto: nodeCrypto.webcrypto,
              TextEncoder: TextEncoder, TextDecoder: TextDecoder,
              URL: URL, URLSearchParams: URLSearchParams,
              atob: pureAtob, btoa: pureBtoa,
              performance: { now: function () { return Date.now(); }, mark: noop, measure: noop },
              fetch: function (url, opts) {
                return new Promise(function (fResolve, fReject) {
                  var u = new URL(url);
                  var req = https.request({
                    hostname: u.hostname,
                    port: parseInt(u.port) || 443,
                    path: u.pathname + (u.search || ''),
                    method: (opts && opts.method) || 'GET',
                    headers: Object.assign({
                      'Accept': '*/*',
                      'Origin': 'https://cinejoy.to',
                      'Referer': 'https://cinejoy.to/',
                      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                    }, (opts && opts.headers) || {})
                  }, function (fRes) {
                    var rChunks = [];
                    fRes.on('data', function (d) { rChunks.push(d); });
                    fRes.on('end', function () {
                      var body = Buffer.concat(rChunks);
                      fResolve({
                        ok: fRes.statusCode >= 200 && fRes.statusCode < 300,
                        status: fRes.statusCode,
                        json: function () { return Promise.resolve(JSON.parse(body.toString())); },
                        text: function () { return Promise.resolve(body.toString()); },
                        arrayBuffer: function () { return Promise.resolve(body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength)); },
                      });
                    });
                  });
                  req.on('error', fReject);
                  if (opts && opts.body) {
                    var b = Buffer.isBuffer(opts.body) ? opts.body : Buffer.from(opts.body);
                    req.write(b);
                  }
                  req.end();
                });
              },
              Object: Object, Array: Array, Math: Math, JSON: JSON, Date: Date,
              String: String, Number: Number, Boolean: Boolean, Promise: Promise,
              Map: Map, Set: Set, WeakMap: WeakMap, RegExp: RegExp, Error: Error,
              TypeError: TypeError, Symbol: Symbol, Proxy: Proxy, Reflect: Reflect,
              isNaN: isNaN, isFinite: isFinite, parseInt: parseInt, parseFloat: parseFloat,
              decodeURIComponent: decodeURIComponent, encodeURIComponent: encodeURIComponent,
              Uint8Array: Uint8Array, ArrayBuffer: ArrayBuffer, DataView: DataView,
              Int8Array: Int8Array, Uint16Array: Uint16Array, Int32Array: Int32Array,
              Uint32Array: Uint32Array, Float32Array: Float32Array, Float64Array: Float64Array,
              Uint8ClampedArray: Uint8ClampedArray,
              window: { location: { href: 'https://cinejoy.to/', hostname: 'cinejoy.to' }, navigator: { userAgent: '' }, addEventListener: noop },
              document: { querySelector: function () { return null; }, querySelectorAll: function () { return []; }, createElement: function () { return { style: {}, classList: { add: noop } }; }, cookie: '', currentScript: null, addEventListener: noop },
              navigator: { userAgent: 'Mozilla/5.0', language: fp.lang, hardwareConcurrency: fp.hc },
              location: { href: 'https://cinejoy.to/', hostname: 'cinejoy.to', origin: 'https://cinejoy.to', pathname: '/' },
              history: { pushState: noop, replaceState: noop, state: null },
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

            resolve({
              Ax: vm.runInContext('typeof Ax !== "undefined" ? Ax : null', sb),
              G0: vm.runInContext('typeof G0 !== "undefined" ? G0 : null', sb),
              O0: vm.runInContext('typeof O0 !== "undefined" ? O0 : null', sb),
              p0: vm.runInContext('typeof p0 !== "undefined" ? p0 : null', sb),
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
    var fp = buildFingerprint();

    var realCrypto = (typeof crypto !== 'undefined' && crypto.subtle) ? crypto
      : (typeof window !== 'undefined' && window.crypto && window.crypto.subtle) ? window.crypto
      : null;

    var g = (typeof globalThis !== 'undefined') ? globalThis
      : (typeof global !== 'undefined') ? global
      : (typeof window !== 'undefined') ? window : {};

    var _saved = {};
    var SHIMS = {
      HTMLElement: function HTMLElement() {},
      SVGElement: function SVGElement() {},
      Element: function Element() {},
      Node: function Node() {},
      EventTarget: function EventTarget() {},
      Event: function Event(t) { this.type = t; this.bubbles = false; this.cancelable = false; },
      CustomEvent: function CustomEvent(t, d) { this.type = t; this.detail = d && d.detail; },
      MutationObserver: function MutationObserver() { this.observe = noop; this.disconnect = noop; this.takeRecords = function () { return []; }; },
      ResizeObserver: function ResizeObserver() { this.observe = noop; this.disconnect = noop; },
      IntersectionObserver: function IntersectionObserver() { this.observe = noop; this.disconnect = noop; },
      AbortController: function AbortController() { this.signal = { aborted: false, addEventListener: noop, removeEventListener: noop }; this.abort = noop; },
      AbortSignal: { timeout: function () { return { aborted: false, addEventListener: noop, removeEventListener: noop }; } },
      customElements: { define: noop, get: function () { return null; }, whenDefined: function () { return Promise.resolve(); } },
      document: {
        querySelector: function () { return null; },
        querySelectorAll: function () { return { forEach: noop, length: 0 }; },
        getElementById: function () { return null; },
        createElement: function (t) { return { tagName: t.toUpperCase(), style: {}, classList: { add: noop, remove: noop, contains: function () { return false; }, toggle: noop }, setAttribute: noop, getAttribute: function () { return null; }, addEventListener: noop, removeEventListener: noop, appendChild: noop, removeChild: noop, children: [], innerHTML: '', textContent: '' }; },
        createTextNode: function (t) { return { textContent: t }; },
        head: { appendChild: noop },
        body: { appendChild: noop, style: {} },
        cookie: '',
        currentScript: null,
        addEventListener: noop,
        removeEventListener: noop,
        dispatchEvent: noop,
        readyState: 'complete',
        hidden: false,
      },
      window: {
        location: { href: 'https://cinejoy.to/', hostname: 'cinejoy.to', origin: 'https://cinejoy.to', pathname: '/' },
        navigator: { userAgent: 'Mozilla/5.0', language: fp.lang, hardwareConcurrency: fp.hc, maxTouchPoints: fp.tp, onLine: true },
        addEventListener: noop, removeEventListener: noop, dispatchEvent: noop,
        history: { pushState: noop, replaceState: noop, state: null },
        screen: { width: fp.sw, height: fp.sh, colorDepth: fp.cd },
        devicePixelRatio: fp.dpr,
        crypto: realCrypto,
        performance: { now: function () { return Date.now(); }, mark: noop, measure: noop },
        requestAnimationFrame: noop, cancelAnimationFrame: noop,
        setTimeout: noop, clearTimeout: noop, setInterval: noop, clearInterval: noop,
      },
      location: { href: 'https://cinejoy.to/', hostname: 'cinejoy.to', origin: 'https://cinejoy.to', pathname: '/' },
      history: { pushState: noop, replaceState: noop, state: null },
      performance: { now: function () { return Date.now(); }, mark: noop, measure: noop },
      requestAnimationFrame: noop,
      cancelAnimationFrame: noop,
      structuredClone: function (x) { return JSON.parse(JSON.stringify(x)); },
      atob: pureAtob,
      btoa: pureBtoa,
      URL: typeof URL !== 'undefined' ? URL : null,
      URLSearchParams: typeof URLSearchParams !== 'undefined' ? URLSearchParams : null,
      TextEncoder: typeof TextEncoder !== 'undefined' ? TextEncoder : null,
      TextDecoder: typeof TextDecoder !== 'undefined' ? TextDecoder : null,
      crypto: realCrypto,
    };

    var toRestore = [];
    for (var k in SHIMS) {
      if (Object.prototype.hasOwnProperty.call(SHIMS, k) && SHIMS[k] != null) {
        try {
          _saved[k] = g[k];
          g[k] = SHIMS[k];
          toRestore.push(k);
        } catch (e) {}
      }
    }

    function cleanup() {
      for (var i = 0; i < toRestore.length; i++) {
        var key = toRestore[i];
        try {
          if (typeof _saved[key] === 'undefined') {
            delete g[key];
          } else {
            g[key] = _saved[key];
          }
        } catch (e) {}
      }
    }

    return fetch(BOQ_URL, { headers: { 'User-Agent': 'Mozilla/5.0', 'Accept': '*/*' } })
      .then(function (r) { return r.text(); })
      .then(function (code) {
        var clean = code
          .replace(/import\{[^}]*\}from["'][^"']+["'];?/g, 'var X = {};')
          .replace(/export\{[^}]*\};?/g, '');

        var exps = null;
        try {
          // eslint-disable-next-line no-new-func
          var fn = new Function('module', 'exports',
            clean + '\n' +
            'return { ' +
            '  Ax: typeof Ax !== "undefined" ? Ax : null, ' +
            '  G0: typeof G0 !== "undefined" ? G0 : null, ' +
            '  O0: typeof O0 !== "undefined" ? O0 : null, ' +
            '  p0: typeof p0 !== "undefined" ? p0 : null ' +
            '};'
          );
          var mod = { exports: {} };
          exps = fn(mod, mod.exports);
        } finally {
          cleanup();
        }

        if (!exps || !exps.Ax) {
          throw new Error('Failed to extract Ax from BOqDcafn bundle');
        }

        return exps;
      })
      .catch(function (e) {
        cleanup();
        throw e;
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

  // ─── Subtitles ────────────────────────────────────────────────────────────────
  function fetchSubtitles(tmdbId, isTv, season, episode) {
    var type = isTv ? 'tv' : 'movie';
    var url = SUBS_BASE + '/subtitles?type=' + type + '&tmdb=' + tmdbId;
    if (isTv && season != null && episode != null) url += '&season=' + season + '&episode=' + episode;
    return new Promise(function (resolve) {
      var timer = setTimeout(function () { resolve([]); }, 6000);
      fetch(url, {
        headers: {
          'Accept': 'application/json',
          'Origin': 'https://cinejoy.to',
          'Referer': 'https://cinejoy.to/',
          'User-Agent': 'Mozilla/5.0'
        }
      })
        .then(function (r) { return r.json(); })
        .then(function (data) {
          clearTimeout(timer);
          var list = (data && data.subtitles) || [];
          resolve(list.map(function (s) {
            return {
              url: s.url,
              lang: s.language || s.label || 'Unknown',
              language: s.language || s.label || 'Unknown',
              label: s.display || s.label || s.language || 'Unknown',
              type: s.type || 'srt'
            };
          }));
        })
        .catch(function () {
          clearTimeout(timer);
          resolve([]);
        });
    });
  }

  // ─── Argument Parser ──────────────────────────────────────────────────────────
  function parseArgs(args) {
    var first = args[0];
    if (typeof first === 'object' && first !== null) {
      return {
        tmdbId: first.tmdbId || first.tmdb || first.id,
        imdbId: first.imdbId || first.imdb,
        title: first.title || first.name,
        year: first.year ? Number(first.year) : undefined,
        isTv: Boolean(first.isTv || first.type === 'tv' || first.type === 2),
        season: first.season != null ? Number(first.season) : undefined,
        episode: first.episode != null ? Number(first.episode) : undefined,
        server: first.server || first.preferredServer,
      };
    }
    // Positional: (tmdbId, imdbId, title, isTv, season, episode, year)
    return {
      tmdbId: first,
      imdbId: args[1],
      title: args[2],
      isTv: Boolean(args[3]),
      season: args[4] != null ? Number(args[4]) : undefined,
      episode: args[5] != null ? Number(args[5]) : undefined,
      year: args[6] != null ? Number(args[6]) : undefined,
    };
  }

  // ─── Main Extraction ──────────────────────────────────────────────────────────
  function extractAsync() {
    var params = parseArgs(arguments);
    var tmdbId = params.tmdbId;
    var isTv = params.isTv;
    var season = params.season;
    var episode = params.episode;
    var imdbId = params.imdbId;
    var title = params.title;
    var year = params.year;
    var preferredServer = params.server;

    console.log(TAG, 'Extracting tmdb:', tmdbId, isTv ? '(TV s' + season + 'e' + episode + ')' : '(Movie)');
    if (!tmdbId) {
      return Promise.reject(new Error(TAG + ' Missing tmdbId'));
    }

    var mediaType = isTv ? 'tv' : 'movie';
    var mediaPayload = {
      tmdbId: tmdbId,
      imdbId: imdbId,
      title: title,
      year: year,
      season: season,
      episode: episode,
    };

    return loadBoq().then(function (boq) {
      if (!boq.Ax) {
        throw new Error(TAG + ' Ax extractor not available');
      }

      console.log(TAG, 'Running Ax extractor for', mediaType, 'tmdbId=' + tmdbId);
      return boq.Ax(mediaType, mediaPayload, function (status) {
        if (status && status.provider) {
          console.log(TAG, '[' + status.provider + ']', status.status || '', status.error || '');
        }
      }, preferredServer);
    }).then(function (axResult) {
      if (!axResult || !axResult.result || !axResult.result.url) {
        throw new Error(TAG + ' No streams found for tmdbId=' + tmdbId);
      }

      var streamUrl = axResult.result.url;
      var sourceType = axResult.result.sourceType || 'hls';
      var directCaptions = axResult.result.captions || [];

      // Find winning server name if reported in providers
      var winningServer = 'Lisbon';
      if (axResult.providers && axResult.providers.length) {
        var found = axResult.providers.find(function (p) { return p && p.status === 'ok'; });
        if (found && found.name) winningServer = found.name;
      }

      console.log(TAG, '✅ Ax found stream:', streamUrl.slice(0, 60) + '... (server: ' + winningServer + ')');

      return fetchSubtitles(tmdbId, isTv, season, episode).then(function (remoteSubs) {
        var formattedDirect = directCaptions.map(function (c) {
          return {
            url: c.url || c.src,
            lang: c.language || c.lang || c.label || 'Unknown',
            language: c.language || c.lang || c.label || 'Unknown',
            label: c.label || c.language || 'Unknown',
            type: 'vtt',
          };
        });

        var combinedSubs = formattedDirect.concat(remoteSubs || []);

        return {
          url: streamUrl,
          stream: streamUrl,
          quality: 'Auto',
          provider: 'CineJoy',
          server: winningServer,
          type: sourceType === 'hls' || streamUrl.indexOf('.m3u8') !== -1 ? 'hls' : 'mp4',
          headers: {
            Referer: 'https://cinejoy.to/',
            Origin: 'https://cinejoy.to',
            'User-Agent': 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Mobile Safari/537.36',
          },
          subtitles: combinedSubs,
        };
      });
    });
  }

  // Dual API: returns Promise AND calls callback
  function extract() {
    var args = Array.prototype.slice.call(arguments);
    var cb = null;
    if (args.length > 1 && typeof args[args.length - 1] === 'function') {
      cb = args.pop();
    } else if (typeof args[0] === 'object' && args[0] !== null && typeof args[0].callback === 'function') {
      cb = args[0].callback;
    }

    var promise = extractAsync.apply(null, args);
    if (typeof cb === 'function') {
      promise.then(function (r) { cb(null, r); }).catch(function (e) { cb(e, null); });
    }
    return promise;
  }

  // ─── Export ───────────────────────────────────────────────────────────────────
  var extractor = {
    name: 'CineJoy',
    version: '3.4.0',
    description: 'CineJoy lumen-gate-v1 native Ax sandbox (Lisbon/Solara/Athens/Joy/Castle)',
    extract: extract,
    fetchSubtitles: fetchSubtitles,
  };

  if (typeof module !== 'undefined' && module.exports) { module.exports = extractor; }
  if (typeof window !== 'undefined') { window.CineJoyExtractor = extractor; }
  if (typeof registerExtractor === 'function') { registerExtractor('cinejoy', extractor); }
})();
