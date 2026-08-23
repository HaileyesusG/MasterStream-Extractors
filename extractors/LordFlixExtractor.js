/**
 * LordFlix / VixSrc Remote Extractor
 * Master Playlist HLS extractor powered by vixsrc.to.
 * Returns the adaptive Master Playlist (quality: 'Auto') with exact embed Referer.
 * CommonJS format for MasterStream-Extractors GitHub repo.
 */

const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

async function extract(tmdbId, arg1, arg2, arg3, arg4, arg5) {
  let isTv, season, episode, title;
  if (typeof arg1 === 'boolean') {
    isTv = arg1;
    season = arg2;
    episode = arg3;
    title = arg4;
  } else {
    title = arg2;
    isTv = arg3;
    season = arg4;
    episode = arg5;
  }

  try {
    const pageReferer = isTv
      ? `https://vixsrc.to/tv/${tmdbId}/${season || 1}/${episode || 1}`
      : `https://vixsrc.to/movie/${tmdbId}`;

    const apiPath = isTv
      ? `https://vixsrc.to/api/tv/${tmdbId}/${season || 1}/${episode || 1}`
      : `https://vixsrc.to/api/movie/${tmdbId}`;

    const apiRes = await fetch(apiPath, {
      headers: {
        'User-Agent': USER_AGENT,
        'Referer': pageReferer,
        'Accept': 'application/json, text/plain, */*',
      },
    });
    if (!apiRes.ok) return null;
    const apiData = await apiRes.json();
    if (!apiData || !apiData.src) return null;

    const embedUrl = 'https://vixsrc.to' + apiData.src;
    const embedRes = await fetch(embedUrl, {
      headers: {
        'User-Agent': USER_AGENT,
        'Referer': pageReferer,
      },
    });
    if (!embedRes.ok) return null;
    const embedHtml = await embedRes.text();

    const tokenMatch = embedHtml.match(/'token':\s*'([^']+)'/);
    const expiresMatch = embedHtml.match(/'expires':\s*'([^']+)'/);
    const urlMatch = embedHtml.match(/url:\s*'([^']+)'/);
    if (!tokenMatch || !expiresMatch || !urlMatch) return null;

    const token = tokenMatch[1];
    const expires = expiresMatch[1];
    const baseUrl = urlMatch[1];

    const playlistUrl = new URL(baseUrl);
    playlistUrl.searchParams.set('token', token);
    playlistUrl.searchParams.set('expires', expires);
    playlistUrl.searchParams.set('h', '1');
    playlistUrl.searchParams.set('lang', 'en');

    // Fetch master playlist to parse subtitles
    const plRes = await fetch(playlistUrl.toString(), {
      headers: {
        'User-Agent': USER_AGENT,
        'Referer': embedUrl,
      },
    });
    if (!plRes.ok) return null;
    const plText = await plRes.text();

    const subtitles = [];
    const subLines = plText.split('\n');
    for (const line of subLines) {
      if (line.includes('TYPE=SUBTITLES')) {
        const nameM = line.match(/NAME="([^"]+)"/);
        const langM = line.match(/LANGUAGE="([^"]+)"/);
        const uriM = line.match(/URI="([^"]+)"/);
        if (nameM && uriM) {
          subtitles.push({
            label: nameM[1],
            lang: langM ? langM[1] : nameM[1],
            url: uriM[1],
          });
        }
      }
    }

    // Return the Master Playlist directly as 'Auto' with exact embedUrl Referer
    // This allows ExoPlayer to bind the demuxed audio + video tracks simultaneously.
    return {
      url: playlistUrl.toString(),
      quality: 'Auto',
      provider: 'LordFlix',
      headers: {
        'User-Agent': USER_AGENT,
        'Referer': embedUrl,
      },
      qualities: [
        {
          quality: 'Auto',
          url: playlistUrl.toString(),
        },
      ],
      subtitles: subtitles,
    };
  } catch (e) {
    return null;
  }
}

module.exports = { extract };
