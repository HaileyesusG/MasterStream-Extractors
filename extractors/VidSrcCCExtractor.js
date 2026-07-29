/**
 * VidSrcCCExtractor — self-contained CommonJS JS for remote hot-update.
 * Hosted at: HaileyesusG/MasterStream-Extractors/extractors/VidSrcCCExtractor.js
 *
 * ⚠️ LordFlix is dead. This slot is now powered by CineJoy (cinejoy.to).
 * Returns results under provider name "VidSrcCC" so no app update needed.
 *
 * Flow (from smy778/EncDecEndpoints/samples/cinejoy.py):
 *  1. GET api.shegu.xyz/servers → pick active server
 *  2. Build api.shegu.xyz URL, encode via enc-dec.app/api/enc-cinejoy → enc token
 *  3. GET api.shegu.xyz/challenge?rid=enc → solve scrypt PoW → x-at header
 *  4. GET api.shegu.xyz/{enc} with x-at → encrypted text
 *  5. POST enc-dec.app/api/dec-cinejoy { text } → stream sources + subtitles
 */
(function () {
  var TAG = '[VidSrcCCExtractor]';
  var SUPPORTS_MOVIE = true;
  var SUPPORTS_TV    = true;

  var API_BASE  = 'https://api.shegu.xyz';
  var ENC_DEC   = 'https://enc-dec.app/api';
  var USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36';

  var BASE_HEADERS = {
    'Accept':     '*/*',
    'Origin':     'https://cinejoy.to',
    'Referer':    'https://cinejoy.to/',
    'User-Agent': USER_AGENT,
  };

  // ── Pure-JS scrypt implementation ────────────────────────────────────────────
  // Implements RFC 7914 scrypt KDF in pure JS — no native deps required.
  // Sufficient for the challenge difficulty levels used by api.shegu.xyz.

  function scrypt(password, salt, N, r, p, dkLen) {
    // salsa20/8 core
    function salsa20_8(B) {
      var x = B.slice();
      for (var i = 0; i < 4; i++) {
        x[ 4] ^= R(x[ 0]+x[12], 7);  x[ 8] ^= R(x[ 4]+x[ 0],9);
        x[12] ^= R(x[ 8]+x[ 4],13);  x[ 0] ^= R(x[12]+x[ 8],18);
        x[ 9] ^= R(x[ 5]+x[ 1], 7);  x[13] ^= R(x[ 9]+x[ 5],9);
        x[ 1] ^= R(x[13]+x[ 9],13);  x[ 5] ^= R(x[ 1]+x[13],18);
        x[14] ^= R(x[10]+x[ 6], 7);  x[ 2] ^= R(x[14]+x[10],9);
        x[ 6] ^= R(x[ 2]+x[14],13);  x[10] ^= R(x[ 6]+x[ 2],18);
        x[ 3] ^= R(x[15]+x[11], 7);  x[ 7] ^= R(x[ 3]+x[15],9);
        x[11] ^= R(x[ 7]+x[ 3],13);  x[15] ^= R(x[11]+x[ 7],18);
        x[ 1] ^= R(x[ 0]+x[ 3], 7);  x[ 2] ^= R(x[ 1]+x[ 0],9);
        x[ 3] ^= R(x[ 2]+x[ 1],13);  x[ 0] ^= R(x[ 3]+x[ 2],18);
        x[ 6] ^= R(x[ 5]+x[ 4], 7);  x[ 7] ^= R(x[ 6]+x[ 5],9);
        x[ 4] ^= R(x[ 7]+x[ 6],13);  x[ 5] ^= R(x[ 4]+x[ 7],18);
        x[11] ^= R(x[10]+x[ 9], 7);  x[ 8] ^= R(x[11]+x[10],9);
        x[ 9] ^= R(x[ 8]+x[11],13);  x[10] ^= R(x[ 9]+x[ 8],18);
        x[12] ^= R(x[15]+x[14], 7);  x[13] ^= R(x[12]+x[15],9);
        x[14] ^= R(x[13]+x[12],13);  x[15] ^= R(x[14]+x[13],18);
      }
      for (var i = 0; i < 16; i++) B[i] = (B[i] + x[i]) >>> 0;
    }
    function R(a, b) { return ((a << b) | (a >>> (32 - b))) >>> 0; }

    // PBKDF2-SHA256 (needed by scrypt)
    function pbkdf2(pass, salt2, c, dkLen2) {
      var hLen = 32;
      var l = Math.ceil(dkLen2 / hLen);
      var dk = new Uint8Array(l * hLen);
      for (var i = 1; i <= l; i++) {
        var U = hmacSha256(pass, concat(salt2, int32be(i)));
        var T = U.slice();
        for (var j = 1; j < c; j++) {
          U = hmacSha256(pass, U);
          for (var k = 0; k < hLen; k++) T[k] ^= U[k];
        }
        dk.set(T, (i - 1) * hLen);
      }
      return dk.slice(0, dkLen2);
    }

    function int32be(n) {
      return new Uint8Array([(n>>>24)&0xff,(n>>>16)&0xff,(n>>>8)&0xff,n&0xff]);
    }
    function concat(a, b) {
      var c = new Uint8Array(a.length + b.length);
      c.set(a); c.set(b, a.length); return c;
    }

    // HMAC-SHA256
    function hmacSha256(key, data) {
      if (key.length > 64) key = sha256(key);
      var ipad = new Uint8Array(64), opad = new Uint8Array(64);
      for (var i = 0; i < 64; i++) {
        ipad[i] = (i < key.length ? key[i] : 0) ^ 0x36;
        opad[i] = (i < key.length ? key[i] : 0) ^ 0x5c;
      }
      return sha256(concat(opad, sha256(concat(ipad, data))));
    }

    // SHA-256
    function sha256(data) {
      var K = [
        0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,
        0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,
        0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,
        0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,
        0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,
        0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,
        0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,
        0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2
      ];
      var msg = Array.from(data);
      msg.push(0x80);
      while (msg.length % 64 !== 56) msg.push(0);
      var bits = data.length * 8;
      msg.push(0,0,0,0,(bits>>>24)&0xff,(bits>>>16)&0xff,(bits>>>8)&0xff,bits&0xff);
      var h0=0x6a09e667,h1=0xbb67ae85,h2=0x3c6ef372,h3=0xa54ff53a;
      var h4=0x510e527f,h5=0x9b05688c,h6=0x1f83d9ab,h7=0x5be0cd19;
      for (var o = 0; o < msg.length; o += 64) {
        var w = [];
        for (var t = 0; t < 16; t++)
          w[t] = ((msg[o+t*4]<<24)|(msg[o+t*4+1]<<16)|(msg[o+t*4+2]<<8)|msg[o+t*4+3])>>>0;
        for (var t = 16; t < 64; t++) {
          var v=w[t-15], s0=((v>>>7)|(v<<25))^((v>>>18)|(v<<14))^(v>>>3);
          var v2=w[t-2],  s1=((v2>>>17)|(v2<<15))^((v2>>>19)|(v2<<13))^(v2>>>10);
          w[t]=(w[t-16]+s0+w[t-7]+s1)>>>0;
        }
        var a=h0,b=h1,c=h2,d=h3,e=h4,f=h5,g=h6,h=h7;
        for (var t = 0; t < 64; t++) {
          var S1=((e>>>6)|(e<<26))^((e>>>11)|(e<<21))^((e>>>25)|(e<<7));
          var ch=(e&f)^((~e>>>0)&g);
          var T1=(h+S1+ch+K[t]+w[t])>>>0;
          var S0=((a>>>2)|(a<<30))^((a>>>13)|(a<<19))^((a>>>22)|(a<<10));
          var maj=(a&b)^(a&c)^(b&c);
          var T2=(S0+maj)>>>0;
          h=g;g=f;f=e;e=(d+T1)>>>0;d=c;c=b;b=a;a=(T1+T2)>>>0;
        }
        h0=(h0+a)>>>0;h1=(h1+b)>>>0;h2=(h2+c)>>>0;h3=(h3+d)>>>0;
        h4=(h4+e)>>>0;h5=(h5+f)>>>0;h6=(h6+g)>>>0;h7=(h7+h)>>>0;
      }
      var out = new Uint8Array(32);
      [h0,h1,h2,h3,h4,h5,h6,h7].forEach(function(v,i){
        out[i*4]=(v>>>24)&0xff; out[i*4+1]=(v>>>16)&0xff;
        out[i*4+2]=(v>>>8)&0xff; out[i*4+3]=v&0xff;
      });
      return out;
    }

    // scryptBlockMix
    function blockMix(B, r) {
      var len = 2 * r;
      var X = toInt32LE(B.slice((len - 1) * 64, len * 64));
      var Y = new Uint8Array(len * 64);
      for (var i = 0; i < len; i++) {
        var Bi = toInt32LE(B.slice(i * 64, (i + 1) * 64));
        for (var j = 0; j < 16; j++) X[j] ^= Bi[j];
        salsa20_8(X);
        var dest = (i % 2 === 0) ? (i / 2) * 64 : (r + Math.floor(i / 2)) * 64;
        Y.set(fromInt32LE(X), dest);
      }
      return Y;
    }

    function toInt32LE(buf) {
      var out = new Array(buf.length / 4);
      for (var i = 0; i < out.length; i++)
        out[i] = (buf[i*4]|(buf[i*4+1]<<8)|(buf[i*4+2]<<16)|(buf[i*4+3]<<24))>>>0;
      return out;
    }
    function fromInt32LE(arr) {
      var out = new Uint8Array(arr.length * 4);
      for (var i = 0; i < arr.length; i++) {
        out[i*4]=arr[i]&0xff; out[i*4+1]=(arr[i]>>>8)&0xff;
        out[i*4+2]=(arr[i]>>>16)&0xff; out[i*4+3]=(arr[i]>>>24)&0xff;
      }
      return out;
    }

    // Main scrypt
    var passBytes = typeof password === 'string' ? strToBytes(password) : password;
    var saltBytes = typeof salt === 'string' ? strToBytes(salt) : salt;

    var B = pbkdf2(passBytes, saltBytes, 1, p * 128 * r);
    for (var i = 0; i < p; i++) {
      var offset = i * 128 * r;
      var Bi = B.slice(offset, offset + 128 * r);
      var V = [];
      var X = Bi.slice();
      for (var j = 0; j < N; j++) { V[j] = X.slice(); X = blockMix(X, r); }
      for (var j = 0; j < N; j++) {
        var Xint = toInt32LE(X.slice((2*r-1)*64, 2*r*64));
        var jj = Xint[0] % N;
        var T = X.slice();
        for (var k = 0; k < T.length; k++) T[k] ^= V[jj][k];
        X = blockMix(T, r);
      }
      B.set(X, offset);
    }
    return pbkdf2(passBytes, B, 1, dkLen);
  }

  function strToBytes(str) {
    var out = new Uint8Array(str.length);
    for (var i = 0; i < str.length; i++) out[i] = str.charCodeAt(i) & 0xff;
    return out;
  }

  // ── Count leading zero bits in Uint8Array ────────────────────────────────────
  function countLeadingZeroBits(data) {
    var count = 0;
    for (var i = 0; i < data.length; i++) {
      if (data[i] === 0) { count += 8; continue; }
      var v = data[i];
      while ((v & 0x80) === 0) { count++; v <<= 1; }
      break;
    }
    return count;
  }

  // ── Hex string → Uint8Array ──────────────────────────────────────────────────
  function hexToBytes(hex) {
    var out = new Uint8Array(hex.length / 2);
    for (var i = 0; i < hex.length; i += 2)
      out[i / 2] = parseInt(hex.substr(i, 2), 16);
    return out;
  }

  // ── base64 encode Uint8Array ─────────────────────────────────────────────────
  function toBase64(bytes) {
    var str = '';
    for (var i = 0; i < bytes.length; i++) str += String.fromCharCode(bytes[i]);
    return btoa(str);
  }

  // ── Solve CineJoy scrypt challenge ──────────────────────────────────────────
  // Returns base64-encoded JSON payload for the x-at header.
  async function solveChallenge(rid) {
    try {
      var resp = await fetch(API_BASE + '/challenge?rid=' + rid, { headers: BASE_HEADERS });
      if (!resp.ok) { console.warn(TAG + ' ⚠️ Challenge fetch failed: ' + resp.status); return null; }
      var ch = JSON.parse(await resp.text());
      // ch = { b, s (hex), n, r, p, d (required leading-zero bits) }
      var salt = hexToBytes(ch.s);
      var maxIter = Math.pow(2, 32);
      console.log(TAG + ' 🧩 Solving scrypt challenge (d=' + ch.d + ')...');
      for (var counter = 0; counter < maxIter; counter++) {
        var payload = ch.b + ':' + ch.s + ':' + counter;
        var result = scrypt(payload, salt, ch.n, ch.r, ch.p, 32);
        if (countLeadingZeroBits(result) >= ch.d) {
          var solved = Object.assign({}, ch, { c: counter });
          var json = JSON.stringify(solved);
          var b64 = btoa(unescape(encodeURIComponent(json)));
          console.log(TAG + ' ✅ Challenge solved at counter=' + counter);
          return b64;
        }
      }
      console.warn(TAG + ' ⚠️ Could not solve challenge within iteration limit');
      return null;
    } catch (e) {
      console.warn(TAG + ' ⚠️ Challenge error: ' + e.message);
      return null;
    }
  }

  // ── HTTP helpers ─────────────────────────────────────────────────────────────
  async function fetchGet(url, headers) {
    try {
      var resp = await fetch(url, { headers: headers || BASE_HEADERS, redirect: 'follow' });
      if (!resp.ok) { console.warn(TAG + ' ❌ HTTP ' + resp.status + ' for ' + url); return null; }
      return await resp.text();
    } catch (e) {
      console.warn(TAG + ' ❌ Network error: ' + e.message); return null;
    }
  }

  async function fetchPost(url, body, headers) {
    try {
      var resp = await fetch(url, { method: 'POST', headers: headers, body: body, redirect: 'follow' });
      if (!resp.ok) { console.warn(TAG + ' ❌ HTTP ' + resp.status + ' POST ' + url); return null; }
      return await resp.text();
    } catch (e) {
      console.warn(TAG + ' ❌ Network POST error: ' + e.message); return null;
    }
  }

  // ── HLS master playlist parser ───────────────────────────────────────────────
  async function parseHlsMaster(masterUrl, fetchHeaders) {
    try {
      var body = await fetchGet(masterUrl, fetchHeaders);
      if (!body || body.indexOf('#EXT-X-STREAM-INF') === -1)
        return [{ file: masterUrl, quality: 1080 }];
      var variants = [];
      var lines = body.split('\n');
      for (var i = 0; i < lines.length; i++) {
        var line = lines[i].trim();
        if (line.indexOf('#EXT-X-STREAM-INF') === 0) {
          var resMatch = line.match(/RESOLUTION=(\d+)x(\d+)/);
          var bwMatch  = line.match(/BANDWIDTH=(\d+)/);
          var height   = resMatch ? parseInt(resMatch[2], 10) : null;
          var nextLine = (lines[i + 1] || '').trim();
          if (!nextLine || nextLine.charAt(0) === '#') continue;
          var varUrl = nextLine;
          if (varUrl.indexOf('http') !== 0) {
            if (varUrl.charAt(0) === '/') {
              var originMatch = masterUrl.match(/^(https?:\/\/[^\/]+)/);
              varUrl = originMatch ? originMatch[1] + varUrl : masterUrl;
            } else {
              varUrl = masterUrl.substring(0, masterUrl.lastIndexOf('/') + 1) + varUrl;
            }
          }
          var quality = height || (bwMatch ? Math.round(parseInt(bwMatch[1],10)/150000)*100 : 1080);
          variants.push({ file: varUrl, quality: quality });
        }
      }
      return variants.length > 0 ? variants : [{ file: masterUrl, quality: 1080 }];
    } catch (_) {
      return [{ file: masterUrl, quality: 1080 }];
    }
  }

  // ── Main extract function ─────────────────────────────────────────────────────
  async function extract(tmdbId, imdbId, arg2, arg3, arg4, arg5, arg6) {
    // Dual calling-convention support:
    //   Mobile: extract(tmdbId, imdbId, isTv, season, episode)
    //   TV:     extract(tmdbId, imdbId, title, isTv, season, episode, year)
    var isTv, season, episode, title, year;
    if (typeof arg2 === 'boolean') {
      isTv = arg2; season = arg3; episode = arg4;             // mobile
    } else {
      title = arg2; isTv = arg3; season = arg4; episode = arg5; year = arg6; // TV
    }

    try {
      if (isTv  && !SUPPORTS_TV)    { console.log(TAG + ' Skip TV');    return null; }
      if (!isTv && !SUPPORTS_MOVIE) { console.log(TAG + ' Skip Movie'); return null; }

      // Step 1: Get server list
      var servers = ['Lisbon', 'Mapple', 'Solara', 'Arrow', 'Leo']; // fallback
      try {
        var srvRaw = await fetchGet(API_BASE + '/servers', BASE_HEADERS);
        if (srvRaw) {
          var srvJson = JSON.parse(srvRaw);
          if (Array.isArray(srvJson.servers) && srvJson.servers.length > 0) {
            servers = srvJson.servers
              .filter(function(s) { return s.status === 'ok'; })
              .map(function(s) { return s.name; });
            console.log(TAG + ' 📡 Servers: ' + servers.join(', '));
          }
        }
      } catch (_) { console.warn(TAG + ' ⚠️ Could not fetch servers, using fallback'); }

      var mediaType = isTv ? 'series' : 'movie';

      for (var i = 0; i < servers.length; i++) {
        var server = servers[i];
        console.log(TAG + ' 🖥️ Trying server: ' + server);

        // Step 2: Build API URL and encode via enc-dec.app
        var apiUrl = API_BASE + '/?type=' + mediaType +
          '&tmdb=' + tmdbId +
          '&server=' + encodeURIComponent(server);
        if (imdbId) apiUrl += '&imdb=' + imdbId;
        if (year)   apiUrl += '&year=' + year;
        if (title)  apiUrl += '&title=' + encodeURIComponent(title);
        if (isTv)   apiUrl += '&season=' + season + '&episode=' + episode;

        var encUrl = ENC_DEC + '/enc-cinejoy?url=' + encodeURIComponent(apiUrl);
        var encRaw = await fetchGet(encUrl, { 'Accept': 'application/json', 'User-Agent': USER_AGENT });
        if (!encRaw) { console.warn(TAG + ' ⚠️ [' + server + '] enc-cinejoy null'); continue; }

        var encJson;
        try { encJson = JSON.parse(encRaw); } catch (_) { continue; }
        if (encJson.status !== 200) { console.warn(TAG + ' ⚠️ [' + server + '] enc status=' + encJson.status + ' ' + encJson.error); continue; }

        var enc = encJson.result;
        if (!enc) { console.warn(TAG + ' ⚠️ [' + server + '] No enc token'); continue; }
        console.log(TAG + ' 🔑 [' + server + '] enc token ok (' + enc.length + ' chars)');

        // Step 3: Solve scrypt challenge
        var xAt = await solveChallenge(enc);
        if (!xAt) { console.warn(TAG + ' ⚠️ [' + server + '] Challenge failed — skipping'); continue; }

        // Step 4: Fetch encrypted media data
        var fetchHeaders = Object.assign({}, BASE_HEADERS, { 'x-at': xAt });
        var encText = await fetchGet(API_BASE + '/' + enc, fetchHeaders);
        if (!encText || encText.trim() === '') { console.warn(TAG + ' ⚠️ [' + server + '] Empty encrypted payload'); continue; }
        console.log(TAG + ' 📦 [' + server + '] Got encrypted data (' + encText.length + ' chars)');

        // Step 5: Decrypt
        var decHeaders = {
          'Content-Type': 'application/json',
          'Accept':       'application/json',
          'User-Agent':   USER_AGENT,
          'Origin':       'https://cinejoy.to',
          'Referer':      'https://cinejoy.to/',
        };
        var decRaw = await fetchPost(ENC_DEC + '/dec-cinejoy', JSON.stringify({ text: encText }), decHeaders);
        if (!decRaw) { console.warn(TAG + ' ⚠️ [' + server + '] dec-cinejoy failed'); continue; }

        var decJson;
        try { decJson = JSON.parse(decRaw); } catch (_) { continue; }
        if (decJson.status !== 200) { console.warn(TAG + ' ⚠️ [' + server + '] dec status=' + decJson.status); continue; }

        var result = decJson.result;
        if (!result || result.error) { console.warn(TAG + ' ⚠️ [' + server + '] ' + (result && result.error || 'no result')); continue; }

        // Step 6: Parse sources
        var streamArr = result.stream || result.streams || [];
        if (!Array.isArray(streamArr) || streamArr.length === 0) {
          // Maybe result itself is the data
          if (typeof result === 'string' && result.indexOf('http') === 0) {
            streamArr = [{ type: 'hls', playlist: result }];
          } else {
            console.warn(TAG + ' ⚠️ [' + server + '] No stream array in result'); continue;
          }
        }

        var directQuality = [];
        var subtitlesList = [];

        for (var j = 0; j < streamArr.length; j++) {
          var streamItem = streamArr[j];
          if (streamItem.type === 'hls' && streamItem.playlist) {
            var hlsHeaders = { 'User-Agent': USER_AGENT, 'Referer': 'https://cinejoy.to/', 'Origin': 'https://cinejoy.to' };
            var hlsVariants = await parseHlsMaster(streamItem.playlist, hlsHeaders);
            var maxQ = 1080;
            for (var v = 0; v < hlsVariants.length; v++) {
              if (hlsVariants[v].quality > maxQ || v === 0) maxQ = hlsVariants[v].quality;
            }
            directQuality.push({ file: streamItem.playlist, quality: maxQ, hlsVariants: hlsVariants });
          } else if (streamItem.type === 'file' && streamItem.qualities) {
            var qualKeys = Object.keys(streamItem.qualities);
            for (var q = 0; q < qualKeys.length; q++) {
              var qObj = streamItem.qualities[qualKeys[q]];
              var qUrl = qObj && (qObj.url || qObj.file || '');
              if (qUrl) directQuality.push({ file: qUrl, quality: parseInt(qualKeys[q], 10) || 1080 });
            }
          } else if (streamItem.url) {
            directQuality.push({ file: streamItem.url, quality: streamItem.quality || 1080 });
          }

          var caps = streamItem.captions || streamItem.subtitles || [];
          if (Array.isArray(caps)) {
            for (var k = 0; k < caps.length; k++) {
              var cap = caps[k];
              var capUrl  = cap.url || cap.file || '';
              var capLang = cap.language || cap.label || cap.lang || 'Unknown';
              if (capUrl) subtitlesList.push({ url: capUrl, lang: capLang, label: capLang });
            }
          }
        }

        if (directQuality.length === 0) { console.warn(TAG + ' ⚠️ [' + server + '] No quality URLs'); continue; }
        directQuality.sort(function(a, b) { return b.quality - a.quality; });

        var primary = directQuality[0];
        var qualitiesForPicker;
        if (primary.hlsVariants && primary.hlsVariants.length > 1) {
          qualitiesForPicker = primary.hlsVariants
            .sort(function(a, b) { return b.quality - a.quality; })
            .map(function(q) { return { url: q.file, quality: q.quality + 'p' }; });
        } else {
          qualitiesForPicker = directQuality.map(function(q) { return { url: q.file, quality: q.quality + 'p' }; });
        }

        console.log(TAG + ' ✅ [' + server + '] ' + directQuality.length + ' sources + ' + subtitlesList.length + ' subs');

        return {
          url:       primary.file,
          quality:   primary.quality + 'p',
          qualities: qualitiesForPicker,
          provider:  'VidSrcCC',
          headers: {
            'User-Agent': USER_AGENT,
            'Referer':    'https://cinejoy.to/',
            'Origin':     'https://cinejoy.to',
          },
          subtitles: subtitlesList,
        };
      }

      console.warn(TAG + ' ❌ All CineJoy servers exhausted');
      return null;
    } catch (e) {
      console.error(TAG + ' 💥 Error during extraction: ' + e.message);
      return null;
    }
  }

  module.exports = { extract: extract };
})();
