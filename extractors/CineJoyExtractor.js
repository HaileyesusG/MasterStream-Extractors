/**
 * CineJoyExtractor v4.2.0 — Universal Remote Extractor for MasterStream.
 *
 * Architecture:
 * - Mobile / React Native (Hermes): Calls the backend CineJoy extraction API endpoint
 *   (Render cloud + local dev fallbacks) with zero JS engine friction.
 * - Node.js / Server environments: Uses native V8 VM execution of CineJoy bundle with
 *   full auto-discovery of entry chunks & export aliases for maximum reliability.
 *
 * 100% JS/API based. No stream sniffer / WebView required.
 */
(function () {
  'use strict';

  var TAG = '[CineJoyExtractor]';
  var SUBS_BASE = 'https://subtitles.shegu.st';
  var USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36';

  var BACKEND_ENDPOINTS = [
    'https://backendmasterstream.onrender.com/api/cinejoy/extract',
    'http://192.168.100.2:5000/api/cinejoy/extract',
  ];

  var IS_NODE = typeof process !== 'undefined' && process.versions && !!process.versions.node;

  // ─── Node.js Native Runner (used when running on backend server) ──────────────
  var _boqNodePromise = null;
  var _cachedChunk = null;

  function fetchTextNode(url) {
    var https = require('https');
    var http = require('http');
    return new Promise(function (resolve) {
      var lib = url.indexOf('https') === 0 ? https : http;
      var req = lib.get(url, { headers: { 'User-Agent': USER_AGENT } }, function (res) {
        if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          return fetchTextNode(res.headers.location).then(resolve);
        }
        if (res.statusCode && (res.statusCode < 200 || res.statusCode >= 300)) return resolve(null);
        var d = '';
        res.on('data', function (c) { d += c; });
        res.on('end', function () { resolve(d); });
      });
      req.on('error', function () { resolve(null); });
      req.setTimeout(10000, function () { req.destroy(); resolve(null); });
    });
  }

  async function discoverChunkNode() {
    if (_cachedChunk) {
      var code = await fetchTextNode('https://cinejoy.to/' + _cachedChunk);
      if (code && code.indexOf('as s') !== -1 && code.indexOf('failure:') !== -1) {
        var m = code.match(/([a-zA-Z0-9_$]+)\s+as\s+s\b/);
        if (m) return { path: _cachedChunk, code: code, masterVarName: m[1] };
      }
    }
    var html = await fetchTextNode('https://cinejoy.to/');
    if (!html) throw new Error('Failed to fetch CineJoy homepage');
    var appMatch = html.match(/_app\/immutable\/entry\/app\.[a-zA-Z0-9_-]+\.js/);
    if (!appMatch) throw new Error('Failed to find app.js in CineJoy homepage');
    var appCode = await fetchTextNode('https://cinejoy.to/' + appMatch[0]);
    if (!appCode) throw new Error('Failed to fetch app.js');

    var chunks = (appCode.match(/[a-zA-Z0-9_-]+\.js/g) || []);
    var unique = [];
    for (var i = 0; i < chunks.length; i++) {
      if (unique.indexOf(chunks[i]) === -1) unique.push(chunks[i]);
    }
    for (var j = 0; j < unique.length; j++) {
      var chunkPath = '_app/immutable/chunks/' + unique[j];
      var chunkCode = await fetchTextNode('https://cinejoy.to/' + chunkPath);
      if (chunkCode && chunkCode.indexOf('as s') !== -1 && chunkCode.indexOf('failure:') !== -1) {
        var match = chunkCode.match(/([a-zA-Z0-9_$]+)\s+as\s+s\b/);
        if (match) {
          _cachedChunk = chunkPath;
          return { path: chunkPath, code: chunkCode, masterVarName: match[1] };
        }
      }
    }
    throw new Error('Could not find active CineJoy extractor chunk');
  }

  function loadBoqNode() {
    if (_boqNodePromise) return _boqNodePromise;

    _boqNodePromise = (async function () {
      var http = require('http');
      var https = require('https');
      var vm = require('vm');
      var crypto = require('crypto');

      var found = await discoverChunkNode();
      var code = found.code;
      var masterVarName = found.masterVarName;

      var clean = code
        .replace(/import\s*\{([^}]*)\}\s*from\s*["'][^"']*["'];?/g, function (_, imports) {
          return imports.split(',').map(function (seg) {
            var parts = seg.trim().split(/\s+as\s+/);
            var localName = (parts[1] || parts[0]).trim().replace(/[^a-zA-Z0-9_$]/g, '');
            return localName ? 'var ' + localName + ' = (function(){ var fn = function(){}; fn.serverOrder=["Lisbon","Nebula","Solara","Athens","Joy","Castle","Sakura","Canaias"]; fn.servers=[]; fn.providers=[]; fn.captions=[]; fn.audioTracks=[]; fn.qualities=[]; fn.sourceType="hls"; fn.url=""; fn.introSkip=null; fn.prototype={}; if(typeof Proxy!=="undefined"){return new Proxy(fn,{get:function(t,k){if(k in t)return t[k];return function(){};},apply:function(t,_,a){return t.apply(null,a);}});} return fn; })();' : '';
          }).filter(Boolean).join(' ');
        })
        .replace(/export\s*\{[^}]*\}\s*;?/g, '');

      var nodeFetch = function (url, opts) {
        return new Promise(function (resolve, reject) {
          var u = new URL(url);
          var mod = u.protocol === 'http:' ? http : https;
          var headers = Object.assign({
            'Accept': '*/*',
            'Origin': 'https://cinejoy.to',
            'Referer': 'https://cinejoy.to/',
            'User-Agent': USER_AGENT,
          }, (opts && opts.headers) || {});

          var req = mod.request(url, {
            method: (opts && opts.method) || 'GET',
            headers: headers,
          }, function (res) {
            var chunks = [];
            res.on('data', function (c) { chunks.push(c); });
            res.on('end', function () {
              var buf = Buffer.concat(chunks);
              var ok = res.statusCode >= 200 && res.statusCode < 300;
              resolve({
                ok: ok,
                status: res.statusCode,
                json: function () { return Promise.resolve(JSON.parse(buf.toString('utf8'))); },
                text: function () { return Promise.resolve(buf.toString('utf8')); },
                arrayBuffer: function () { return Promise.resolve(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)); },
              });
            });
          });
          req.on('error', reject);
          if (opts && opts.body) {
            var b = opts.body;
            if (typeof b === 'string' || Buffer.isBuffer(b)) {
              req.write(b);
            } else if (b && typeof b === 'object') {
              if (b.byteLength !== undefined) {
                var ab = b.buffer ? b.buffer : b;
                var offset = b.byteOffset || 0;
                var len = b.byteLength;
                req.write(Buffer.from(ab, offset, len));
              } else {
                req.write(String(b));
              }
            }
          }
          req.end();
        });
      };

      var sandbox = vm.createContext({
        console: console,
        setTimeout: setTimeout,
        clearTimeout: clearTimeout,
        setInterval: setInterval,
        clearInterval: clearInterval,
        Promise: Promise,
        fetch: nodeFetch,
        TextEncoder: TextEncoder,
        TextDecoder: TextDecoder,
        URL: URL,
        URLSearchParams: URLSearchParams,
        crypto: crypto.webcrypto,
        atob: function (s) { return Buffer.from(s, 'base64').toString('binary'); },
        btoa: function (s) { return Buffer.from(s, 'binary').toString('base64'); },
        navigator: { userAgent: USER_AGENT, language: 'en', hardwareConcurrency: 4, maxTouchPoints: 5, onLine: true },
        location: { href: 'https://cinejoy.to/', hostname: 'cinejoy.to', origin: 'https://cinejoy.to', pathname: '/' },
        isSecureContext: true,
        performance: { now: function () { return Date.now(); } },
      });
      sandbox.window = sandbox;
      sandbox.self = sandbox;
      sandbox.globalThis = sandbox;

      var script = new vm.Script(clean + '\n; (typeof ' + masterVarName + ' !== "undefined" ? ' + masterVarName + ' : null);');
      var masterAx = script.runInContext(sandbox, { timeout: 15000 });
      if (!masterAx || typeof masterAx !== 'function') throw new Error('Master extractor function (' + masterVarName + ') not found in CineJoy bundle');
      return { Ax: masterAx };
    })();

    return _boqNodePromise;
  }

  // ─── Extract via Backend API (used on React Native / Hermes) ──────────────────
  async function extractViaBackend(tmdbId, imdbId, title, isTv, season, episode, year) {
    var type = isTv ? 'tv' : 'movie';
    var qs = '?tmdbId=' + encodeURIComponent(tmdbId) + '&type=' + type;
    if (isTv) {
      qs += '&season=' + encodeURIComponent(season || 1) + '&episode=' + encodeURIComponent(episode || 1);
    }
    if (imdbId) qs += '&imdbId=' + encodeURIComponent(imdbId);
    if (title) qs += '&title=' + encodeURIComponent(title);
    if (year) qs += '&year=' + encodeURIComponent(year);

    for (var i = 0; i < BACKEND_ENDPOINTS.length; i++) {
      var endpoint = BACKEND_ENDPOINTS[i] + qs;
      try {
        console.log(TAG + ' Fetching from backend endpoint: ' + BACKEND_ENDPOINTS[i]);
        var controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
        var timeoutId = controller ? setTimeout(function () { controller.abort(); }, 15000) : null;

        var res = await fetch(endpoint, {
          method: 'GET',
          headers: {
            'Accept': 'application/json',
            'User-Agent': USER_AGENT,
          },
          signal: controller ? controller.signal : undefined,
        });

        if (timeoutId) clearTimeout(timeoutId);

        if (res.ok) {
          var data = await res.json();
          if (data && data.ok && data.url) {
            console.log(TAG + ' ✅ Stream extracted via backend API: ' + data.url.slice(0, 60) + '...');
            return {
              url: data.url,
              quality: data.quality || 'Auto',
              qualities: data.qualities || [],
              provider: 'CineJoy',
              headers: data.headers || {
                'Referer': 'https://cinejoy.to/',
                'Origin': 'https://cinejoy.to',
                'User-Agent': USER_AGENT,
              },
              subtitles: data.subtitles || [],
            };
          }
        }
      } catch (err) {
        console.warn(TAG + ' Endpoint ' + BACKEND_ENDPOINTS[i] + ' failed: ' + (err.message || err));
      }
    }

    return null;
  }

  // ─── Subtitles Helper ────────────────────────────────────────────────────────
  function formatSubtitles(tracks) {
    if (!Array.isArray(tracks) || !tracks.length) return [];
    var subs = [];
    for (var i = 0; i < tracks.length; i++) {
      var t = tracks[i];
      if (!t) continue;
      var file = t.file || t.url || t.src || '';
      if (!file) continue;
      var label = t.label || t.name || t.language || t.lang || ('Subtitle ' + (i + 1));
      var lang = t.lang || t.language || label;
      if (file.indexOf('http') !== 0) {
        file = SUBS_BASE + (file.indexOf('/') === 0 ? '' : '/') + file;
      }
      subs.push({ url: file, lang: lang, label: label });
    }
    return subs;
  }

  // ─── Primary Extract Function ─────────────────────────────────────────────────
  async function extract(tmdbId, imdbId, title, isTv, season, episode, year) {
    if (!IS_NODE) {
      return await extractViaBackend(tmdbId, imdbId, title, isTv, season, episode, year);
    }

    try {
      var bundle = await loadBoqNode();
      if (!bundle || !bundle.Ax) {
        console.warn(TAG + ' Ax master extractor not available in BOq bundle');
        return null;
      }

      var mediaType = isTv ? 'tv' : 'movie';
      var params = {
        tmdbId: Number(tmdbId) || tmdbId,
        imdbId: imdbId || '',
        title: title || '',
        year: year ? Number(year) : undefined,
      };

      if (isTv && season != null && episode != null) {
        params.season = Number(season);
        params.episode = Number(episode);
      }

      console.log(TAG + ' Invoking native Ax for ' + mediaType + ' tmdb:' + tmdbId + (isTv ? (' S' + season + 'E' + episode) : ''));

      var axPromise = bundle.Ax(mediaType, params, function (status) {
        if (status && status.provider) {
          console.log(TAG + ' Server [' + status.provider + ']: ' + status.status + (status.error ? (' (' + status.error + ')') : ''));
        }
      });

      var timeoutPromise = new Promise(function (_, reject) {
        setTimeout(function () { reject(new Error('Ax extraction timeout (15000ms)')); }, 15000);
      });

      var res = await Promise.race([axPromise, timeoutPromise]);
      if (!res || !res.result || !res.result.url) {
        console.warn(TAG + ' Ax returned no playable stream (failure: ' + (res && res.failure) + ')');
        return null;
      }

      var streamUrl = res.result.url;
      var captions = formatSubtitles(res.result.captions || res.result.subtitles || []);

      console.log(TAG + ' ✅ Stream extracted successfully: ' + streamUrl.substring(0, 60) + '... (' + captions.length + ' subs)');

      return {
        url: streamUrl,
        quality: 'Auto',
        provider: 'CineJoy',
        headers: {
          Referer: 'https://cinejoy.to/',
          Origin: 'https://cinejoy.to',
          'User-Agent': USER_AGENT,
        },
        subtitles: captions,
      };
    } catch (e) {
      console.error(TAG + ' Extraction failed: ' + e.message);
      return null;
    }
  }

  // ─── Module Export ────────────────────────────────────────────────────────────
  var extractor = { extract: extract };
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = extractor;
  }
  var gObj = typeof globalThis !== 'undefined' ? globalThis
    : typeof window !== 'undefined' ? window
    : typeof global !== 'undefined' ? global : this;
  if (gObj) {
    gObj.CineJoyExtractor = extractor;
  }
})();
