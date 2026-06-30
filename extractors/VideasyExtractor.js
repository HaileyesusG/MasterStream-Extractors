/**
 * VideasyExtractor — self-contained CommonJS JS for remote hot-update.
 * Hosted at: HaileyesusG/MasterStream-Extractors/extractors/VideasyExtractor.js
 *
 * To update: edit this file, run Update-Manifest.ps1, commit and push.
 * The app will pick it up within 1 hour (or on next cold start).
 *
 * Server priority order: neon is tried first (best quality/reliability).
 * To reprioritize, just reorder the `servers` array and push.
 */
(function () {
  var TAG = '[VideasyExtractor]';
  var DOMAIN = 'https://api.videasy.to';
  var USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36';

  async function fetchGet(url, headers) {
    try {
      var response = await fetch(url, { headers: headers, redirect: 'follow' });
      if (!response.ok) {
        console.warn(TAG + ' \u274c HTTP ' + response.status + ' for ' + url);
        return null;
      }
      return await response.text();
    } catch (e) {
      console.warn(TAG + ' \u274c Network error: ' + e.message);
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
        console.warn(TAG + ' \u274c HTTP ' + response.status + ' for POST ' + url);
        return null;
      }
      return await response.text();
    } catch (e) {
      console.warn(TAG + ' \u274c Network error POST: ' + e.message);
      return null;
    }
  }

  async function extract(tmdbId, imdbId, title, isTv, season, episode, year) {
    try {
      var headers = {
        'User-Agent': USER_AGENT,
        Referer: 'https://player.videasy.to/',
        Origin: 'https://player.videasy.to',
        Accept: '*/*',
      };

      var decryptHeaders = {
        'Content-Type': 'application/json',
        Accept: 'application/json, text/plain, */*',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/89.0.4389.90 Safari/537.36',
        Referer: 'https://vidsrc-embed.ru/',
      };
      var decryptUrl = 'https://enc-dec.app/api/dec-videasy';

      var encTitle = encodeURIComponent(encodeURIComponent(title));

      // \u2500\u2500 Server priority order \u2014 edit here to change which server is tried first \u2500\u2500
      // neon is first: it has the best quality and reliability.
      var servers = ['neon', 'mb-flix', 'cdn', 'downloader2', '1movies', 'm4uhd', 'hdmovie'];

      // Try each server \u2014 only move on if decrypt returns empty/no sources
      for (var i = 0; i < servers.length; i++) {
        var server = servers[i];
        var url =
          DOMAIN + '/' + server + '/sources-with-title?mediaType=' + (isTv ? 'tv' : 'movie') +
          '&tmdbId=' + tmdbId + '&imdbId=' + (imdbId || '') +
          '&title=' + encTitle;

        if (year) url += '&year=' + year;
        if (isTv) url += '&episodeId=' + episode + '&seasonId=' + season;

        console.log(TAG + ' \ud83d\ude80 [' + server + '] Fetching sources...');
        var textDetail = await fetchGet(url, headers);

        if (!textDetail || textDetail.trim() === '') {
          console.warn(TAG + ' [' + server + '] Empty encrypted response \u2014 trying next server');
          continue;
        }
        console.log(TAG + ' [' + server + '] Got encrypted data (len=' + textDetail.length + ')');

        // Decrypt
        var decryptResponse = await fetchPost(
          decryptUrl,
          JSON.stringify({ text: textDetail, id: tmdbId }),
          decryptHeaders
        );
        if (!decryptResponse) {
          console.warn(TAG + ' [' + server + '] Decrypt request failed \u2014 trying next server');
          continue;
        }

        var decryptJson;
        try { decryptJson = JSON.parse(decryptResponse); } catch (_) {
          console.warn(TAG + ' [' + server + '] Invalid decrypt JSON \u2014 trying next server');
          continue;
        }

        var result = decryptJson && decryptJson.result;
        var sources = result && result.sources;

        if (!Array.isArray(sources) || sources.length === 0) {
          console.warn(TAG + ' [' + server + '] No sources in decrypt result \u2014 trying next server');
          continue;
        }

        // This server returned valid sources \u2014 parse and return
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
          console.warn(TAG + ' [' + server + '] No valid quality variants \u2014 trying next server');
          continue;
        }

        directQuality.sort(function (a, b) { return b.quality - a.quality; });
        var parsedQualities = directQuality.map(function (q) {
          return { url: q.file, quality: q.quality + 'p' };
        });

        console.log(TAG + ' \u2705 [' + server + '] Found ' + parsedQualities.length + ' sources + ' + subtitlesList.length + ' subtitles');

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

      console.warn(TAG + ' \u274c All Videasy servers exhausted');
      return null;
    } catch (e) {
      console.error(TAG + ' \ud83d\udca5 Error during extraction', e);
      return null;
    }
  }

  module.exports = { extract: extract };
})();
