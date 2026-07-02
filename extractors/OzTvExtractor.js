(function () {
  'use strict';

  /**
   * OzTvExtractor.js
   * API: https://api.oz-tv.store/moviebox
   * Flow:
   *   1. Fetch title + year from TMDB
   *   2. Search OzTv MovieBox API for the title
   *   3. Multi-pass fuzzy match by title + year
   *   4. For each candidate: fetch dubs → fetch streams + subtitles per dub
   *   5. Return English dub stream (or original if no English)
   */

  const API_BASE       = 'https://api.oz-tv.store/moviebox';
  const PROXY_SECRET   = '4u3fzaHE4pt55YOGmF9Z7SyRglyqHIlC';
  const APP_SIGNATURE  = '46C544DF8BE95646E38D6455A2566C48EDD335987B49378C564709F9E21EE805';
  const TMDB_API_KEY   = 'a2dc7e427ce7dc4a54a518f239a51909';
  const DEVICE_ID      = 'oztvjs-' + Math.random().toString(36).slice(2);
  const PLAY_BASE      = 'https://123movienow.cc/wefeed-h5api-bff/subject';

  function getHeaders() {
    return {
      'X-Request-Lang':     'en',
      'X-Client-Info':      '{"timezone":"UTC"}',
      'X-App-Version-Code': '47',
      'X-App-Version-Name': '3.5.1',
      'X-App-Package':      'com.oziptv.app',
      'X-Device-Id':        DEVICE_ID,
      'X-App-Signature':    APP_SIGNATURE,
      'X-Proxy-Secret':     PROXY_SECRET,
      'Content-Type':       'application/json'
    };
  }

  async function httpGet(url, headers) {
    try {
      const res = await fetch(url, { headers: headers || {} });
      if (!res.ok) return null;
      return res.json();
    } catch (e) {
      console.log('[OzTv] GET error: ' + e.message);
      return null;
    }
  }

  async function httpPost(url, body, headers) {
    try {
      const res = await fetch(url, {
        method:  'POST',
        headers: headers || {},
        body:    JSON.stringify(body)
      });
      if (!res.ok) return null;
      return res.json();
    } catch (e) {
      console.log('[OzTv] POST error: ' + e.message);
      return null;
    }
  }

  // ── TMDB helper ────────────────────────────────────────────────────────────

  async function fetchTmdbInfo(tmdbId, isTv) {
    try {
      const endpoint = isTv ? 'tv' : 'movie';
      const url = 'https://api.themoviedb.org/3/' + endpoint + '/' + tmdbId + '?api_key=' + TMDB_API_KEY;
      const res = await fetch(url);
      if (!res.ok) return {};
      const json = await res.json();
      const title = isTv ? json.name : json.title;
      const dateStr = isTv ? json.first_air_date : json.release_date;
      const year = dateStr && dateStr.length >= 4 ? parseInt(dateStr.substring(0, 4), 10) : null;
      const runtimeMin = json.runtime || null;
      const genres = (json.genres || []).map(function(g) { return g.name.toLowerCase(); });
      return { title, year, runtimeMin, genres };
    } catch (e) {
      return {};
    }
  }

  // ── Matching helpers ───────────────────────────────────────────────────────

  function getItemYear(item) {
    if (item.year && item.year > 0) return item.year;
    if (item.releaseYear && item.releaseYear > 0) return item.releaseYear;
    const dateStr = item.releaseDate || item.date || '';
    if (dateStr.length >= 4) return parseInt(dateStr.substring(0, 4), 10);
    return null;
  }

  function normalize(title) {
    return title.toLowerCase()
      .replace(/\s+\d+\s*:/g, ':')
      .replace(/[^a-z0-9\s]/g, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function scoreItem(item, tmdbRuntimeSec, tmdbGenresSet) {
    const dur = item.duration || 0;
    const durDiff = (tmdbRuntimeSec && dur > 0) ? Math.abs(dur - tmdbRuntimeSec) : 0;
    const itemGenres = (item.genre || '').toLowerCase().split(',').map(function(g) { return g.trim(); }).filter(Boolean);
    let genreOverlap = 0;
    if (tmdbGenresSet && tmdbGenresSet.size > 0) {
      itemGenres.forEach(function(g) { if (tmdbGenresSet.has(g)) genreOverlap++; });
    }
    return durDiff - (genreOverlap * 10000);
  }

  function findAllMatches(items, searchTitle, targetYear, tmdbRuntimeMin, tmdbGenres) {
    const target = searchTitle.toLowerCase();
    const targetNorm = normalize(searchTitle);
    const tmdbRuntimeSec = tmdbRuntimeMin ? tmdbRuntimeMin * 60 : null;
    const tmdbGenresSet = new Set(tmdbGenres || []);
    const results = [];
    const addedPaths = new Set();

    function addIfNew(item) {
      const path = item.detailPath || '';
      if (path && addedPaths.has(path)) return;
      if (path) addedPaths.add(path);
      results.push(item);
    }

    function sortBy(arr, fn) { return arr.slice().sort(function(a, b) { return fn(a) - fn(b); }); }

    // Pass 1: exact title + year
    if (targetYear) {
      const pass1 = items.filter(function(item) {
        const itemTitle = (item.title || '').toLowerCase();
        const itemYear = getItemYear(item);
        return itemTitle === target && itemYear != null && Math.abs(itemYear - targetYear) <= 1;
      });
      if (pass1.length) {
        sortBy(pass1, function(item) { return scoreItem(item, tmdbRuntimeSec, tmdbGenresSet); }).forEach(addIfNew);
      }
    }

    // Pass 2: substring title + year
    if (targetYear) {
      const pass2 = items.filter(function(item) {
        const itemTitle = (item.title || '').toLowerCase();
        const itemYear = getItemYear(item);
        return (itemTitle.includes(target) || target.includes(itemTitle)) &&
               itemYear != null && Math.abs(itemYear - targetYear) <= 1;
      });
      if (pass2.length) {
        sortBy(pass2, function(item) { return Math.abs((item.title || '').length - searchTitle.length); }).forEach(addIfNew);
      }
    }

    // Pass 3: normalized title + year
    if (targetYear) {
      const pass3 = items.filter(function(item) {
        const normItem = normalize(item.title || '');
        const itemYear = getItemYear(item);
        return (normItem === targetNorm || normItem.includes(targetNorm) || targetNorm.includes(normItem)) &&
               itemYear != null && Math.abs(itemYear - targetYear) <= 1;
      });
      if (pass3.length) {
        sortBy(pass3, function(item) { return scoreItem(item, tmdbRuntimeSec, tmdbGenresSet); }).forEach(addIfNew);
      }
    }

    // Pass 4: exact title, year within 2
    const pass4 = items.filter(function(item) {
      if ((item.title || '').toLowerCase() !== target) return false;
      const itemYear = getItemYear(item);
      if (targetYear) return itemYear != null && Math.abs(itemYear - targetYear) <= 2;
      return true;
    });
    if (pass4.length) {
      if (targetYear) {
        sortBy(pass4, function(item) {
          const y = getItemYear(item);
          return y != null ? Math.abs(y - targetYear) : 9999;
        }).forEach(addIfNew);
      } else {
        pass4.forEach(addIfNew);
      }
    }

    // Pass 5: related titles, year within 2
    if (targetYear) {
      items.filter(function(item) {
        const itemTitle = (item.title || '').toLowerCase();
        const normItem = normalize(item.title || '');
        const itemYear = getItemYear(item);
        const related = itemTitle.includes(target) || target.includes(itemTitle) ||
                        normItem.includes(targetNorm) || targetNorm.includes(normItem);
        return related && itemYear != null && Math.abs(itemYear - targetYear) <= 2;
      }).forEach(addIfNew);
    }

    console.log('[OzTv] findAllMatches: ' + results.length + ' candidates for "' + searchTitle + '"');
    return results;
  }

  function sortStreams(streams) {
    return streams.slice().sort(function(a, b) {
      const aHls = (a.format || '').toUpperCase() === 'HLS' || (a.url || '').includes('.m3u8') ? 1 : 0;
      const bHls = (b.format || '').toUpperCase() === 'HLS' || (b.url || '').includes('.m3u8') ? 1 : 0;
      if (bHls !== aHls) return bHls - aHls;
      const parseRes = function(s) {
        const r = s.resolutions || '0';
        return r.toLowerCase() === 'auto' ? 9999 : parseInt(r.replace(/[^0-9]/g, '') || '0', 10);
      };
      return parseRes(b) - parseRes(a);
    }).filter(function(s, i, arr) {
      return s.url && arr.findIndex(function(t) { return t.url === s.url; }) === i;
    });
  }

  // ── Main extraction ────────────────────────────────────────────────────────

  async function extract(tmdbId, imdbId, title, isTv, season, episode, year) {
    try {
      console.log('[OzTv] 🚀 Starting extraction tmdbId=' + tmdbId);

      // 1. Fetch TMDB info
      const tmdbInfo  = await fetchTmdbInfo(tmdbId, isTv);
      const searchTitle = (tmdbInfo.title && tmdbInfo.title.trim()) || title;
      const targetYear  = tmdbInfo.year || (year ? parseInt(year, 10) : null);

      if (!searchTitle) { console.log('[OzTv] ❌ No title'); return null; }

      const hdrs      = getHeaders();
      const subjectType = isTv ? 2 : 1;
      const keyword   = targetYear ? searchTitle + ' ' + targetYear : searchTitle;

      // 2. Search
      console.log('[OzTv] 🔍 Searching: "' + keyword + '"');
      let searchRes = await httpPost(API_BASE + '/search', { keyword, page: 1, perPage: 28, subjectType }, hdrs);
      let items = searchRes && searchRes.data && searchRes.data.items;

      if (!items || !items.length) {
        if (keyword !== searchTitle) {
          console.log('[OzTv] 🔄 Retrying with just title');
          searchRes = await httpPost(API_BASE + '/search', { keyword: searchTitle, page: 1, perPage: 28, subjectType }, hdrs);
          items = searchRes && searchRes.data && searchRes.data.items;
        }
      }

      if (!items || !items.length) { console.log('[OzTv] ❌ No search results'); return null; }

      // 3. Match candidates
      const candidates = findAllMatches(items, searchTitle, targetYear, tmdbInfo.runtimeMin, tmdbInfo.genres);
      if (!candidates.length) { console.log('[OzTv] ❌ No matching candidates'); return null; }

      const se = isTv && season  ? season  : 0;
      const ep = isTv && episode ? episode : 0;

      let bestUrl      = '';
      let bestQuality  = '';
      let bestProvider = 'OzTv';
      let allSubtitles = [];
      let allQualities = [];
      let allAudioTracks = [];
      let refererUrl   = '';

      // 4. Try each candidate
      for (let ci = 0; ci < candidates.length; ci++) {
        const match       = candidates[ci];
        const subjectId   = match.subjectId;
        const detailPath  = match.detailPath || String(subjectId);

        if (!subjectId) continue;
        console.log('[OzTv] 🔄 Candidate ' + (ci + 1) + '/' + candidates.length + ': ' + match.title + ' (id=' + subjectId + ')');

        const detailType = isTv && se > 0 ? '/tv/detail' : '/movie/detail';
        refererUrl = 'https://123movienow.cc/spa/videoPlayPage/movies/' + detailPath +
                     '?id=' + subjectId + '&type=' + detailType + '&detailSe=' + se + '&detailEp=' + ep + '&lang=en';

        // Fetch dubs
        const detailRes = await httpGet(API_BASE + '/detail?id=' + subjectId + '&detailPath=' + detailPath, hdrs);
        let dubs = (detailRes && detailRes.data && (detailRes.data.dubs || (detailRes.data.subject && detailRes.data.subject.dubs)))
                   || match.dubs;

        if (dubs && dubs.length > 0) {
          console.log('[OzTv] ✅ Candidate ' + (ci + 1) + ' has ' + dubs.length + ' dubs');
          let selectedDefault = false;

          // Process all dubs concurrently
          const dubResults = await Promise.all(dubs.map(async function(dub) {
            const dSubjectId   = dub.subjectId || subjectId;
            const dDetailPath  = dub.detailPath || String(dSubjectId);
            const dLangCode    = (dub.lanCode || '').toLowerCase();
            const dLangName    = (dub.lanName || '').toLowerCase();
            const isEnglish    = dLangCode === 'en' || dLangName.includes('english');
            const isOriginal   = !!dub.original;

            const playUrl  = PLAY_BASE + '/play?subjectId=' + dSubjectId + '&se=' + se + '&ep=' + ep + '&detailPath=' + dDetailPath;
            const playHdrs = Object.assign({}, hdrs, { 'Referer': refererUrl });
            const playRes  = await httpGet(playUrl, playHdrs);
            const streams  = playRes && playRes.data && playRes.data.streams;

            if (!streams || !streams.length) return null;
            const sorted     = sortStreams(streams);
            if (!sorted.length) return null;

            const bestStream = sorted[0];
            const streamUrl  = bestStream.url;
            const quality    = bestStream.resolutions || 'Auto';
            const streamId   = bestStream.id || '';
            const streamFmt  = bestStream.format || '';
            const qualities  = sorted.map(function(s) { return { url: s.url, quality: s.resolutions || 'Unknown' }; });

            // Fetch subtitles for this dub
            const subs = [];
            if (streamId && streamFmt) {
              const capUrl  = PLAY_BASE + '/caption?format=' + streamFmt + '&id=' + streamId + '&subjectId=' + dSubjectId + '&detailPath=' + dDetailPath;
              const capHdrs = Object.assign({}, hdrs, { 'Referer': refererUrl });
              const capRes  = await httpGet(capUrl, capHdrs);
              const caps    = capRes && capRes.data && capRes.data.captions;
              if (caps) {
                caps.forEach(function(cap) {
                  if (cap.url && cap.lanName) subs.push({ url: cap.url, lang: cap.lanName, label: cap.lanName });
                });
              }
            }

            return { isEnglish, isOriginal, streamUrl, quality, qualities, lang: dub.lanName || 'Unknown', subtitles: subs };
          }));

          for (const r of dubResults) {
            if (!r) continue;
            allSubtitles = allSubtitles.concat(r.subtitles);
            allAudioTracks.push({ language: r.lang, url: r.streamUrl, qualities: r.qualities });

            if (!selectedDefault || r.isEnglish) {
              bestUrl     = r.streamUrl;
              bestQuality = r.quality;
              allQualities = r.qualities;
              if (r.isEnglish) selectedDefault = true;
            } else if (r.isOriginal && !selectedDefault) {
              bestUrl     = r.streamUrl;
              bestQuality = r.quality;
              allQualities = r.qualities;
              selectedDefault = true;
            }
          }

          if (bestUrl) {
            console.log('[OzTv] ✅ Got stream from candidate ' + (ci + 1));
            break;
          }
        } else {
          // Last candidate or no dubs — legacy single stream path
          if (ci < candidates.length - 1) { console.log('[OzTv] ⚠️ No dubs, trying next candidate'); continue; }
          console.log('[OzTv] ⚠️ Last candidate, fetching single stream...');

          const playUrl  = PLAY_BASE + '/play?subjectId=' + subjectId + '&se=' + se + '&ep=' + ep + '&detailPath=' + detailPath;
          const playHdrs = Object.assign({}, hdrs, { 'Referer': refererUrl });
          const playRes  = await httpGet(playUrl, playHdrs);
          const streams  = playRes && playRes.data && playRes.data.streams;

          if (streams && streams.length) {
            const sorted = sortStreams(streams);
            if (sorted.length) {
              const best = sorted[0];
              bestUrl     = best.url;
              bestQuality = best.resolutions || 'Auto';
              allQualities = sorted.map(function(s) { return { url: s.url, quality: s.resolutions || 'Unknown' }; });
              allAudioTracks.push({ language: 'Default', url: bestUrl, qualities: allQualities });

              const streamId = best.id || '', streamFmt = best.format || '';
              if (streamId && streamFmt) {
                const capUrl  = PLAY_BASE + '/caption?format=' + streamFmt + '&id=' + streamId + '&subjectId=' + subjectId + '&detailPath=' + detailPath;
                const capHdrs = Object.assign({}, hdrs, { 'Referer': refererUrl });
                const capRes  = await httpGet(capUrl, capHdrs);
                const caps    = capRes && capRes.data && capRes.data.captions;
                if (caps) caps.forEach(function(cap) {
                  if (cap.url && cap.lanName) allSubtitles.push({ url: cap.url, lang: cap.lanName, label: cap.lanName });
                });
              }
            }
          }
        }
      }

      if (!bestUrl) { console.log('[OzTv] ❌ No valid stream found'); return null; }

      // Deduplicate subtitles by URL
      const seenSub = new Set();
      allSubtitles = allSubtitles.filter(function(s) {
        if (seenSub.has(s.url)) return false;
        seenSub.add(s.url);
        return true;
      });

      console.log('[OzTv] ✅ Stream: ' + bestUrl.substring(0, 60) + ' subs=' + allSubtitles.length);

      return {
        url:      bestUrl,
        quality:  bestQuality,
        provider: 'OzTv',
        headers: {
          'User-Agent': 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36',
          'Referer':    refererUrl,
          'Origin':     'https://123movienow.cc'
        },
        subtitles:   allSubtitles,
        qualities:   allQualities,
        audioTracks: allAudioTracks
      };

    } catch (e) {
      console.log('[OzTv] ❌ Fatal error: ' + e.message);
      return null;
    }
  }

  module.exports = { extract };
})();
