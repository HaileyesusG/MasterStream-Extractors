/**
 * VidVault / NHD Remote Extractor
 * Hybrid high-speed MKV & MP4 worker stream extractor.
 * Integrates direct NHD math solver + VidVault fallback.
 * CommonJS format for MasterStream-Extractors GitHub repo.
 */

const NHD_BASE = 'https://nhdapi.st/api';
const VIDVAULT_BASE = 'https://vidvault.ru/api';
const BACKEND_URL = 'https://backendmasterstream.onrender.com/api/cinejoy/vidvault';
const PRIMARY_WORKER = 'https://vlaq11.site';
const SUBTITLE_WORKER = 'https://sub.k5s7sjozpn.workers.dev';

const DEFAULT_USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

const MANDATORY_HEADERS = {
  'User-Agent': DEFAULT_USER_AGENT,
  'Referer': 'https://vidvault.ru/',
  'Origin': 'https://vidvault.ru',
};

async function extract(tmdbId, isTv, season, episode, title) {
  try {
    const type = isTv ? 'tv' : 'movie';
    const safeTitle = encodeURIComponent(title || 'MasterStream_Download');

    // ─── ENGINE 1: NHD Direct Math Solver (Fastest, 0 Cost) ────────────────
    try {
      let nhdUrl = NHD_BASE + '/dl-captcha?mediaType=' + type + '&id=' + tmdbId;
      if (isTv) {
        nhdUrl += '&season=' + (season || 1) + '&episode=' + (episode || 1);
      }

      const captchaRes = await fetch(nhdUrl, {
        headers: {
          'User-Agent': DEFAULT_USER_AGENT,
          'Referer': 'https://nhdapi.st/dl/' + type + '/' + tmdbId,
        },
      });

      if (captchaRes.ok) {
        const captchaData = await captchaRes.json();
        if (captchaData && captchaData.success && captchaData.token && typeof captchaData.a === 'number' && typeof captchaData.b === 'number') {
          const answer = String(captchaData.a + captchaData.b);

          const verifyRes = await fetch(NHD_BASE + '/dl-verify', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'User-Agent': DEFAULT_USER_AGENT,
              'Referer': 'https://nhdapi.st/dl/' + type + '/' + tmdbId,
            },
            body: JSON.stringify({
              token: captchaData.token,
              answer: answer,
            }),
          });

          if (verifyRes.ok) {
            const verifyData = await verifyRes.json();
            if (verifyData && verifyData.success && Array.isArray(verifyData.sources) && verifyData.sources.length > 0) {
              const nhdQualities = [];
              const rawSources = verifyData.sources;

              // Filter specifically for direct playable CDN / worker streams
              const playable = rawSources.filter(function (s) {
                if (!s || !s.url) return false;
                const u = s.url;
                if (
                  u.includes('/drive/admin') ||
                  u.includes('pixeldrain.dev') ||
                  u.includes('hubcloud.cx/tg/') ||
                  u.includes('itsnitrox.tech')
                ) {
                  return false;
                }
                return (
                  u.includes('workers.dev') ||
                  u.includes('r2.cloudflarestorage.com') ||
                  u.includes('googleusercontent') ||
                  u.includes('.mp4') ||
                  u.includes('.mkv')
                );
              });

              playable.forEach(function (item) {
                const label = item.label || '';
                let q = '1080p (MKV)';
                if (label.includes('2160p') || label.includes('4K')) q = '4K (MKV)';
                else if (label.includes('1080p') || label.includes('1080')) q = '1080p (MKV)';
                else if (label.includes('720p') || label.includes('720')) q = '720p (MKV)';
                else if (label.includes('480p') || label.includes('480')) q = '480p (MKV)';
                else if (label.includes('360p') || label.includes('360')) q = '360p (MP4)';

                let fullLabel = q;
                if (label.includes('Original')) fullLabel += ' (Original)';
                else if (label.includes('English')) fullLabel += ' (English)';
                else if (label.includes('Atmos') || label.includes('Multi')) fullLabel += ' (Atmos)';
                else if (label.includes('Hindi')) fullLabel += ' (Hindi)';

                if (!nhdQualities.some(function (x) { return x.url === item.url; })) {
                  nhdQualities.push({
                    quality: fullLabel,
                    url: item.url,
                  });
                }
              });

              if (nhdQualities.length > 0) {
                return {
                  url: nhdQualities[0].url,
                  quality: nhdQualities[0].quality,
                  provider: 'VidVault',
                  headers: {
                    'User-Agent': DEFAULT_USER_AGENT,
                    'Referer': 'https://vidvault.ru/',
                  },
                  qualities: nhdQualities,
                  subtitles: [],
                };
              }
            }
          }
        }
      }
    } catch (_) {}

    // ─── ENGINE 2: VidVault Direct Token Proxy ──────────────────────────────
    let accessPass = null;
    try {
      const passRes = await fetch(BACKEND_URL + '/pass');
      if (passRes.ok) {
        const passData = await passRes.json();
        if (passData && passData.pass) accessPass = passData.pass;
      }
    } catch (_) {}

    let token = null;
    try {
      const tokenRes = await fetch(VIDVAULT_BASE + '/get-token', { headers: MANDATORY_HEADERS });
      if (tokenRes.ok) {
        const tokenData = await tokenRes.json();
        token = tokenData && tokenData.t;
      }
    } catch (_) {}

    let data = null;
    if (token) {
      const body = { type: type, tmdbId: tmdbId };
      if (isTv) {
        body.season = season || 1;
        body.episode = episode || 1;
      }

      const headers = {
        'Content-Type': 'application/json',
        'x-request-token': token,
        'User-Agent': DEFAULT_USER_AGENT,
        'Referer': 'https://vidvault.ru/',
        'Origin': 'https://vidvault.ru',
      };
      if (accessPass) headers['x-access-pass'] = accessPass;

      try {
        const proxyRes = await fetch(VIDVAULT_BASE + '/download-proxy', {
          method: 'POST',
          headers: headers,
          body: JSON.stringify(body),
        });
        if (proxyRes.ok) data = await proxyRes.json();
      } catch (_) {}
    }

    // ─── ENGINE 3: Backend Extraction Fallback ───────────────────────────────
    if (!data) {
      try {
        let fallbackUrl = BACKEND_URL + '/extract?tmdbId=' + tmdbId + '&type=' + type;
        if (isTv) fallbackUrl += '&season=' + (season || 1) + '&episode=' + (episode || 1);
        if (title) fallbackUrl += '&title=' + encodeURIComponent(title);
        const backRes = await fetch(fallbackUrl);
        if (backRes.ok) {
          const backData = await backRes.json();
          if (backData && backData.ok && backData.url) return backData;
        }
      } catch (_) {}
      return null;
    }

    const mkvQualities = [];
    const mp4Qualities = [];

    const addQuality = function (targetList, qualityStr, streamUrl) {
      if (!streamUrl) return;
      if (!targetList.some(function (q) { return q.quality === qualityStr || q.url === streamUrl; })) {
        targetList.push({ quality: qualityStr, url: streamUrl });
      }
    };

    // Parse MKV V3 / V2 / V1
    const mkvV3 = data && data.mkvV3Data;
    const v3Files = Array.isArray(mkvV3) ? mkvV3 : Array.isArray(mkvV3 && mkvV3.files) ? mkvV3.files : (mkvV3 && mkvV3.url) ? [mkvV3] : [];
    v3Files.forEach(function (file) {
      if (file && file.url) {
        const qLabel = file.quality ? (file.quality.replace(/p$/i, '') + 'p (MKV)') : '1080p (MKV)';
        addQuality(mkvQualities, qLabel, file.url);
      }
    });

    const mkvV2 = data && data.mkvV2Data;
    const v2Files = Array.isArray(mkvV2) ? mkvV2 : Array.isArray(mkvV2 && mkvV2.files) ? mkvV2.files : (mkvV2 && mkvV2.url) ? [mkvV2] : [];
    v2Files.forEach(function (file) {
      if (file && file.url) {
        const qLabel = file.quality ? (file.quality.replace(/p$/i, '') + 'p (MKV)') : '720p (MKV)';
        addQuality(mkvQualities, qLabel, file.url);
      }
    });

    const mkvData = data && data.mkvData;
    const mkvFiles = Array.isArray(mkvData) ? mkvData : Array.isArray(mkvData && mkvData.files) ? mkvData.files : (mkvData && mkvData.url) ? [mkvData] : [];
    mkvFiles.forEach(function (file) {
      if (file && file.url) {
        const qLabel = file.quality ? `${file.quality.replace(/p$/i, '')}p (MKV)` : '480p (MKV)';
        addQuality(mkvQualities, qLabel, file.url);
      }
    });

    // Parse MP4s
    const mp4Data = data && data.mp4Data;
    const downloadInfoData = (mp4Data && mp4Data.downloadInfo && mp4Data.downloadInfo.data) || (mp4Data && mp4Data.data) || (data && data.data);
    const downloads = (downloadInfoData && (downloadInfoData.downloads || downloadInfoData.streams)) || [];

    downloads.forEach(function (item) {
      if (!item || !item.url) return;
      const resNum = item.resolution || item.resolutions;
      const qualityStr = resNum ? (resNum + 'p') : 'Auto';
      const workerUrl = PRIMARY_WORKER + '/' + encodeURIComponent(item.url) + '?n=' + safeTitle;
      addQuality(mp4Qualities, qualityStr, workerUrl);
    });

    mp4Qualities.sort(function (a, b) { return (parseInt(b.quality) || 0) - (parseInt(a.quality) || 0); });

    const allQualities = mkvQualities.length > 0 ? mkvQualities : mp4Qualities;
    if (allQualities.length === 0) return null;

    // Parse Subtitles
    const subtitles = [];
    const captions = (downloadInfoData && downloadInfoData.captions) || [];
    captions.forEach(function (cap) {
      if (cap && cap.url && cap.lanName) {
        subtitles.push({
          label: cap.lanName,
          lang: cap.lanCode || cap.lanName,
          url: SUBTITLE_WORKER + '/?url=' + encodeURIComponent(cap.url) + '&title=' + safeTitle,
          headers: MANDATORY_HEADERS,
        });
      }
    });

    const bestQuality = allQualities[0];

    return {
      url: bestQuality.url,
      quality: bestQuality.quality,
      provider: 'VidVault',
      headers: MANDATORY_HEADERS,
      qualities: allQualities,
      subtitles: subtitles,
    };
  } catch (e) {
    return null;
  }
}

module.exports = { extract };
