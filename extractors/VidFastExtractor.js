/**
 * VidFastExtractor — self-contained CommonJS JS for remote hot-update.
 * Hosted at: HaileyesusG/MasterStream-Extractors/extractors/VidFastExtractor.js
 *
 * To update: edit this file, run Update-Manifest.ps1, commit and push.
 * The app will pick it up within 1 hour (no app release needed).
 */
(function () {
  var TAG = '[VidFastExtractor]';
  // -- Media type support � change here to enable/disable for movies or TV --
  var SUPPORTS_MOVIE = true;
  var SUPPORTS_TV    = true;

  var DOMAIN = 'https://vidfast.vc';
  var ENC_DEC_API = 'https://enc-dec.app/api';
  var VERSION = '1';
  var USER_AGENT =
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36';

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
      if (isTv && !SUPPORTS_TV)    { console.log(TAG + ' Skip TV'); return null; }
      if (!isTv && !SUPPORTS_MOVIE) { console.log(TAG + ' Skip Movie'); return null; }
      // Step 1: Fetch vidfast embed page and extract the encrypted text token
      var pageUrl = isTv
        ? DOMAIN + '/tv/' + tmdbId + '/' + season + '/' + episode + '/'
        : DOMAIN + '/movie/' + tmdbId;

      console.log(TAG + ' 🚀 Fetching page: ' + pageUrl);

      var pageHeaders = {
        'User-Agent': USER_AGENT,
        Referer: DOMAIN + '/',
        'X-Requested-With': 'XMLHttpRequest',
      };

      var pageRes = await fetch(pageUrl, { headers: pageHeaders });
      if (!pageRes.ok) {
        console.warn(TAG + ' ❌ HTTP ' + pageRes.status + ' for ' + pageUrl);
        return null;
      }
      var html = await pageRes.text();

      // Extract the encrypted "en" text from page JSON.
      // The page embeds encrypted data in two possible forms:
      //   Form 1 (within a JSON string value): \"en\":\"ABC...\"
      //   Form 2 (plain JS object):             "en":"ABC..."
      // We try both — Form 1 is needed when the text is double-encoded;
      // Form 2 is what OkHttpClient bridge returns (strings are already decoded).
      var match = html.match(/\\"en\\":\\"(.*?)\\"/) ||
                  html.match(/"en"\s*:\s*"([^"]+)"/);
      if (!match) {
        console.warn(TAG + ' ❌ Could not find encrypted text in page');
        return null;
      }
      var encText = match[1];
      console.log(TAG + ' 🔑 Found encrypted text (' + encText.length + ' chars)');

      // Step 2: Get enc-vidfast data (servers URL, stream base URL, CSRF token)
      var encRes = await fetch(
        ENC_DEC_API + '/enc-vidfast?text=' + encodeURIComponent(encText) + '&version=' + VERSION
      );
      if (!encRes.ok) {
        console.warn(TAG + ' ❌ enc-vidfast HTTP ' + encRes.status);
        return null;
      }
      var encData = await encRes.json();
      if (encData.status !== 200 || !encData.result) {
        console.warn(TAG + ' ❌ enc-vidfast failed: ' + encData.error);
        return null;
      }

      var serversUrl = encData.result.servers;
      var streamBase = encData.result.stream;
      var token = encData.result.token;
      pageHeaders['X-CSRF-Token'] = token;

      // Step 3: Fetch and decrypt server list
      var serversRes = await fetch(serversUrl, {
        method: 'POST',
        headers: pageHeaders,
      });
      if (!serversRes.ok) {
        console.warn(TAG + ' ❌ servers POST HTTP ' + serversRes.status);
        return null;
      }
      var serversEnc = await serversRes.text();

      var decServersRes = await fetch(ENC_DEC_API + '/dec-vidfast', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: serversEnc, version: VERSION }),
      });
      var decServersData = await decServersRes.json();
      if (decServersData.status !== 200 || !decServersData.result || !decServersData.result.length) {
        console.warn(TAG + ' ❌ dec-vidfast servers failed: ' + decServersData.error);
        return null;
      }

      var servers = decServersData.result;
      var serverNames = servers.map(function(s) { return s.name; }).join(', ');
      console.log(TAG + ' 📡 Got ' + servers.length + ' servers: ' + serverNames);

      // Preferred server order — edit here to change priority (GitHub hot-update)
      var PREFERRED_SERVERS = ['vRapid', 'vEdge', 'Cobra', 'vFast', 'Charlie', 'Bravo'];
      servers = servers.slice().sort(function(a, b) {
        var ai = PREFERRED_SERVERS.indexOf(a.name);
        var bi = PREFERRED_SERVERS.indexOf(b.name);
        if (ai === -1) ai = PREFERRED_SERVERS.length;
        if (bi === -1) bi = PREFERRED_SERVERS.length;
        return ai - bi;
      });
      console.log(TAG + ' 📋 Server order after priority: ' + servers.map(function(s) { return s.name; }).join(', '));

      // Step 4: Try each server — fetch stream and decrypt
      for (var i = 0; i < servers.length; i++) {
        var server = servers[i];
        try {
          var streamUrl = streamBase + '/' + server.data;
          var streamRes = await fetch(streamUrl, {
            method: 'POST',
            headers: pageHeaders,
          });
          if (!streamRes.ok) continue;

          var streamEnc = await streamRes.text();
          var decStreamRes = await fetch(ENC_DEC_API + '/dec-vidfast', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ text: streamEnc, version: VERSION }),
          });
          var decStreamData = await decStreamRes.json();

          if (decStreamData.status !== 200 || !decStreamData.result || !decStreamData.result.url) {
            console.warn(TAG + ' ⚠️ ' + server.name + ' dec-vidfast stream failed: ' + decStreamData.error);
            continue;
          }

          var resultObj = decStreamData.result;
          console.log(TAG + ' ✅ Stream extracted from server: ' + server.name);

          // Parse subtitles
          var subtitles = [];
          var subList = resultObj.subtitles || resultObj.tracks || [];
          for (var j = 0; j < subList.length; j++) {
            var sub = subList[j];
            if (sub.file && sub.label) {
              subtitles.push({
                url: sub.file,
                lang: sub.label,
                label: sub.label,
              });
            }
          }

          // Build playback headers — the CDN enforces Referer on HLS segments.
          // Use whatever referer hint the server gave us, otherwise fall back to vidfast.vc.
          // The key insight: both the master playlist AND each .ts segment must match.
          var streamReferer = resultObj.referer || resultObj.origin || (DOMAIN + '/');
          // Strip trailing slash inconsistency
          if (streamReferer && streamReferer.charAt(streamReferer.length - 1) !== '/') {
            streamReferer = streamReferer + '/';
          }
          var streamOrigin = streamReferer.replace(/\/$/, '');

          var playbackHeaders = {
            'User-Agent': USER_AGENT,
            'Referer': streamReferer,
            'Origin': streamOrigin,
          };

          console.log(TAG + ' 📡 [' + server.name + '] Using Referer: ' + streamReferer);

          return {
            url: resultObj.url,
            quality: 'Auto',
            provider: 'VidFast-' + server.name,
            headers: playbackHeaders,
            subtitles: subtitles,
          };
        } catch (err) {
          console.warn(TAG + ' ❌ ' + server.name + ' error: ' + err.message);
        }
      }

      console.warn(TAG + ' ❌ All VidFast servers exhausted');
      return null;
    } catch (e) {
      console.error(TAG + ' ❌ Fatal error: ' + e.message);
      return null;
    }
  }

  module.exports = { extract: extract };
})();
