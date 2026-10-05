/**
 * VixSrcExtractor v3.0.0 — Universal Remote Extractor for MasterStream.
 * Powered by VidUp (https://vidup.to) + enc-dec.app API.
 * Hosted at: HaileyesusG/MasterStream-Extractors/extractors/VixSrcExtractor.js
 */
(function () {
  'use strict';

  var TAG = '[VixSrcExtractor]';
  var DOMAIN = 'https://vidup.to';
  var ENC_DEC = 'https://enc-dec.app/api';
  var USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36';

  var PREFERRED_SERVERS = ['Euro', 'CineX', 'Zenith', 'Premier', 'Eclipse'];

  async function fetchGet(url, headers) {
    try {
      var controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
      var timer = controller ? setTimeout(function () { controller.abort(); }, 15000) : null;
      var response = await fetch(url, {
        headers: headers,
        redirect: 'follow',
        signal: controller ? controller.signal : undefined,
      });
      if (timer) clearTimeout(timer);
      if (!response.ok) return null;
      return await response.text();
    } catch (e) {
      console.warn(TAG + ' ❌ Network error (' + url.slice(0, 50) + '): ' + (e.message || e));
      return null;
    }
  }

  async function fetchPost(url, body, headers) {
    try {
      var controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
      var timer = controller ? setTimeout(function () { controller.abort(); }, 15000) : null;
      var response = await fetch(url, {
        method: 'POST',
        body: body,
        headers: headers,
        redirect: 'follow',
        signal: controller ? controller.signal : undefined,
      });
      if (timer) clearTimeout(timer);
      if (!response.ok) return null;
      return await response.text();
    } catch (e) {
      return null;
    }
  }

  async function extract(tmdbId, arg1, arg2, arg3, arg4, arg5) {
    // Dual calling-convention support:
    //   Mobile app: extract(tmdbId, isTv, season, episode)               — 4 params
    //   TV app:     extract(tmdbId, imdbId, title, isTv, season, episode, year) — 7 params
    var isTv, season, episode;
    if (typeof arg1 === 'boolean') {
      isTv = arg1;
      season = arg2;
      episode = arg3;
    } else {
      isTv = arg3;
      season = arg4;
      episode = arg5;
    }

    try {
      var baseHeaders = {
        'User-Agent': USER_AGENT,
        'Referer': DOMAIN + '/',
        'X-Requested-With': 'XMLHttpRequest',
      };

      // Note: Do NOT add trailing slash to prevent Next.js 308 redirect
      var urlSearch = isTv
        ? DOMAIN + '/tv/' + tmdbId + '/' + (season || 1) + '/' + (episode || 1)
        : DOMAIN + '/movie/' + tmdbId;

      console.log(TAG + ' 🚀 Fetching VidUp page: ' + urlSearch);

      var htmlDetail = await fetchGet(urlSearch, {
        'User-Agent': USER_AGENT,
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      });
      if (!htmlDetail) {
        console.warn(TAG + ' ❌ Failed to fetch VidUp page');
        return null;
      }

      // Extract encrypted text from page JSON
      var textMatch = htmlDetail.match(/\\"(?:en|token)\\":\\"(.*?)\\"/) ||
                      htmlDetail.match(/"(?:en|token)"\s*:\s*"([^"]+)"/);
      if (!textMatch || !textMatch[1]) {
        console.warn(TAG + ' ❌ No encrypted text found in page');
        return null;
      }
      var text = textMatch[1];
      console.log(TAG + ' 🔑 Found encrypted text (len=' + text.length + ')');

      // 1. Call enc-vidup
      var encUrl = ENC_DEC + '/enc-vidup?text=' + encodeURIComponent(text);
      var encRaw = await fetchGet(encUrl, { 'User-Agent': USER_AGENT });
      if (!encRaw) return null;

      var encJson;
      try { encJson = JSON.parse(encRaw); } catch (e) { return null; }

      if (encJson.status !== 200 || !encJson.result) {
        console.warn(TAG + ' ❌ enc-vidup API error: ' + (encJson.error || 'unknown'));
        return null;
      }

      var serversUrl = encJson.result.servers;
      var streamUrl = encJson.result.stream;
      var token = encJson.result.token;

      if (!serversUrl || !streamUrl) {
        console.warn(TAG + ' ❌ Missing servers or stream URL');
        return null;
      }

      var apiHeaders = {
        'User-Agent': USER_AGENT,
        'Referer': DOMAIN + '/',
        'X-Requested-With': 'XMLHttpRequest',
      };
      if (token) {
        apiHeaders['X-CSRF-Token'] = token;
      }

      // 2. Fetch encrypted servers
      console.log(TAG + ' 📡 Fetching server list...');
      var serversEnc = await fetchPost(serversUrl, '', apiHeaders);
      if (!serversEnc) return null;

      // 3. Decrypt servers
      var decSrvRaw = await fetchPost(ENC_DEC + '/dec-vidup', JSON.stringify({ text: serversEnc }), {
        'User-Agent': USER_AGENT,
        'Content-Type': 'application/json',
      });
      if (!decSrvRaw) return null;

      var decSrvJson;
      try { decSrvJson = JSON.parse(decSrvRaw); } catch (e) { return null; }

      var serversList = decSrvJson.result || [];
      if (!Array.isArray(serversList) || serversList.length === 0) {
        console.warn(TAG + ' ❌ No servers returned after decryption');
        return null;
      }

      // Sort by preferred order
      serversList = serversList.slice().sort(function (a, b) {
        var ai = PREFERRED_SERVERS.indexOf(a.name);
        var bi = PREFERRED_SERVERS.indexOf(b.name);
        if (ai === -1) ai = PREFERRED_SERVERS.length;
        if (bi === -1) bi = PREFERRED_SERVERS.length;
        return ai - bi;
      });

      console.log(TAG + ' 📋 Available servers: ' + serversList.map(function (s) { return s.name; }).join(', '));

      // 4. Try each server until stream found
      for (var i = 0; i < serversList.length; i++) {
        var srv = serversList[i];
        if (!srv.data) continue;

        console.log(TAG + ' 🚀 Trying server: ' + srv.name);

        var streamReqUrl = streamUrl + '/' + srv.data;
        var streamEnc = await fetchPost(streamReqUrl, '', apiHeaders);
        if (!streamEnc) {
          console.warn(TAG + ' ⚠️ Failed to fetch stream from ' + srv.name);
          continue;
        }

        var decStreamRaw = await fetchPost(ENC_DEC + '/dec-vidup', JSON.stringify({ text: streamEnc }), {
          'User-Agent': USER_AGENT,
          'Content-Type': 'application/json',
        });
        if (!decStreamRaw) continue;

        var decStreamJson;
        try { decStreamJson = JSON.parse(decStreamRaw); } catch (e) { continue; }

        var result = decStreamJson.result;
        if (!result) continue;

        var streamFileUrl = result.url;
        if (!streamFileUrl && Array.isArray(result.sources) && result.sources.length > 0) {
          streamFileUrl = result.sources[0].file || result.sources[0].url;
        }

        if (!streamFileUrl) {
          console.warn(TAG + ' ⚠️ No stream URL found for ' + srv.name);
          continue;
        }

        var subtitlesList = [];
        if (Array.isArray(result.tracks)) {
          for (var k = 0; k < result.tracks.length; k++) {
            var track = result.tracks[k];
            var trackUrl = track.file || track.url;
            if (trackUrl && track.kind !== 'thumbnails') {
              var lang = track.label || track.name || track.language || 'English';
              subtitlesList.push({ url: trackUrl, lang: lang, label: lang });
            }
          }
        }

        console.log(TAG + ' ✅ Stream extracted from server [' + srv.name + ']: ' + streamFileUrl.slice(0, 60) + '... (' + subtitlesList.length + ' subs)');

        return {
          url: streamFileUrl,
          quality: 'Auto',
          provider: 'VixSrc',
          headers: {
            'User-Agent': USER_AGENT,
            'Referer': DOMAIN + '/',
          },
          subtitles: subtitlesList,
        };
      }

      console.warn(TAG + ' ❌ All servers failed');
      return null;
    } catch (e) {
      console.error(TAG + ' 💥 Error during extraction: ' + (e.message || e));
      return null;
    }
  }

  var extractorObj = {
    name: 'VixSrc',
    extract: extract,
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = extractorObj;
  }
  if (typeof globalThis !== 'undefined') {
    globalThis.VixSrcExtractor = extractorObj;
  }
})();
