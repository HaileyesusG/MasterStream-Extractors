/**
 * VidFastExtractor — self-contained CommonJS JS for remote hot-update.
 * Hosted at: HaileyesusG/MasterStream-Extractors/extractors/VidFastExtractor.js
 *
 * To update: edit this file, run Update-Manifest.ps1, commit and push.
 * The app will pick it up within 1 hour (no app release needed).
 */
(function () {
  var TAG = '[VidFastExtractor]';
  // -- Media type support — change here to enable/disable for movies or TV --
  var SUPPORTS_MOVIE = true;
  var SUPPORTS_TV    = true;

  var DOMAIN = 'https://vidfast.vc';
  var ENC_DEC_API = 'https://enc-dec.app/api';
  var USER_AGENT =
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36';

  
  // Catalog of Amharic dubbed movies and TV series
  var AMHARIC_CATALOG = {
    tv: {
      '288673_1_8': {
        title: 'Carrie S1E8',
        uniqueId: 'AgADcR4AAnAzSFI',
        fallbackUrl: 'https://stream.unlockify.ink/internal-stream/AgADcR4AAnAzSFI',
      },
      '1407_1_8': {
        title: 'Carrie (Homeland) S1E8',
        uniqueId: 'AgADcR4AAnAzSFI',
        fallbackUrl: 'https://stream.unlockify.ink/internal-stream/AgADcR4AAnAzSFI',
      },
    },
    movies: {},
  };

  async function attachAmharicAudioTrack(result, tmdbId, isTvShow, season, episode, title) {
    if (!result || !result.url) return result;
    try {
      var s = Number(season || 1);
      var e = Number(episode || 1);
      var item = null;
      if (isTvShow) {
        var tvKey = String(tmdbId) + '_' + s + '_' + e;
        item = AMHARIC_CATALOG.tv[tvKey];
        if (!item && title && /homeland|carrie/i.test(title) && s === 1 && e === 8) {
          item = AMHARIC_CATALOG.tv['288673_1_8'];
        }
      } else {
        item = AMHARIC_CATALOG.movies[String(tmdbId)];
      }

      if (!item) return result;

      var amharicUrl = item.uniqueId
        ? 'https://backendmasterstream.onrender.com/api/cinejoy/telegram/' + encodeURIComponent(item.uniqueId) + '.mp4'
        : (item.fallbackUrl || item.streamUrl);

      var englishQualities = (result.qualities && result.qualities.length > 0)
        ? result.qualities
        : [{ quality: result.quality || 'Auto', url: result.url }];

      var amharicQualities = [
        { quality: '1080p', url: amharicUrl },
        { quality: 'Auto', url: amharicUrl },
      ];

      var amharicLabel = 'Amharic (\u1260\u1275\u122d\u1309\u121d)';

      var existingAudio = result.audioTracks || [
        {
          language: 'English',
          url: result.url,
          qualities: englishQualities,
        },
      ];

      if (!existingAudio.some(function (a) { return a.language === amharicLabel; })) {
        existingAudio.push({
          language: amharicLabel,
          url: amharicUrl,
          qualities: amharicQualities,
        });
      }
      result.audioTracks = existingAudio;

      console.log(TAG + ' 🇪🇹 Attached Amharic audio track (.mp4 redirect) to result');
    } catch (attachErr) {}
    return result;
  }

  async function extract(tmdbId, arg1, arg2, arg3, arg4, arg5, arg6) {
    // Dual calling-convention support:
    //   Mobile app: extract(tmdbId, isTv, season, episode)               — 4 params
    //   TV app:     extract(tmdbId, imdbId, title, isTv, season, episode, year) — 7 params
    var isTv, season, episode, imdbId, title;
    if (typeof arg1 === 'boolean') {
      isTv = arg1; season = arg2; episode = arg3; // mobile
    } else {
      imdbId = arg1; title = arg2; isTv = arg3; season = arg4; episode = arg5; // TV app
    } try {
      if (isTv && !SUPPORTS_TV)    { console.log(TAG + ' Skip TV'); return null; }
      if (!isTv && !SUPPORTS_MOVIE) { console.log(TAG + ' Skip Movie'); return null; }

      // Prefer TMDB id, or fallback to imdbId if tmdbId is missing
      var id = tmdbId || imdbId;
      if (!id) {
        console.warn(TAG + ' ❌ Missing tmdbId/imdbId');
        return null;
      }

      // Step 1: Fetch vidfast embed page and extract the encrypted text token
      var pageUrl = isTv
        ? DOMAIN + '/tv/' + id + '/' + (season || 1) + '/' + (episode || 1) + '/'
        : DOMAIN + '/movie/' + id;

      console.log(TAG + ' 🚀 Fetching page: ' + pageUrl);

      // Note: Initial HTML page MUST NOT include 'X-Requested-With', otherwise vidfast returns HTTP 403 Forbidden!
      var pageHeaders = {
        'User-Agent': USER_AGENT,
        'Referer': DOMAIN + '/',
      };

      var pageRes = await fetch(pageUrl, { headers: pageHeaders });
      if (!pageRes.ok) {
        console.warn(TAG + ' ❌ HTTP ' + pageRes.status + ' for ' + pageUrl);
        return null;
      }
      var html = await pageRes.text();

      // Extract the encrypted text from the page JSON / Next.js RSC payload.
      // Combined regex scanning for both "en" and "token" field names.
      var match = html.match(/\\\"(?:en|token)\\\":\\\"(.*?)\\\"/) ||
                  html.match(/"(?:en|token)"\s*:\s*"([^"]+)"/);
      if (!match) {
        console.warn(TAG + ' ❌ Could not find encrypted text in page');
        return null;
      }
      var encText = match[1];
      console.log(TAG + ' 🔑 Found encrypted text (' + encText.length + ' chars)');

      // Step 2: Get enc-vidfast data (servers URL, stream base URL, CSRF token)
      // Supports both new 2-stage handshake and legacy 1-stage fallback (in case dev rolls back)
      var serversUrl, streamBase, token;

      var stage1Res = await fetch(
        ENC_DEC_API + '/enc-vidfast?text=' + encodeURIComponent(encText) + '&stage=1'
      );
      var stage1Data = stage1Res.ok ? await stage1Res.json() : null;

      if (stage1Data && stage1Data.status === 200 && stage1Data.result && stage1Data.result.stage1) {
        // 2-Stage Handshake
        var stage1Encrypted = stage1Data.result.stage1;
        var token1 = stage1Data.result.token;

        var s1Headers = {
          'User-Agent': USER_AGENT,
          'Referer': DOMAIN + '/',
          'X-Requested-With': 'XMLHttpRequest',
        };
        if (token1) s1Headers['X-CSRF-Token'] = token1;

        var s1PostRes = await fetch(stage1Encrypted, {
          method: 'POST',
          headers: s1Headers,
        });
        if (!s1PostRes.ok) {
          console.warn(TAG + ' ❌ stage1 POST HTTP ' + s1PostRes.status);
          return null;
        }
        var s1PostText = await s1PostRes.text();

        // Stage 2
        var stage2Res = await fetch(
          ENC_DEC_API + '/enc-vidfast?text=' + encodeURIComponent(s1PostText) + '&stage=2'
        );
        if (!stage2Res.ok) {
          console.warn(TAG + ' ❌ stage2 HTTP ' + stage2Res.status);
          return null;
        }
        var stage2Data = await stage2Res.json();
        if (stage2Data.status !== 200 || !stage2Data.result) {
          console.warn(TAG + ' ❌ stage2 failed: ' + (stage2Data.error || 'unknown'));
          return null;
        }
        serversUrl = stage2Data.result.servers;
        streamBase = stage2Data.result.stream;
        token = stage2Data.result.token;
      } else {
        // Legacy 1-Stage Handshake Fallback (if dev rolls back changes)
        console.log(TAG + ' ℹ️ Stage 1 unavailable, falling back to legacy 1-stage enc-vidfast...');
        var encRes = await fetch(
          ENC_DEC_API + '/enc-vidfast?text=' + encodeURIComponent(encText)
        );
        if (!encRes.ok) {
          console.warn(TAG + ' ❌ enc-vidfast HTTP ' + encRes.status);
          return null;
        }
        var encData = await encRes.json();
        if (encData.status !== 200 || !encData.result) {
          console.warn(TAG + ' ❌ enc-vidfast failed: ' + (encData.error || 'unknown'));
          return null;
        }
        serversUrl = encData.result.servers;
        streamBase = encData.result.stream;
        token = encData.result.token;
      }

      // API endpoints (servers & stream) require X-Requested-With and X-CSRF-Token
      var apiHeaders = {
        'User-Agent': USER_AGENT,
        'Referer': DOMAIN + '/',
        'X-Requested-With': 'XMLHttpRequest',
      };
      if (token) {
        apiHeaders['X-CSRF-Token'] = token;
      }

      // Step 3: Fetch and decrypt server list
      var serversRes = await fetch(serversUrl, {
        method: 'POST',
        headers: apiHeaders,
      });
      if (!serversRes.ok) {
        console.warn(TAG + ' ❌ servers POST HTTP ' + serversRes.status);
        return null;
      }
      var serversEnc = await serversRes.text();

      var decServersRes = await fetch(ENC_DEC_API + '/dec-vidfast', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: serversEnc }),
      });
      var decServersData = await decServersRes.json();
      if (decServersData.status !== 200 || !decServersData.result || !decServersData.result.length) {
        console.warn(TAG + ' ❌ dec-vidfast servers failed: ' + (decServersData.error || 'unknown'));
        return null;
      }

      var servers = decServersData.result;
      var serverNames = servers.map(function(s) { return s.name; }).join(', ');
      console.log(TAG + ' 📡 Got ' + servers.length + ' servers: ' + serverNames);

      // Preferred server order — edit here to change priority (GitHub hot-update)
      var PREFERRED_SERVERS = ['vRapid', 'vBlaze', 'Cobra', 'Cine', 'Bravo', 'Horizon'];
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
            headers: apiHeaders,
          });
          if (!streamRes.ok) continue;

          var streamEnc = await streamRes.text();
          var decStreamRes = await fetch(ENC_DEC_API + '/dec-vidfast', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ text: streamEnc }),
          });
          var decStreamData = await decStreamRes.json();

          if (decStreamData.status !== 200 || !decStreamData.result || !decStreamData.result.url) {
            console.warn(TAG + ' ⚠️ ' + server.name + ' dec-vidfast stream failed: ' + (decStreamData.error || 'unknown'));
            continue;
          }

          var resultObj = decStreamData.result;
          console.log(TAG + ' ✅ Stream extracted from server: ' + server.name);

          // Parse subtitles
          var subtitles = [];
          var subList = resultObj.subtitles || resultObj.tracks || [];
          for (var j = 0; j < subList.length; j++) {
            var sub = subList[j];
            var subUrl = sub.file || sub.url;
            var subLabel = sub.label || sub.name || sub.lang;
            if (subUrl && subLabel) {
              subtitles.push({
                url: subUrl,
                lang: subLabel,
                label: subLabel,
              });
            }
          }

          // Use referer hint from decrypted result if present, else fall back to vidfast.vc.
          // This is critical for TV ExoPlayer: the CDN enforces Referer on every .ts segment.
          var streamReferer = resultObj.referer || resultObj.origin || (DOMAIN + '/');
          if (streamReferer.charAt(streamReferer.length - 1) !== '/') {
            streamReferer = streamReferer + '/';
          }
          var streamOrigin = streamReferer.replace(/\/$/, '');

          var playbackHeaders = {
            'User-Agent': USER_AGENT,
            'Referer': streamReferer,
            'Origin': streamOrigin,
          };

          console.log(TAG + ' 📡 [' + server.name + '] Referer: ' + streamReferer);

          var finalStreamUrl = resultObj.url;
          var qualities = [];

          // If the extracted stream URL points to an HLS master playlist (e.g. ending in /index.m3u8),
          // some CDNs (like Bravo / Eclipse / qixno442run) serve the root /index.m3u8 with Content-Type: text/html
          // which causes mobile validateUrl() to reject it or timeout.
          // We provide all available variant qualities (1080p, 720p, 480p, 360p) in the `qualities` list,
          // while setting the primary validated stream `url` to 1080p (or highest available).
          if (typeof finalStreamUrl === 'string' && finalStreamUrl.indexOf('/index.m3u8') !== -1) {
            var q1080 = finalStreamUrl.replace(/\/index\.m3u8$/, '/1080/index.m3u8');
            var q720 = finalStreamUrl.replace(/\/index\.m3u8$/, '/720/index.m3u8');
            var q480 = finalStreamUrl.replace(/\/index\.m3u8$/, '/480/index.m3u8');
            var q360 = finalStreamUrl.replace(/\/index\.m3u8$/, '/360/index.m3u8');

            qualities = [
              { quality: '1080p', url: q1080 },
              { quality: '720p',  url: q720 },
              { quality: '480p',  url: q480 },
              { quality: '360p',  url: q360 },
            ];
            finalStreamUrl = q1080;
            console.log(TAG + ' 🎯 Generated ' + qualities.length + ' qualities (1080p, 720p, 480p, 360p)');
          }

          var vidFastResult = {
            url: finalStreamUrl,
            quality: 'Auto',
            provider: 'VidFast-' + server.name,
            headers: playbackHeaders,
            subtitles: subtitles,
            qualities: qualities,
          };
          return await attachAmharicAudioTrack(vidFastResult, tmdbId, isTv, season, episode, title);
        } catch (err) {
          console.warn(TAG + ' ❌ ' + server.name + ' error: ' + (err.message || err));
        }
      }

      console.warn(TAG + ' ❌ All VidFast servers exhausted');
      return null;
    } catch (e) {
      console.error(TAG + ' ❌ Fatal error: ' + (e.message || e));
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
    gObj.VidFastExtractor = extractor;
  }
})();
