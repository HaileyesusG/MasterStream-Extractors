/**
 * VideasyExtractor — self-contained CommonJS JS for remote hot-update.
 * Hosted at: HaileyesusG/MasterStream-Extractors/extractors/VideasyExtractor.js
 *
 * Reference: https://github.com/smy778/EncDecEndpoints/blob/main/samples/videasy.py
 *
 * Servers (api.wecollege.net):
 *   Miami      Original     https://api.wecollege.net/miami/sources [May have 4K]
 *   Boise      Original     https://api.wecollege.net/boise/sources [May have 4K]
 *   Vegas      Original     https://api.wecollege.net/vegas/sources
 *   Reno       Original     https://api.wecollege.net/reno/sources
 *   Oakland    Original     https://api.wecollege.net/oakland/sources
 *   Seattle    Original     https://api.wecollege.net/seattle/sources
 *   Phoenix    Original     https://api.wecollege.net/phoenix/sources
 *   Atlanta    Original     https://api.wecollege.net/atlanta/sources
 *   Portland   Original     https://api.wecollege.net/portland/sources
 *   Austin     Original     https://api.wecollege.net/austin/sources [FILTERS quality == "English"]
 *   Dallas     Original     https://api.wecollege.net/dallas/sources
 *   Tampa      Original     https://api.wecollege.net/tampa/sources
 *   Orlando    Original     https://api.wecollege.net/orlando/sources
 */
