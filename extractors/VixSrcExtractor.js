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
      // Money Heist & Lupin legacy normalizer
      if (isTv) {
        var sNum = Number(season) || 1;
        var eNum = Number(episode) || 1;
        if (String(tmdbId) === '71446' || (typeof arg1 === 'string' && arg1 === 'tt6468322')) {
          if (sNum === 2 && eNum > 8) {
            season = 4; episode = eNum - 8;
            console.log(TAG + ' 🔄 Money Heist legacy S' + sNum + 'E' + eNum + ' -> S' + season + 'E' + episode);
          } else if (sNum === 2 && (eNum === 7 || eNum === 8)) {
            season = 3; episode = eNum;
            console.log(TAG + ' 🔄 Money Heist legacy S' + sNum + 'E' + eNum + ' -> S' + season + 'E' + episode);
          } else if (sNum === 1 && eNum > 9) {
            season = 2; episode = eNum - 9;
            console.log(TAG + ' 🔄 Money Heist legacy S' + sNum + 'E' + eNum + ' -> S' + season + 'E' + episode);
          }
        } else if (String(tmdbId) === '96677' || (typeof arg1 === 'string' && arg1 === 'tt2531336')) {
          if (sNum === 1 && eNum > 5) {
            season = 2; episode = eNum - 5;
            console.log(TAG + ' 🔄 Lupin legacy S' + sNum + 'E' + eNum + ' -> S' + season + 'E' + episode);
          }
        }
      }

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

      // 1. Call enc-vidup (2-stage handshake with legacy fallback)
      var serversUrl, streamUrl, token;

      var stage1Url = ENC_DEC + '/enc-vidup?text=' + encodeURIComponent(text) + '&stage=1';
      var stage1Raw = await fetchGet(stage1Url, { 'User-Agent': USER_AGENT });
      var stage1Json = null;
      try { if (stage1Raw) stage1Json = JSON.parse(stage1Raw); } catch (e) {}

      if (stage1Json && stage1Json.status === 200 && stage1Json.result && stage1Json.result.stage1) {
        // 2-Stage Handshake
        var stage1Encrypted = stage1Json.result.stage1;
        var token1 = stage1Json.result.token;

        var s1Headers = {
          'User-Agent': USER_AGENT,
          'Referer': DOMAIN + '/',
          'X-Requested-With': 'XMLHttpRequest',
        };
        if (token1) s1Headers['X-CSRF-Token'] = token1;

        var s1PostText = await fetchPost(stage1Encrypted, '', s1Headers);
        if (!s1PostText) {
          console.warn(TAG + ' ❌ stage1 POST failed');
          return null;
        }

        // Stage 2
        var stage2Url = ENC_DEC + '/enc-vidup?text=' + encodeURIComponent(s1PostText) + '&stage=2';
        var stage2Raw = await fetchGet(stage2Url, { 'User-Agent': USER_AGENT });
        var stage2Json = null;
        try { if (stage2Raw) stage2Json = JSON.parse(stage2Raw); } catch (e) {}

        if (!stage2Json || stage2Json.status !== 200 || !stage2Json.result) {
          console.warn(TAG + ' ❌ stage2 enc-vidup API error: ' + (stage2Json ? stage2Json.error : 'unknown'));
          return null;
        }
        serversUrl = stage2Json.result.servers;
        streamUrl = stage2Json.result.stream;
        token = stage2Json.result.token;
      } else {
        // Legacy 1-Stage Fallback
        console.log(TAG + ' ℹ️ Stage 1 unavailable, falling back to legacy 1-stage enc-vidup...');
        var encUrl = ENC_DEC + '/enc-vidup?text=' + encodeURIComponent(text);
        var encRaw = await fetchGet(encUrl, { 'User-Agent': USER_AGENT });
        if (!encRaw) return null;

        var encJson;
        try { encJson = JSON.parse(encRaw); } catch (e) { return null; }

        if (encJson.status !== 200 || !encJson.result) {
          console.warn(TAG + ' ❌ enc-vidup API error: ' + (encJson.error || 'unknown'));
          return null;
        }

        serversUrl = encJson.result.servers;
        streamUrl = encJson.result.stream;
        token = encJson.result.token;
      }

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

        var qualities = [];

        // If the extracted stream URL points to an HLS master playlist (e.g. ending in /index.m3u8),
        // some CDNs (like Bravo / Eclipse / qixno442run) serve the root /index.m3u8 with Content-Type: text/html
        // which causes mobile validateUrl() to reject it or timeout.
        // We provide all available variant qualities (1080p, 720p, 480p, 360p) in the `qualities` list,
        // while setting the primary validated stream `url` to 1080p (or highest available).
        if (typeof streamFileUrl === 'string' && streamFileUrl.indexOf('/index.m3u8') !== -1) {
          var q1080 = streamFileUrl.replace(/\/index\.m3u8$/, '/1080/index.m3u8');
          var q720 = streamFileUrl.replace(/\/index\.m3u8$/, '/720/index.m3u8');
          var q480 = streamFileUrl.replace(/\/index\.m3u8$/, '/480/index.m3u8');
          var q360 = streamFileUrl.replace(/\/index\.m3u8$/, '/360/index.m3u8');

          qualities = [
            { quality: '1080p', url: q1080 },
            { quality: '720p',  url: q720 },
            { quality: '480p',  url: q480 },
            { quality: '360p',  url: q360 },
          ];
          streamFileUrl = q1080;
          console.log(TAG + ' 🎯 Generated ' + qualities.length + ' qualities (1080p, 720p, 480p, 360p)');
        }

        return {
          url: streamFileUrl,
          quality: 'Auto',
          provider: 'VixSrc',
          headers: {
            'User-Agent': USER_AGENT,
            'Referer': DOMAIN + '/',
          },
          subtitles: subtitlesList,
          qualities: qualities,
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
