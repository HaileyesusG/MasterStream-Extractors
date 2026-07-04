/**
 * VideasyExtractor — self-contained CommonJS JS for remote hot-update.
 * Hosted at: HaileyesusG/MasterStream-Extractors/extractors/VideasyExtractor.js
 *
 * Reference: https://github.com/smy778/EncDecEndpoints/blob/main/samples/videasy.py
 *
 * Servers (api.wingsdatabase.com):
 *   jett       = Original audio
 *   cdn (Yoru) = Original audio — Movies only, may have 4K
 *   tejo       = Original audio
 *   neon2      = Original audio
 *   ym (Sage)  = Original audio
 *   downloader2 (Cypher) = Original audio
 *   m4uhd (Breach) = Original audio
 *   hdmovie (Vyse) = English only
 */
(function () {
  var TAG = '[VideasyExtractor]';
  var DOMAIN = 'https://api.wingsdatabase.com';
  var USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36';

  // ── Media type support — change here to enable/disable for movies or TV ──
  var SUPPORTS_MOVIE = true;
  var SUPPORTS_TV    = true;

  async function fetchGet(url, headers) {
    try {
      var response = await fetch(url, { headers: headers, redirect: 'follow' });
      if (!response.ok) {
        console.warn(TAG + ' HTTP ' + response.status + ' for ' + url);
        return null;
      }
      return await response.text();
    } catch (e) {
      console.warn(TAG + ' Network error: ' + e.message);
      return null;
    }
  }

  async function fetchPost(url, body, headers) {
    try {
      var response = await fetch(url, {
        method: 'POST',
        headers: headers,
        body: body,
        redirect: 'follow',
      });
      if (!response.ok) {
        console.warn(TAG + ' HTTP ' + response.status + ' for POST ' + url);
        return null;
      }
      return await response.text();
    } catch (e) {
      console.warn(TAG + ' Network error POST: ' + e.message);
      return null;
    }
  }

  async function extract(tmdbId, imdbId, title, isTv, season, episode, year) {
    try {
      if (isTv && !SUPPORTS_TV)    { console.log(TAG + ' ⏭️ Skipping — TV not supported'); return null; }
      if (!isTv && !SUPPORTS_MOVIE) { console.log(TAG + ' ⏭️ Skipping — Movies not supported'); return null; }

      var headers = {
        'User-Agent': USER_AGENT,
        Referer: 'https://player.videasy.to/',
        Origin: 'https://player.videasy.to',
        Accept: '*/*',
      };

      var decryptHeaders = {
        'Content-Type': 'application/json',
        Accept: 'application/json, text/plain, */*',
        'User-Agent': USER_AGENT,
        Referer: 'https://player.videasy.to/',
      };
      var decryptUrl = 'https://enc-dec.app/api/dec-videasy';

      // Step 1: Fetch seed (required for enc=2 API)
      console.log(TAG + ' 🌱 Fetching seed for tmdbId=' + tmdbId);
      var seedRaw = await fetchGet(DOMAIN + '/seed?mediaId=' + tmdbId, headers);
      if (!seedRaw) { console.warn(TAG + ' ❌ Failed to get seed'); return null; }
      var seedJson;
      try { seedJson = JSON.parse(seedRaw); } catch (_) { console.warn(TAG + ' ❌ Invalid seed JSON'); return null; }
      var seed = seedJson.seed;
      if (!seed) { console.warn(TAG + ' ❌ Seed missing in response'); return null; }
      console.log(TAG + ' ✅ Got seed: ' + seed);

      // Step 2: Double-encode title (intentional — API expects this format)
      var encTitle = encodeURIComponent(encodeURIComponent(title || ''));

      // Step 3: Try each server in order
      // cdn (Yoru) = movies only, may have 4K
      var servers = ['jett', 'cdn', 'tejo', 'neon2', 'ym', 'downloader2', 'm4uhd', 'hdmovie'];

      for (var i = 0; i < servers.length; i++) {
        var server = servers[i];

        // cdn (Yoru) is movies only
        if (server === 'cdn' && isTv) {
          console.log(TAG + ' [' + server + '] Skipping — movies only server');
          continue;
        }

        var url =
          DOMAIN + '/' + server + '/sources-with-title' +
          '?title=' + encTitle +
          '&mediaType=' + (isTv ? 'tv' : 'movie') +
          '&year=' + (year || '') +
          '&tmdbId=' + tmdbId +
          '&imdbId=' + (imdbId || '') +
          '&enc=2' +
          '&seed=' + seed;

        if (isTv) url += '&episodeId=' + episode + '&seasonId=' + season;

        console.log(TAG + ' [' + server + '] Fetching sources...');
        var textDetail = await fetchGet(url, headers);

        if (!textDetail || textDetail.trim() === '') {
          console.warn(TAG + ' [' + server + '] Empty response — trying next server');
          continue;
        }
        console.log(TAG + ' [' + server + '] Got encrypted data (len=' + textDetail.length + ')');

        // Step 4: Decrypt — send text + id + seed
        var decryptResponse = await fetchPost(
          decryptUrl,
          JSON.stringify({ text: textDetail, id: tmdbId, seed: seed }),
          decryptHeaders
        );
        if (!decryptResponse) {
          console.warn(TAG + ' [' + server + '] Decrypt failed — trying next server');
          continue;
        }

        var decryptJson;
        try { decryptJson = JSON.parse(decryptResponse); } catch (_) {
          console.warn(TAG + ' [' + server + '] Invalid decrypt JSON — trying next server');
          continue;
        }

        var result = decryptJson && decryptJson.result;
        var sources = result && result.sources;

        if (!Array.isArray(sources) || sources.length === 0) {
          console.warn(TAG + ' [' + server + '] No sources — trying next server');
          continue;
        }

        var directQuality = [];
        for (var j = 0; j < sources.length; j++) {
          var source = sources[j];
          var sourceUrl = source.url || '';
          var qualityStr = source.quality || '1080';
          var qualityMatch = qualityStr.toString().match(/(\d+)/);
          var quality = qualityMatch ? parseInt(qualityMatch[1], 10) : 1080;
          if (sourceUrl) directQuality.push({ file: sourceUrl, quality: quality });
        }

        var subtitlesList = [];
        if (Array.isArray(result.subtitles)) {
          for (var k = 0; k < result.subtitles.length; k++) {
            var sub = result.subtitles[k];
            var subUrl = sub.url || '';
            var lang = sub.language || sub.label || 'Unknown';
            if (subUrl) subtitlesList.push({ url: subUrl, lang: lang, label: lang });
          }
        }

        if (directQuality.length === 0) {
          console.warn(TAG + ' [' + server + '] No valid quality variants — trying next server');
          continue;
        }

        directQuality.sort(function (a, b) { return b.quality - a.quality; });
        var parsedQualities = directQuality.map(function (q) {
          return { url: q.file, quality: q.quality + 'p' };
        });

        console.log(TAG + ' [' + server + '] ✅ Found ' + parsedQualities.length + ' sources + ' + subtitlesList.length + ' subtitles');

        return {
          url: parsedQualities[0].url,
          quality: parsedQualities[0].quality,
          qualities: parsedQualities,
          provider: 'Videasy',
          headers: {
            'User-Agent': USER_AGENT,
            Referer: 'https://player.videasy.to/',
            Origin: 'https://player.videasy.to',
          },
          subtitles: subtitlesList,
        };
      }

      console.warn(TAG + ' ⚠️ All Videasy servers exhausted');
      return null;
    } catch (e) {
      console.error(TAG + ' Error during extraction', e);
      return null;
    }
  }

  module.exports = { extract: extract };
})();
