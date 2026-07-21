/**
 * VixSrcExtractor — self-contained CommonJS JS for remote hot-update.
 * Hosted at: HaileyesusG/MasterStream-Extractors/extractors/VixSrcExtractor.js
 * Uses vidcore.net logic
 */
(function () {
  var TAG = '[VixSrcExtractor]';
  // -- Media type support � change here to enable/disable for movies or TV --
  var SUPPORTS_MOVIE = true;
  var SUPPORTS_TV    = true;

  var DOMAIN = 'https://vidcore.net';
  var ENC_DEC = 'https://enc-dec.app/api';
  var USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36';

  function regexFirst(input, pattern) {
    var match = input.match(new RegExp(pattern, 'i'));
    return match ? match[1] : null;
  }

  async function fetchGet(url, headers) {
    try {
      var response = await fetch(url, { headers: headers, redirect: 'follow' });
      if (!response.ok) return null;
      return await response.text();
    } catch (e) {
      console.warn(TAG + ' ❌ Network error: ' + e.message);
      return null;
    }
  }

  async function fetchPost(url, body, headers) {
    try {
      var response = await fetch(url, { method: 'POST', body: body, headers: headers, redirect: 'follow' });
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
      isTv = arg1; season = arg2; episode = arg3; // mobile
    } else {
      isTv = arg3; season = arg4; episode = arg5; // TV app
    }
    try {
      if (isTv && !SUPPORTS_TV)    { console.log('[VixSrc] Skip TV'); return null; }
      if (!isTv && !SUPPORTS_MOVIE) { console.log('[VixSrc] Skip Movie'); return null; }
      var headers = {
        'User-Agent': USER_AGENT,
        'Referer': DOMAIN + '/',
        'X-Requested-With': 'XMLHttpRequest'
      };

      var urlSearch = isTv
        ? DOMAIN + '/tv/' + tmdbId + '/' + season + '/' + episode + '/'
        : DOMAIN + '/movie/' + tmdbId + '/';

      console.log(TAG + ' 🚀 Starting extraction: ' + urlSearch);

      var htmlDetail = await fetchGet(urlSearch, headers);
      if (!htmlDetail) {
        console.warn(TAG + ' ❌ Failed to fetch vidcore page');
        return null;
      }

      // Extract the encrypted text from the page JSON.
      // Combined regex scanning for both "en" and "token" field names (per enc-dec.app recommendation).
      var textMatch = htmlDetail.match(/\\\"(?:en|token)\\\":\\\"(.*?)\\\"/) ||
                      htmlDetail.match(/"(?:en|token)"\s*:\s*"([^"]+)"/);
      if (!textMatch || !textMatch[1]) {
        console.warn(TAG + ' ❌ No encrypted text found in page');
        return null;
      }
      var text = textMatch[1];
      console.log(TAG + ' 🔑 Found encrypted text');

      // Call enc-vidcore
      var encUrl = ENC_DEC + '/enc-vidcore?text=' + encodeURIComponent(text);
      var encRaw = await fetchGet(encUrl, { 'User-Agent': USER_AGENT });
      if (!encRaw) return null;

      var encJson;
      try { encJson = JSON.parse(encRaw); } catch (e) { return null; }

      if (encJson.status !== 200 || !encJson.result) {
        console.warn(TAG + ' ❌ enc-vidcore API error: ' + (encJson.error || 'unknown'));
        return null;
      }

      var serversUrl = encJson.result.servers;
      var streamUrl = encJson.result.stream;
      var token = encJson.result.token;

      if (!serversUrl || !streamUrl || token === null || token === undefined) {
        console.warn(TAG + ' ❌ Missing servers or stream in API response');
        return null;
      }
      console.log(TAG + ' 🔑 servers/stream/token received (token empty=' + (token === '') + ')');

      // Update headers for server fetching (only add CSRF token if non-empty)
      var apiHeaders = {
        'User-Agent': USER_AGENT,
        'Referer': DOMAIN + '/',
        'X-Requested-With': 'XMLHttpRequest'
      };
      if (token) apiHeaders['X-CSRF-Token'] = token;

      // Get streaming servers
      var serversEnc = await fetchPost(serversUrl, '', apiHeaders);
      if (!serversEnc) return null;

      var decSrvRaw = await fetchPost(ENC_DEC + '/dec-vidcore', JSON.stringify({ text: serversEnc }), {
        'User-Agent': USER_AGENT,
        'Content-Type': 'application/json'
      });
      if (!decSrvRaw) return null;

      var decSrvJson;
      try { decSrvJson = JSON.parse(decSrvRaw); } catch(e) { return null; }
      
      var serversList = decSrvJson.result || [];
      if (!Array.isArray(serversList) || serversList.length === 0) {
        console.warn(TAG + ' ❌ No servers returned after decryption');
        return null;
      }

      console.log(TAG + ' 📡 Got ' + serversList.length + ' servers: ' + serversList.map(function(s) { return s.name; }).join(', '));

      // Preferred server order — edit here to change priority (GitHub hot-update)
      var PREFERRED_SERVERS = ['Prime', 'Horizon', 'Orbit'];
      serversList = serversList.slice().sort(function(a, b) {
        var ai = PREFERRED_SERVERS.indexOf(a.name);
        var bi = PREFERRED_SERVERS.indexOf(b.name);
        if (ai === -1) ai = PREFERRED_SERVERS.length;
        if (bi === -1) bi = PREFERRED_SERVERS.length;
        return ai - bi;
      });
      console.log(TAG + ' 📋 Server order after priority: ' + serversList.map(function(s) { return s.name; }).join(', '));

      // Loop through servers (stop at first successful one)
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

        var decStreamRaw = await fetchPost(ENC_DEC + '/dec-vidcore', JSON.stringify({ text: streamEnc }), {
          'User-Agent': USER_AGENT,
          'Content-Type': 'application/json'
        });
        if (!decStreamRaw) continue;

        var decStreamJson;
        try { decStreamJson = JSON.parse(decStreamRaw); } catch(e) { continue; }

        var result = decStreamJson.result;
        if (!result) {
          console.warn(TAG + ' \u26a0\ufe0f No result for ' + srv.name);
          continue;
        }

        var streamFileUrl = null;

        // Format 1: result.url (direct stream URL — used by Prime, etc.)
        if (result.url) {
          streamFileUrl = result.url;
        }
        // Format 2: result.sources[] array
        else if (Array.isArray(result.sources) && result.sources.length > 0) {
          streamFileUrl = result.sources[0].file || result.sources[0].url || null;
        }

        if (!streamFileUrl) {
          console.warn(TAG + ' \u26a0\ufe0f No stream URL found for ' + srv.name);
          continue;
        }

        var directQuality = [{ file: streamFileUrl, quality: 1080 }];


        var subtitlesList = [];
        if (Array.isArray(result.tracks)) {
          for (var k = 0; k < result.tracks.length; k++) {
            var track = result.tracks[k];
            var trackUrl = track.file;
            if (trackUrl && track.kind !== 'thumbnails') {
              var lang = track.label || 'Unknown';
              subtitlesList.push({ url: trackUrl, lang: lang, label: lang });
            }
          }
        }

        console.log(TAG + ' ✅ Stream extracted from server: ' + srv.name);

        return {
          url: directQuality[0].file,
          quality: directQuality[0].quality + 'p',
          qualities: directQuality.map(function(q) { return { url: q.file, quality: q.quality + 'p' }; }),
          provider: 'VixSrc',
          headers: {
            'User-Agent': USER_AGENT,
            'Referer': DOMAIN + '/'
          },
          subtitles: subtitlesList
        };
      }

      console.warn(TAG + ' ❌ All servers failed');
      return null;
      
    } catch (e) {
      console.error(TAG + ' 💥 Error during extraction', e);
      return null;
    }
  }

  module.exports = { extract: extract };
})();
