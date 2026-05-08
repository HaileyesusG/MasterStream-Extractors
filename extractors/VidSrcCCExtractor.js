/**
 * VidSrcCCExtractor — self-contained CommonJS JS for remote hot-update.
 * Hosted at: HaileyesusG/MasterStream-Extractors/extractors/VidSrcCCExtractor.js
 */
(function () {
  var TAG = '[VidSrcCCExtractor]';
  var DOMAIN = 'https://vidsrc.cc';
  var USER_AGENT =
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36';

  function regexFirst(input, pattern) {
    var match = input.match(new RegExp(pattern, 'i'));
    return match ? match[1] : null;
  }

  async function fetchUrl(url, headers) {
    try {
      var fetchHeaders = Object.assign({ 'User-Agent': USER_AGENT }, headers || {});
      var response = await fetch(url, { headers: fetchHeaders, redirect: 'follow' });
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

  async function extract(tmdbId, imdbId, isTv, season, episode) {
    try {
      var headers = {
        'User-Agent': USER_AGENT,
        Referer: DOMAIN + '/',
        Origin: DOMAIN,
      };

      var urlDetail = isTv
        ? DOMAIN + '/v2/embed/tv/' + tmdbId + '/' + season + '/' + episode + '?autoPlay=false'
        : DOMAIN + '/v2/embed/movie/' + tmdbId + '?autoPlay=false';

      console.log(TAG + ' 🚀 Fetching embed: ' + urlDetail);

      var textDetail = await fetchUrl(urlDetail, headers);
      if (!textDetail) return null;

      var userId = regexFirst(textDetail, 'userId *= *"([^"]+)');
      if (!userId) { console.warn(TAG + ' ❌ No userId found'); return null; }
      console.log(TAG + ' 🔍 Found userId: ' + userId);

      var v = regexFirst(textDetail, 'var *v *= *"([^"]+)');
      if (!v) { console.warn(TAG + ' ❌ No v found'); return null; }
      console.log(TAG + ' 🔍 Found v: ' + v);

      var reversedKey = 'BxRJ3LYEj2'.split('').reverse().join('');
      var vrfUrl = 'https://aquariumtv.app/vidsrccc?id=' + tmdbId + '&user_id=' + reversedKey + '_' + userId;
      console.log(TAG + ' 🔑 Fetching VRF from: ' + vrfUrl);

      var vrf = await fetchUrl(vrfUrl, {});
      if (!vrf || vrf.trim() === '') { console.warn(TAG + ' ❌ Empty VRF response'); return null; }
      console.log(TAG + ' 🔑 Got VRF (len=' + vrf.length + ')');

      headers['Referer'] = urlDetail;
      var cleanVrf = encodeURIComponent(vrf.trim());
      var apiUrl = DOMAIN + '/api/' + tmdbId + '/servers?id=' + tmdbId +
        '&type=' + (isTv ? 'tv' : 'movie') + '&v=' + v + '&vrf=' + cleanVrf + '&imdbId=' + (imdbId || '');
      console.log(TAG + ' 📡 Fetching servers: ' + apiUrl);

      var srcIdsJson = await fetchUrl(apiUrl, headers);
      if (!srcIdsJson) return null;

      var srcIdsObj;
      try { srcIdsObj = JSON.parse(srcIdsJson); } catch (_) {
        console.error(TAG + ' ❌ Failed to parse servers JSON'); return null;
      }

      var dataArr = srcIdsObj && srcIdsObj.data;
      if (!Array.isArray(dataArr) || dataArr.length === 0) {
        console.warn(TAG + ' ❌ No server data found'); return null;
      }

      for (var i = 0; i < dataArr.length; i++) {
        var item = dataArr[i];
        var hash = item.hash || '';
        if (!hash) continue;

        var directUrl = DOMAIN + '/api/source/' + hash;
        console.log(TAG + ' 📡 Fetching source: ' + directUrl);

        var resJson = await fetchUrl(directUrl, headers);
        if (!resJson) continue;

        var resObj;
        try { resObj = JSON.parse(resJson); } catch (_) { continue; }

        var resData = resObj && resObj.data;
        if (!resData) continue;

        var sourceUrl = resData.source || '';
        if (!sourceUrl) continue;

        var subtitlesList = [];
        if (Array.isArray(resData.subtitles)) {
          for (var j = 0; j < resData.subtitles.length; j++) {
            var sub = resData.subtitles[j];
            var label = sub.label || '';
            if (!label) continue;
            var parseLangMatch = label.match(/([A-Za-z0-9]+)/);
            var parseLang = parseLangMatch ? parseLangMatch[1].trim() : '';
            var file = sub.file || '';
            if (file && parseLang) {
              subtitlesList.push({ url: file, lang: parseLang, label: parseLang });
            }
          }
        }

        console.log(TAG + ' ✅ Found source + ' + subtitlesList.length + ' subtitles');
        return {
          url: sourceUrl,
          quality: '1080p',
          provider: 'VidSrcCC',
          headers: headers,
          subtitles: subtitlesList,
        };
      }

      console.warn(TAG + ' ❌ No sources found from any server hash');
      return null;
    } catch (e) {
      console.error(TAG + ' 💥 Error during extraction', e);
      return null;
    }
  }

  module.exports = { extract: extract };
})();
