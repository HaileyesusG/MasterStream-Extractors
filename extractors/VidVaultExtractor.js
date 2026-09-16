/**
 * VidVault Remote Extractor
 * Pure Native VidVault Engine:
 * 1. VidVault Direct Token API (Fast Path - no Cloudflare Turnstile human click verification needed)
 * 2. Native Android WebView Turnstile Bridge (Fallback if challenge occurs)
 * 3. NHD math solver (Backup fallback)
 * CommonJS format for MasterStream-Extractors GitHub repo.
 */

const NHD_BASE = 'https://nhdapi.st/api';
const VIDVAULT_BASE = 'https://vidvault.to/api';
const VIDVAULT_BASE_BACKUP = 'https://vidvault.ru/api';
const BACKEND_URL = 'https://backendmasterstream.onrender.com/api/cinejoy/vidvault';
const PRIMARY_WORKER = 'https://vlaq11.site';
const SUBTITLE_WORKER = 'https://sub.k5s7sjozpn.workers.dev';

const DEFAULT_USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

const MANDATORY_HEADERS = {
  'User-Agent': DEFAULT_USER_AGENT,
  'Referer': 'https://vidvault.to/',
  'Origin': 'https://vidvault.to',
};

async function extract(tmdbId, arg1, arg2, arg3, arg4, arg5) {
  try {
    let isTv, season, episode, title;
    if (typeof arg1 === 'boolean') {
      isTv = arg1;
      season = arg2;
      episode = arg3;
      title = arg4;
    } else if (typeof arg3 === 'boolean') {
      title = arg2;
      isTv = arg3;
      season = arg4;
      episode = arg5;
    } else {
      isTv = !!arg1;
      season = arg2;
      episode = arg3;
      title = arg4;
    }

    const type = isTv ? 'tv' : 'movie';
    const safeTitle = encodeURIComponent(title || 'MasterStream_Download');

    let data = null;

    // ─── ENGINE 1 (PRIMARY): Direct VidVault Token Proxy (Instant Fast Path) ──
    // VidVault no longer requires Cloudflare Turnstile human click verification.
    try {
      let accessPass = null;
      try {
        const passRes = await fetch(BACKEND_URL + '/pass');
        if (passRes.ok) {
          const passData = await passRes.json();
          if (passData && passData.pass) accessPass = passData.pass;
        }
      } catch (_) {}

      const bases = [VIDVAULT_BASE, VIDVAULT_BASE_BACKUP];
      for (const base of bases) {
        let token = null;
        try {
          const tokenRes = await fetch(base + '/get-token', { headers: MANDATORY_HEADERS });
          if (tokenRes.ok) {
            const tokenData = await tokenRes.json();
            token = tokenData && tokenData.t;
          }
        } catch (_) {}

        if (token) {
          const body = { type: type, tmdbId: String(tmdbId) };
          if (isTv) {
            body.season = Number(season) || 1;
            body.episode = Number(episode) || 1;
          }

          const headers = {
            'Content-Type': 'application/json',
            'x-request-token': token,
            ...MANDATORY_HEADERS,
          };
          if (accessPass) headers['x-access-pass'] = accessPass;

          try {
            const proxyRes = await fetch(base + '/download-proxy', {
              method: 'POST',
              headers: headers,
              body: JSON.stringify(body),
            });
            if (proxyRes.ok) {
              data = await proxyRes.json();
              if (data) break;
            }
          } catch (_) {}
        }
      }
    } catch (e) {
      console.log('[VidVault] Direct proxy error: ' + (e && e.message));
    }

    // ─── ENGINE 2: Native Android WebView Bridge (Fallback if Turnstile challenged) ──
    if (!data) {
      try {
        if (
          typeof NativeModules !== 'undefined' &&
          NativeModules &&
          NativeModules.StreamSniffer &&
          typeof NativeModules.StreamSniffer.sniffJson === 'function'
        ) {
          const vidvaultPageUrl = isTv
            ? 'https://vidvault.to/tv/' + tmdbId + '/' + (season || 1) + '/' + (episode || 1)
            : 'https://vidvault.to/movie/' + tmdbId;

          console.log('[VidVault] 🚀 Running Native Turnstile Solver for ' + vidvaultPageUrl);
          const jsonStr = await NativeModules.StreamSniffer.sniffJson(vidvaultPageUrl, 'download-proxy', 25000);
          if (jsonStr) {
            data = JSON.parse(jsonStr);
            console.log('[VidVault] ✅ Native Turnstile Solver succeeded!');
          }
        }
      } catch (e) {
        console.log('[VidVault] ⚠️ Native solver error: ' + (e && e.message));
      }
    }

    // Parse direct VidVault response if obtained from Engine 1 or Engine 2
    if (data) {
      const mkvQualities = [];

      const addQuality = function (targetList, qualityStr, streamUrl) {
        if (!streamUrl) return;
        if (!targetList.some(function (q) { return q.quality === qualityStr || q.url === streamUrl; })) {
          targetList.push({ quality: qualityStr, url: streamUrl });
        }
      };

      // Parse MKV V3 (Direct Cloudflare R2 files)
      const mkvV3 = data && data.mkvV3Data;
      if (mkvV3 && Array.isArray(mkvV3.downloads)) {
        mkvV3.downloads.forEach(function (L) {
          if (!L) return;
          if (Array.isArray(L.qualities)) {
            L.qualities.forEach(function (F) {
              if (!F) return;
              const qLabel = F.quality ? (String(F.quality).replace(/p$/i, '') + 'p (MKV)') : '1080p (MKV)';
              if (Array.isArray(F.episodes)) {
                F.episodes.forEach(function (A) {
                  if (A && A.url) addQuality(mkvQualities, qLabel, A.url);
                });
              } else if (F.url) {
                addQuality(mkvQualities, qLabel, F.url);
              }
            });
          } else if (L.url) {
            const qLabel = L.quality ? (String(L.quality).replace(/p$/i, '') + 'p (MKV)') : '1080p (MKV)';
            addQuality(mkvQualities, qLabel, L.url);
          }
        });
      }
      const v3Files = Array.isArray(mkvV3) ? mkvV3 : Array.isArray(mkvV3 && mkvV3.files) ? mkvV3.files : (mkvV3 && mkvV3.url) ? [mkvV3] : [];
      v3Files.forEach(function (file) {
        if (file && file.url) {
          const qLabel = file.quality ? (String(file.quality).replace(/p$/i, '') + 'p (MKV)') : '1080p (MKV)';
          addQuality(mkvQualities, qLabel, file.url);
        }
      });

      // Parse MKV V2
      const mkvV2 = data && data.mkvV2Data;
      const v2Files = Array.isArray(mkvV2) ? mkvV2 : Array.isArray(mkvV2 && mkvV2.files) ? mkvV2.files : (mkvV2 && mkvV2.url) ? [mkvV2] : [];
      v2Files.forEach(function (file) {
        if (file && file.url) {
          const qLabel = file.quality ? (String(file.quality).replace(/p$/i, '') + 'p (MKV)') : '720p (MKV)';
          addQuality(mkvQualities, qLabel, file.url);
        }
      });

      // Parse MKV V1
      const mkvData = data && data.mkvData;
      const mkvFiles = Array.isArray(mkvData) ? mkvData : Array.isArray(mkvData && mkvData.files) ? mkvData.files : (mkvData && mkvData.url) ? [mkvData] : [];
      mkvFiles.forEach(function (file) {
        if (file && file.url) {
          const qLabel = file.quality ? (String(file.quality).replace(/p$/i, '') + 'p (MKV)') : '480p (MKV)';
          addQuality(mkvQualities, qLabel, file.url);
        }
      });

      // Sort MKVs by resolution descending
      mkvQualities.sort(function (a, b) {
        return (parseInt(b.quality, 10) || 0) - (parseInt(a.quality, 10) || 0);
      });

      // Filter out MP4s - only return MKVs with embedded subtitles
      if (mkvQualities.length > 0) {
        const bestQuality = mkvQualities[0];
        return {
          url: bestQuality.url,
          quality: bestQuality.quality,
          provider: 'VidVault',
          headers: MANDATORY_HEADERS,
          qualities: mkvQualities,
          subtitles: [],
        };
      }
    }

    // ─── ENGINE 3 (FALLBACK): NHD Math Solver ───
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
              const rawSources = verifyData.sources;
              const candidates = rawSources.filter(function (s) {
                if (!s || !s.url) return false;
                const u = s.url;
                return !u.includes('/drive/admin') && !u.includes('pixeldrain.dev') && !u.includes('hubcloud.cx/tg/');
              });

              const nhdQualities = [];
              candidates.forEach(function (item) {
                const label = item.label || '';
                let q = '1080p (MKV)';
                if (label.includes('2160p') || label.includes('4K')) q = '2160p (4K MKV)';
                else if (label.includes('1080p') || label.includes('1080')) q = '1080p (MKV)';
                else if (label.includes('720p') || label.includes('720')) q = '720p (MKV)';
                else if (label.includes('480p') || label.includes('480')) q = '480p (MKV)';

                if (!nhdQualities.some(function (x) { return x.url === item.url; })) {
                  nhdQualities.push({ quality: q, url: item.url });
                }
              });

              if (nhdQualities.length > 0) {
                return {
                  url: nhdQualities[0].url,
                  quality: nhdQualities[0].quality,
                  provider: 'VidVault',
                  headers: MANDATORY_HEADERS,
                  qualities: nhdQualities,
                  subtitles: [],
                };
              }
            }
          }
        }
      }
    } catch (_) {}

    return null;
  } catch (e) {
    return null;
  }
}

module.exports = { extract };
