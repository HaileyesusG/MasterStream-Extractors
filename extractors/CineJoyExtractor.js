/**
 * CineJoyExtractor — self-contained CommonJS JS for remote hot-update.
 * Hosted at: HaileyesusG/MasterStream-Extractors/extractors/CineJoyExtractor.js
 */
(function () {
  var TAG = '[CineJoyExtractor]';
  var FETCH_HEADERS = {
    Accept: '*/*',
    Origin: 'https://cinejoy.to',
    Referer: 'https://cinejoy.to/',
    'User-Agent':
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36',
  };

  async function fetchGet(url, extra) {
    try {
      var res = await fetch(url, { headers: Object.assign({}, FETCH_HEADERS, extra || {}), redirect: 'follow' });
      if (!res.ok) return null;
      return await res.text();
    } catch (e) {
      return null;
    }
  }

  async function fetchPost(url, body) {
    try {
      var res = await fetch(url, {
        method: 'POST',
        headers: Object.assign({ 'Content-Type': 'application/json' }, FETCH_HEADERS),
        body: JSON.stringify(body),
        redirect: 'follow',
      });
      if (!res.ok) return null;
      return await res.text();
    } catch (e) {
      return null;
    }
  }

  function parseStream(decJson, server) {
    if (decJson.status !== 200 || !decJson.result) return null;
    var result = decJson.result;
    var streams = Array.isArray(result.stream) ? result.stream :
                  Array.isArray(result.streams) ? result.streams :
                  Array.isArray(result.sources) ? result.sources : [];
    if (!streams.length) return null;
    var best = streams.find(function(s) { return s.type === 'hls' || (s.playlist || '').indexOf('.m3u8') !== -1; }) || streams[0];
    var streamUrl = best.playlist || best.url || best.file || best.src || '';
    if (!streamUrl) return null;

    var subtitles = [];
    var caps = Array.isArray(best.captions) ? best.captions :
               Array.isArray(result.subtitles) ? result.subtitles :
               Array.isArray(result.tracks) ? result.tracks : [];
    for (var i = 0; i < caps.length; i++) {
      var cap = caps[i];
      var url = cap.url || cap.file || '';
      var lang = cap.language || cap.label || cap.lang || 'Unknown';
      if (url) subtitles.push({ url: url, lang: lang, label: lang });
    }
    return {
      url: streamUrl,
      quality: 'Auto',
      provider: 'CineJoy',
      headers: {
        Referer: 'https://cinejoy.to/',
        Origin: 'https://cinejoy.to',
        'User-Agent': FETCH_HEADERS['User-Agent'],
      },
      subtitles: subtitles,
    };
  }

  async function extract(tmdbId, imdbId, title, isTv, season, episode, year) {
    try {
      var serversRaw = await fetchGet('https://api.shegu.st/servers');
      if (!serversRaw) return null;
      var serversJson;
      try { serversJson = JSON.parse(serversRaw); } catch (e) { return null; }
      var servers = (serversJson.servers || []).map(function(s) { return s.name; });
      if (!servers.length) return null;

      for (var i = 0; i < servers.length; i++) {
        var server = servers[i];
        var paramsObj = {
          title: title || '',
          type: isTv ? 'series' : 'movie',
          year: year || '',
          imdb: imdbId || '',
          tmdb: String(tmdbId),
          server: server,
        };
        if (isTv && season != null && episode != null) {
          paramsObj.season = String(season);
          paramsObj.episode = String(episode);
        }
        var params = new URLSearchParams(paramsObj);
        var sourceUrl = 'https://api.shegu.st/?' + params.toString();

        var encRaw = await fetchGet('https://enc-dec.app/api/enc-cinejoy?url=' + encodeURIComponent(sourceUrl));
        if (!encRaw) continue;
        var encJson;
        try { encJson = JSON.parse(encRaw); } catch (e) { continue; }
        if (encJson.status !== 200 || !encJson.result) continue;
        var enc = encJson.result;

        var encrypted = null;
        var fastRaw = await fetchGet('https://enc-dec.app/api/fetch-cinejoy?enc=' + encodeURIComponent(enc));
        if (fastRaw) {
          try {
            var fastJson = JSON.parse(fastRaw);
            if (fastJson && fastJson.status === 200 && fastJson.result) {
              encrypted = fastJson.result;
            }
          } catch (e) {}
        }

        if (!encrypted) {
          var challengeRaw = await fetchGet('https://api.shegu.st/challenge?rid=' + enc);
          if (!challengeRaw) continue;
          var challenge;
          try { challenge = JSON.parse(challengeRaw); } catch (e) { continue; }
          
          if (!global.ScryptSolverBridge || !global.ScryptSolverBridge.available) {
            console.warn(TAG + ' ScryptSolverBridge not ready');
            continue;
          }
          var solution;
          try {
            solution = await global.ScryptSolverBridge.solve(challenge);
          } catch (e) {
            console.warn(TAG + ' PoW solve failed: ' + e.message);
            continue;
          }
          encrypted = await fetchGet('https://api.shegu.st/' + enc, { 'x-at': solution });
        }

        if (!encrypted || !encrypted.trim()) continue;

        var decRaw = await fetchPost('https://enc-dec.app/api/dec-cinejoy', { text: encrypted });
        if (!decRaw) continue;
        var decJson;
        try { decJson = JSON.parse(decRaw); } catch (e) { continue; }
        var result = parseStream(decJson, server);
        if (result) return result;
      }
      return null;
    } catch (e) {
      console.error(TAG + ' Error: ' + e.message);
      return null;
    }
  }

  module.exports = { extract: extract };
})();
