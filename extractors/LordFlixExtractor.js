(function () {
  'use strict';

  /**
   * LordFlixExtractor.js
   * Domain: https://lordflix.org / https://snowhouse.lordflix.club
   * Flow:
   *   1. Build Snowhouse URL with title/imdb/tmdb/server params
   *   2. enc-lordflix ΓåÆ get signed URL
   *   3. GET signed URL ΓåÆ encrypted payload
   *   4. dec-lordflix ΓåÆ parse stream URL + subtitles
   */

  const DOMAIN     = 'https://lordflix.org';
  const SNOWHOUSE  = 'https://snowhouse.lordflix.club';
  const ENC_DEC    = 'https://enc-dec.app/api';
  const UA         = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36';
  const SERVERS    = ['Berlin', 'Comet', 'Rabbit', 'Phoenix', 'Oslo', 'Luna'];

  async function httpGet(url, extraHeaders) {
    const headers = Object.assign({ 'Accept': '*/*', 'Origin': DOMAIN, 'Referer': DOMAIN + '/', 'User-Agent': UA }, extraHeaders || {});
    const res = await fetch(url, { headers });
    if (!res.ok) return null;
    return res.text();
  }

  async function postJson(url, body) {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'User-Agent': UA, 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    if (!res.ok) return null;
    return res.json();
  }

  async function extract(tmdbId, imdbId, title, isTv, season, episode, year) {
    if (!imdbId) return null;

    const mediaType  = isTv ? 'series' : 'movie';
    const releaseYear = year || '';
    const encTitle   = encodeURIComponent(title || '');

    for (const server of SERVERS) {
      try {
        let url = SNOWHOUSE + '/?title=' + encTitle + '&type=' + mediaType +
                  '&year=' + releaseYear + '&imdb=' + imdbId + '&tmdb=' + tmdbId + '&server=' + server;
        if (isTv) url += '&season=' + season + '&episode=' + episode;

        console.log('[LordFlix] ≡ƒÜÇ Trying server: ' + server);

        // Step 1: enc-lordflix ΓåÆ signed URL
        const encRaw = await httpGet(ENC_DEC + '/enc-lordflix?url=' + encodeURIComponent(url));
        if (!encRaw) continue;
        const encJson = JSON.parse(encRaw);
        if (encJson.status !== 200) { console.log('[LordFlix] ΓÜá∩╕Å enc-lordflix failed: ' + encJson.error); continue; }

        const streamEncUrl = encJson.result.url;
        const sign         = encJson.result.sign;

        // Step 2: Fetch encrypted payload
        const encryptedText = await httpGet(streamEncUrl);
        if (!encryptedText || !encryptedText.trim()) continue;

        // Step 3: dec-lordflix
        const decRaw = await postJson(ENC_DEC + '/dec-lordflix', { text: encryptedText, sign });
        if (!decRaw || decRaw.status !== 200) { console.log('[LordFlix] ΓÜá∩╕Å dec-lordflix failed'); continue; }

        let resultObj = decRaw.result;
        if (typeof resultObj === 'string') {
          if (!resultObj.trim().startsWith('{')) continue;
          resultObj = JSON.parse(resultObj);
        }
        if (!resultObj || resultObj.error) { console.log('[LordFlix] Γ¼¢ ' + server + ': ' + (resultObj && resultObj.error)); continue; }

        const streamUrl = resultObj.url;
        if (!streamUrl) continue;

        const subtitles = [];
        const subList = resultObj.sub && resultObj.sub.list;
        if (subList) {
          for (const sub of subList) {
            if (sub.url && sub.lang) subtitles.push({ url: sub.url, lang: sub.lang, label: sub.label || sub.lang });
          }
        }

        console.log('[LordFlix] Γ£à Stream from ' + server + ': ' + streamUrl.substring(0, 60));
        return {
          url:      streamUrl,
          quality:  'Auto',
          provider: 'LordFlix-' + server,
          headers:  { 'User-Agent': UA, 'Referer': DOMAIN + '/', 'Origin': DOMAIN },
          subtitles
        };
      } catch (e) {
        console.log('[LordFlix] Γ¥î Server ' + server + ' error: ' + e.message);
      }
    }

    console.log('[LordFlix] Γ¥î All servers exhausted');
    return null;
  }

  module.exports = { extract };
})();
