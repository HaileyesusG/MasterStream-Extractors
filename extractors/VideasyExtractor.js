/**
 * VideasyExtractor — self-contained CommonJS JS for remote hot-update.
 * Hosted at: HaileyesusG/MasterStream-Extractors/extractors/VideasyExtractor.js
 *
 * To update: edit this file, bump the hash in manifest.json, push to GitHub.
 * The app will pick it up within 1 hour (or on next cold start).
 */
(function () {
  var TAG = '[VideasyExtractor]';
  var DOMAIN = 'https://api.videasy.to';
  var USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36';

  async function fetchGet(url, headers) {
    try {
      var response = await fetch(url, { headers: headers, redirect: 'follow' });
      if (!response.ok) {
        console.warn(TAG + ' ❌ HTTP ' + response.status + ' for ' + url);
        return null;
      }
      return await response.text();
    } catch (e) {
      console.warn(TAG + ' ❌ Network error: ' + e.message);
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
        console.warn(TAG + ' ❌ HTTP ' + response.status + ' for POST ' + url);
        return null;
      }
      return await response.text();
    } catch (e) {
      console.warn(TAG + ' ❌ Network error POST: ' + e.message);
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

      var encTitle = encodeURIComponent(encodeURIComponent(title));

      var servers = ['mb-flix', 'cdn', 'downloader2', '1movies', 'm4uhd'];
      var textDetail = null;
      var successfulUrl = '';

      for (var i = 0; i < servers.length; i++) {
        var server = servers[i];
        var url =
          DOMAIN + '/' + server + '/sources-with-title?mediaType=' + (isTv ? 'tv' : 'movie') +
          '&tmdbId=' + tmdbId + '&imdbId=' + (imdbId || '') +
          '&title=' + encTitle;

        if (year) {
          url += '&year=' + year;
        }

        if (isTv) {
          url += '&episodeId=' + episode + '&seasonId=' + season;
        }

        console.log(TAG + ' 🚀 Fetching sources from: ' + url);
        textDetail = await fetchGet(url, headers);
        if (textDetail && textDetail.trim() !== '') {
          successfulUrl = url;
          break; // Successfully found data
        } else {
          console.warn(TAG + ' ⚠️ Server ' + server + ' failed or returned empty');
        }
      }

      if (!textDetail || textDetail.trim() === '') {
        console.warn(TAG + ' ❌ Empty response from all videasy servers');
        return null;
      }

      console.log(TAG + ' 🔐 Got encrypted data (len=' + textDetail.length + ')');

      var decryptUrl = 'https://enc-dec.app/api/dec-videasy';
      var decryptBody = JSON.stringify({ text: textDetail, id: tmdbId });
      var decryptHeaders = {
        'Content-Type': 'application/json',
        Accept: 'application/json, text/plain, */*',
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/89.0.4389.90 Safari/537.36',
        Referer: 'https://vidsrc-embed.ru/',
      };

      var decryptResponse = await fetchPost(decryptUrl, decryptBody, decryptHeaders);
      if (!decryptResponse) return null;

      console.log(TAG + ' 🔓 Decrypt response (len=' + decryptResponse.length + ')');

      var decryptJson;
      try {
        decryptJson = JSON.parse(decryptResponse);
      } catch (_) {
        console.error(TAG + ' ❌ Failed to parse decrypt response');
        return null;
      }

      var result = decryptJson && decryptJson.result;
      if (!result) {
        console.warn(TAG + ' ❌ No result in decrypt response');
        return null;
      }

      var sources = result.sources;
      if (!Array.isArray(sources) || sources.length === 0) {
        console.warn(TAG + ' ❌ No sources in decrypt result');
        return null;
      }

      var directQuality = [];
      for (var i = 0; i < sources.length; i++) {
        var source = sources[i];
        var sourceUrl = source.url || '';
        var qualityStr = source.quality || '1080';
        var qualityMatch = qualityStr.toString().match(/(\d+)/);
        var quality = qualityMatch ? parseInt(qualityMatch[1], 10) : 1080;
        if (sourceUrl) {
          directQuality.push({ file: sourceUrl, quality: quality });
        }
      }

      var subtitlesList = [];
      if (Array.isArray(result.subtitles)) {
        for (var j = 0; j < result.subtitles.length; j++) {
          var sub = result.subtitles[j];
          var subUrl = sub.url || '';
          var lang = sub.language || sub.label || 'Unknown';
          if (subUrl) {
            subtitlesList.push({ url: subUrl, lang: lang, label: lang });
          }
        }
      }

      if (directQuality.length === 0) {
        console.warn(TAG + ' ❌ No valid quality variants found');
        return null;
      }

      directQuality.sort(function (a, b) { return b.quality - a.quality; });
      var bestSource = directQuality[0];

      console.log(
        TAG + ' ✅ Found ' + directQuality.length + ' sources + ' +
        subtitlesList.length + ' subtitles, best: ' + bestSource.quality + 'p',
      );

      var parsedQualities = directQuality.map(function (q) {
        return { url: q.file, quality: q.quality + 'p' };
      });

      var streamHeaders = {
        'User-Agent': USER_AGENT,
        Referer: 'https://player.videasy.to/',
        Origin: 'https://player.videasy.to',
      };

      return {
        url: parsedQualities[0].url,
        quality: parsedQualities[0].quality,
        qualities: parsedQualities,
        provider: 'Videasy',
        headers: streamHeaders,
        subtitles: subtitlesList,
      };
    } catch (e) {
      console.error(TAG + ' 💥 Error during extraction', e);
      return null;
    }
  }

  module.exports = { extract: extract };
})();