(function () {
  'use strict';

  var TAG = '[VideasyExtractor]';
  var DOMAIN = 'https://api.wecollege.net';
  var DEC_API = 'https://enc-dec.app/api/dec-videasy';
  var TMDB_API_KEY = 'a2dc7e427ce7dc4a54a518f239a51909';
  var USER_AGENT =
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36';

  var SUPPORTS_MOVIE = true;
  var SUPPORTS_TV = true;

  var HEADERS = {
    Accept: '*/*',
    Origin: 'https://vidy.st',
    Referer: 'https://vidy.st/',
    'User-Agent': USER_AGENT,
  };

  async function fetchGet(url, headers) {
    try {
      var response = await fetch(url, { headers: headers, redirect: 'follow' });
      if (!response.ok) {
        console.warn(TAG + ' HTTP ' + response.status + ' for ' + url);
        return null;
      }
      return await response.text();
    } catch (e) {
      console.warn(TAG + ' Network error: ' + (e.message || e));
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
      console.warn(TAG + ' Network error POST: ' + (e.message || e));
      return null;
    }
  }

  async function resolveMetadata(tmdbId, isTv, existingTitle, existingYear) {
    var title = existingTitle;
    var year = existingYear;
    if (title && year) return { title: title, year: year };

    try {
      var ep = isTv ? 'tv/' : 'movie/';
      var url = 'https://api.themoviedb.org/3/' + ep + tmdbId + '?api_key=' + TMDB_API_KEY;
      var res = await fetch(url);
      if (res.ok) {
        var data = await res.json();
        if (!title) {
          title = isTv ? (data.name || data.original_name) : (data.title || data.original_title);
        }
        if (!year) {
          var dateStr = isTv ? data.first_air_date : data.release_date;
          if (dateStr && dateStr.length >= 4) {
            year = dateStr.slice(0, 4);
          }
        }
      }
    } catch (_) {}

    return { title: title || '', year: year || '' };
  }

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

      result.audioTracks = [
        {
          language: 'English',
          url: result.url,
          qualities: englishQualities,
        },
        {
          language: amharicLabel,
          url: amharicUrl,
          qualities: amharicQualities,
        },
      ];


      console.log(TAG + ' 🇪🇹 Attached Amharic audio track (.mp4 redirect) to result');
    } catch (attachErr) {}
    return result;
  }

  async function extract(tmdbId, arg1, arg2, arg3, arg4, arg5, arg6) {
    var isTv, season, episode, title, imdbId, year;

    // Detect calling convention:
    // Mobile 4-param: (tmdbId, isTv, season, episode)
    // Mobile 5-param: (tmdbId, imdbId, isTv, season, episode)
    // TV / Full 7-param: (tmdbId, imdbId, title, isTv, season, episode, year)
    if (typeof arg1 === 'boolean') {
      isTv = arg1;
      season = arg2;
      episode = arg3;
      imdbId = null;
      title = null;
      year = null;
    } else if (typeof arg2 === 'boolean') {
      imdbId = arg1;
      isTv = arg2;
      season = arg3;
      episode = arg4;
      title = null;
      year = null;
    } else {
      imdbId = arg1;
      title = typeof arg2 === 'string' ? arg2 : null;
      isTv = arg3;
      season = arg4;
      episode = arg5;
      year = arg6;
    }

    try {
      if (isTv && !SUPPORTS_TV) {
        console.log(TAG + ' ⏭️ Skipping — TV not supported');
        return null;
      }
      if (!isTv && !SUPPORTS_MOVIE) {
        console.log(TAG + ' ⏭️ Skipping — Movies not supported');
        return null;
      }

      var meta = await resolveMetadata(tmdbId, isTv, title, year);
      title = meta.title;
      year = meta.year;

      // Special case: Lupin (TMDB 96677 / tt2531336) Season 3+ has French audio / broken streams on Videasy
      var isLupinS3Plus = (
        String(tmdbId) === '96677' ||
        (typeof imdbId === 'string' && imdbId === 'tt2531336') ||
        (title && /lupin/i.test(title))
      ) && isTv && Number(season) >= 3;

      if (isLupinS3Plus) {
        console.log(TAG + ' ⏭️ Skipping Lupin S' + season + ' on Videasy — deferring to CineJoy for English audio');
        return null;
      }

      // Step 1: Fetch seed (required for enc=2 API)
      console.log(TAG + ' 🌱 Fetching seed for tmdbId=' + tmdbId);
      var seedRaw = await fetchGet(DOMAIN + '/seed?mediaId=' + tmdbId, HEADERS);
      if (!seedRaw) {
        console.warn(TAG + ' ❌ Failed to get seed');
        return null;
      }
      var seedJson;
      try {
        seedJson = JSON.parse(seedRaw);
      } catch (_) {
        console.warn(TAG + ' ❌ Invalid seed JSON');
        return null;
      }
      var seed = seedJson.seed;
      if (!seed) {
        console.warn(TAG + ' ❌ Seed missing in response');
        return null;
      }
      console.log(TAG + ' ✅ Got seed: ' + seed);

      // Step 2: Double-encode title (as required by videasy API sample)
      var encTitle = encodeURIComponent(encodeURIComponent(title || ''));

      // Available servers list from videasy sample
      var servers = [
        'miami',
        'boise',
        'vegas',
        'reno',
        'oakland',
        'seattle',
        'phoenix',
        'atlanta',
        'portland',
        'austin',
        'dallas',
        'tampa',
        'orlando',
      ];

      var decryptHeaders = {
        'Content-Type': 'application/json',
        Accept: 'application/json, text/plain, */*',
        'User-Agent': USER_AGENT,
        Referer: 'https://vidy.st/',
      };

      for (var i = 0; i < servers.length; i++) {
        var server = servers[i];

        var url =
          DOMAIN +
          '/' +
          server +
          '/sources?title=' +
          encTitle +
          '&mediaType=' +
          (isTv ? 'tv' : 'movie') +
          '&year=' +
          (year || '') +
          '&tmdbId=' +
          tmdbId +
          '&imdbId=' +
          (imdbId || '') +
          '&enc=2' +
          '&seed=' +
          seed;

        if (isTv) {
          url += '&episodeId=' + (episode || 1) + '&seasonId=' + (season || 1);
        }

        console.log(TAG + ' [' + server + '] Fetching sources...');
        var textDetail = await fetchGet(url, HEADERS);

        if (!textDetail || textDetail.trim() === '') {
          continue;
        }

        // Decrypt sources payload
        var decryptResponse = await fetchPost(
          DEC_API,
          JSON.stringify({ text: textDetail, id: tmdbId, seed: seed }),
          decryptHeaders
        );
        if (!decryptResponse) {
          continue;
        }

        var decryptJson;
        try {
          decryptJson = JSON.parse(decryptResponse);
        } catch (_) {
          continue;
        }

        if (!decryptJson || decryptJson.status !== 200 || !decryptJson.result) {
          continue;
        }

        var result = decryptJson.result;
        var rawSources = result.sources;
        if (!Array.isArray(rawSources) || rawSources.length === 0) {
          continue;
        }

        // For Austin server, prefer English source if present
        if (server === 'austin') {
          var engSource = rawSources.filter(function (s) {
            return (s.quality || '').toLowerCase() === 'english';
          });
          if (engSource.length > 0) {
            rawSources = engSource;
          }
        }

        // Parse qualities
        var directQuality = [];
        for (var j = 0; j < rawSources.length; j++) {
          var source = rawSources[j];
          var sourceUrl = source.url || '';
          if (!sourceUrl) continue;

          // If qixno442run index.m3u8, convert to child playlist to prevent text/html validation block
          if (sourceUrl.indexOf('/index.m3u8') !== -1) {
            sourceUrl = sourceUrl.replace(/\/index\.m3u8$/, '/1080/index.m3u8');
          }

          var qualityStr = source.quality || '1080';
          var qualityMatch = qualityStr.toString().match(/(\d+)/);
          var qualityNum = qualityMatch ? parseInt(qualityMatch[1], 10) : 1080;
          directQuality.push({ file: sourceUrl, quality: qualityNum, label: qualityStr });
        }

        if (directQuality.length === 0) {
          continue;
        }

        directQuality.sort(function (a, b) {
          return b.quality - a.quality;
        });

        var parsedQualities = directQuality.map(function (q) {
          return { url: q.file, quality: q.quality + 'p' };
        });

        // Parse subtitles
        var subtitlesList = [];
        if (Array.isArray(result.subtitles)) {
          for (var k = 0; k < result.subtitles.length; k++) {
            var sub = result.subtitles[k];
            var subUrl = sub.url || sub.file || '';
            var lang = sub.language || sub.label || sub.name || 'Unknown';
            if (subUrl) subtitlesList.push({ url: subUrl, lang: lang, label: lang });
          }
        }

        console.log(
          TAG +
            ' ✅ [' +
            server +
            '] Found ' +
            parsedQualities.length +
            ' sources + ' +
            subtitlesList.length +
            ' subtitles'
        );

        return {
          url: parsedQualities[0].url,
          quality: 'Auto',
          qualities: parsedQualities,
          provider: 'Videasy',
          headers: {
            'User-Agent': USER_AGENT,
            Referer: 'https://vidy.st/',
            Origin: 'https://vidy.st',
          },
          subtitles: subtitlesList,
        };
      }

      console.warn(TAG + ' ⚠️ All Videasy servers exhausted');
      return null;
    } catch (e) {
      console.error(TAG + ' Error during extraction: ' + (e.message || e));
      return null;
    }
  }

  var extractorObj = { extract: extract };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = extractorObj;
  }

  var gObj =
    typeof globalThis !== 'undefined'
      ? globalThis
      : typeof window !== 'undefined'
      ? window
      : typeof global !== 'undefined'
      ? global
      : this;
  if (gObj) {
    gObj.VideasyExtractor = extractorObj;
  }
})();
