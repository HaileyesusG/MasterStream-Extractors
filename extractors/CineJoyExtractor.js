/**
 * CineJoyExtractor v3.5.0 — self-contained CommonJS for remote hot-update.
 *
 * Strategy: Use cinejoy.to's own BOqDcafn.js bundle with built-in pure-JS
 * SubtleCrypto polyfill (ECDH P-256, AES-GCM-256, SHA-256, HKDF) for Hermes/React Native.
 * Uses native Ax() master extractor for automatic server negotiation
 * (Lisbon, Solara, Athens, Joy, Castle, Sakura, Canaias) and stream discovery.
 *
 * 100% JS/API based. No stream sniffer / WebView required.
 */
(function () {
  'use strict';

  var TAG = '[CineJoyExtractor]';
  var BOQ_URL = 'https://cinejoy.to/_app/immutable/chunks/BOqDcafn.js';
  var SUBS_BASE = 'https://subtitles.shegu.st';
  var TIMEOUT_MS = 15000;
  var USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36';

  var IS_NODE = typeof process !== 'undefined' && process.versions && !!process.versions.node;

  // ─── Pure-JS SubtleCrypto Implementation for Hermes / React Native ──────────
  function toU8(data) {
    if (!data) return new Uint8Array(0);
    if (data instanceof Uint8Array) return data;
    if (ArrayBuffer.isView(data)) return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
    if (data instanceof ArrayBuffer) return new Uint8Array(data);
    return new Uint8Array(data);
  }

  // SHA-256 & HMAC-SHA256
  var K256 = new Uint32Array([
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2
  ]);

  function rotr(x, n) { return (x >>> n) | (x << (32 - n)); }

  function pureSha256(data) {
    var u8 = toU8(data);
    var len = u8.length;
    var bitLen = len * 8;
    var padLen = (len % 64 < 56) ? (56 - (len % 64)) : (120 - (len % 64));
    var totalLen = len + padLen + 8;
    var buf = new Uint8Array(totalLen);
    buf.set(u8);
    buf[len] = 0x80;
    var view = new DataView(buf.buffer);
    view.setUint32(totalLen - 4, bitLen, false);

    var H = new Uint32Array([
      0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a,
      0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19
    ]);

    var W = new Uint32Array(64);
    for (var i = 0; i < totalLen; i += 64) {
      for (var t = 0; t < 16; t++) {
        W[t] = view.getUint32(i + t * 4, false);
      }
      for (var t = 16; t < 64; t++) {
        var s0 = rotr(W[t - 15], 7) ^ rotr(W[t - 15], 18) ^ (W[t - 15] >>> 3);
        var s1 = rotr(W[t - 2], 17) ^ rotr(W[t - 2], 19) ^ (W[t - 2] >>> 10);
        W[t] = (W[t - 16] + s0 + W[t - 7] + s1) >>> 0;
      }
      var a = H[0], b = H[1], c = H[2], d = H[3], e = H[4], f = H[5], g = H[6], h = H[7];
      for (var t = 0; t < 64; t++) {
        var S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
        var ch = (e & f) ^ ((~e) & g);
        var temp1 = (h + S1 + ch + K256[t] + W[t]) >>> 0;
        var S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
        var maj = (a & b) ^ (a & c) ^ (b & c);
        var temp2 = (S0 + maj) >>> 0;
        h = g; g = f; f = e; e = (d + temp1) >>> 0;
        d = c; c = b; b = a; a = (temp1 + temp2) >>> 0;
      }
      H[0] = (H[0] + a) >>> 0; H[1] = (H[1] + b) >>> 0; H[2] = (H[2] + c) >>> 0; H[3] = (H[3] + d) >>> 0;
      H[4] = (H[4] + e) >>> 0; H[5] = (H[5] + f) >>> 0; H[6] = (H[6] + g) >>> 0; H[7] = (H[7] + h) >>> 0;
    }

    var out = new Uint8Array(32);
    var outView = new DataView(out.buffer);
    for (var j = 0; j < 8; j++) outView.setUint32(j * 4, H[j], false);
    return out;
  }

  function pureHmacSha256(key, data) {
    var k = toU8(key);
    var d = toU8(data);
    if (k.length > 64) k = pureSha256(k);
    var kPad = new Uint8Array(64);
    kPad.set(k);

    var oKeyPad = new Uint8Array(64);
    var iKeyPad = new Uint8Array(64);
    for (var i = 0; i < 64; i++) {
      oKeyPad[i] = kPad[i] ^ 0x5c;
      iKeyPad[i] = kPad[i] ^ 0x36;
    }

    var inner = new Uint8Array(64 + d.length);
    inner.set(iKeyPad);
    inner.set(d, 64);
    var innerHash = pureSha256(inner);

    var outer = new Uint8Array(64 + 32);
    outer.set(oKeyPad);
    outer.set(innerHash, 64);
    return pureSha256(outer);
  }

  function pureHkdf(ikm, salt, info, length) {
    var sU8 = toU8(salt);
    var s = sU8.length > 0 ? sU8 : new Uint8Array(32);
    var prk = pureHmacSha256(s, toU8(ikm));
    var inf = toU8(info);

    var n = Math.ceil(length / 32);
    var okm = new Uint8Array(n * 32);
    var t = new Uint8Array(0);

    for (var i = 1; i <= n; i++) {
      var stepInput = new Uint8Array(t.length + inf.length + 1);
      stepInput.set(t);
      stepInput.set(inf, t.length);
      stepInput[stepInput.length - 1] = i;
      t = pureHmacSha256(prk, stepInput);
      okm.set(t, (i - 1) * 32);
    }
    return okm.slice(0, length);
  }

  // ECDH P-256 Curve Math
  var EC_P = BigInt('0xFFFFFFFF00000001000000000000000000000000FFFFFFFFFFFFFFFFFFFFFFFF');
  var EC_A = BigInt('0xFFFFFFFF00000001000000000000000000000000FFFFFFFFFFFFFFFFFFFFFFFC');
  var EC_N = BigInt('0xFFFFFFFF00000000FFFFFFFFFFFFFFFFBCE6FAADA7179E84F3B9CAC2FC632551');
  var EC_Gx = BigInt('0x6B17D1F2E12C4247F8BCE6E563A440F277037D812DEB33A0F4A13945D898C296');
  var EC_Gy = BigInt('0x4FE342E2FE1A7F9B8EE7EB4A7C0F9E162BCE33576B315ECECBB6406837BF51F5');

  function ecMod(a, m) { var r = a % m; return r < 0n ? r + m : r; }
  function ecModInverse(k, m) {
    var m0 = m, y = 0n, x = 1n;
    if (m === 1n) return 0n;
    while (k > 1n) {
      var q = k / m, t = m;
      m = k % m; k = t; t = y;
      y = x - q * y; x = t;
    }
    return x < 0n ? x + m0 : x;
  }

  function ecPointAdd(P1, P2) {
    if (!P1) return P2;
    if (!P2) return P1;
    var x1 = P1.x, y1 = P1.y, x2 = P2.x, y2 = P2.y;
    if (x1 === x2 && y1 === y2) return ecPointDouble(P1);
    if (x1 === x2) return null;
    var slope = ecMod((y2 - y1) * ecModInverse(ecMod(x2 - x1, EC_P), EC_P), EC_P);
    var x3 = ecMod(slope * slope - x1 - x2, EC_P);
    var y3 = ecMod(slope * (x1 - x3) - y1, EC_P);
    return { x: x3, y: y3 };
  }

  function ecPointDouble(Pt) {
    if (!Pt) return null;
    var x1 = Pt.x, y1 = Pt.y;
    if (y1 === 0n) return null;
    var slope = ecMod((3n * x1 * x1 + EC_A) * ecModInverse(2n * y1, EC_P), EC_P);
    var x3 = ecMod(slope * slope - 2n * x1, EC_P);
    var y3 = ecMod(slope * (x1 - x3) - y1, EC_P);
    return { x: x3, y: y3 };
  }

  function ecPointMultiply(k, Pt) {
    var R = null, Q = Pt;
    var kVal = k;
    while (kVal > 0n) {
      if (kVal & 1n) R = ecPointAdd(R, Q);
      Q = ecPointDouble(Q);
      kVal >>= 1n;
    }
    return R;
  }

  function bigIntToU8(bi, len) {
    var hex = bi.toString(16).padStart(len * 2, '0');
    var u8 = new Uint8Array(len);
    for (var i = 0; i < len; i++) u8[i] = parseInt(hex.substr(i * 2, 2), 16);
    return u8;
  }

  function u8ToBigInt(u8) {
    var hex = '';
    for (var i = 0; i < u8.length; i++) hex += u8[i].toString(16).padStart(2, '0');
    return BigInt('0x' + hex);
  }

  // Table-driven AES-256 & BigInt GHASH
  var AES_TABLES = (function() {
    var SBOX = [];
    var SUB_MIX_0 = [], SUB_MIX_1 = [], SUB_MIX_2 = [], SUB_MIX_3 = [];
    var RCON = [0x00, 0x01, 0x02, 0x04, 0x08, 0x10, 0x20, 0x40, 0x80, 0x1b, 0x36];

    var d = [];
    for (var i = 0; i < 256; i++) {
      if (i < 128) d[i] = i << 1;
      else d[i] = (i << 1) ^ 0x11b;
    }
    var x = 0, xi = 0;
    for (var i = 0; i < 256; i++) {
      var sx = xi ^ (xi << 1) ^ (xi << 2) ^ (xi << 3) ^ (xi << 4);
      sx = (sx >>> 8) ^ (sx & 0xff) ^ 0x63;
      SBOX[x] = sx;

      var x2 = d[x], x4 = d[x2], x8 = d[x4];
      var t = (d[sx] * 0x101) ^ (sx * 0x1010100);
      SUB_MIX_0[x] = (t << 24) | (t >>> 8);
      SUB_MIX_1[x] = (t << 16) | (t >>> 16);
      SUB_MIX_2[x] = (t << 8)  | (t >>> 24);
      SUB_MIX_3[x] = t;

      if (!x) { x = xi = 1; }
      else { x = x2 ^ d[d[d[x8 ^ x2]]]; xi ^= d[d[xi]]; }
    }

    return { SBOX: SBOX, SUB_MIX_0: SUB_MIX_0, SUB_MIX_1: SUB_MIX_1, SUB_MIX_2: SUB_MIX_2, SUB_MIX_3: SUB_MIX_3, RCON: RCON };
  })();

  function aesExpandKey(keyU8) {
    var keyWords = [];
    for (var i = 0; i < keyU8.length; i += 4) {
      keyWords.push(((keyU8[i] << 24) | (keyU8[i+1] << 16) | (keyU8[i+2] << 8) | keyU8[i+3]) >>> 0);
    }
    var keySize = keyWords.length;
    var nRounds = keySize + 6;
    var ksRows = (nRounds + 1) * 4;
    var keySchedule = [];
    var SBOX = AES_TABLES.SBOX, RCON = AES_TABLES.RCON;

    for (var k = 0; k < keySize; k++) keySchedule[k] = keyWords[k];
    for (var k = keySize; k < ksRows; k++) {
      var temp = keySchedule[k - 1];
      if (k % keySize === 0) {
        temp = (temp << 8) | (temp >>> 24);
        temp = (SBOX[temp >>> 24] << 24) | (SBOX[(temp >>> 16) & 0xff] << 16) | (SBOX[(temp >>> 8) & 0xff] << 8) | SBOX[temp & 0xff];
        temp = temp ^ (RCON[(k / keySize) | 0] << 24);
      } else if (keySize > 6 && k % keySize === 4) {
        temp = (SBOX[temp >>> 24] << 24) | (SBOX[(temp >>> 16) & 0xff] << 16) | (SBOX[(temp >>> 8) & 0xff] << 8) | SBOX[temp & 0xff];
      }
      keySchedule[k] = (keySchedule[k - keySize] ^ temp) >>> 0;
    }
    return keySchedule;
  }

  function aesEncryptBlock(ptU8, keySchedule) {
    var s0 = ((ptU8[0] << 24) | (ptU8[1] << 16) | (ptU8[2] << 8) | ptU8[3]) ^ keySchedule[0];
    var s1 = ((ptU8[4] << 24) | (ptU8[5] << 16) | (ptU8[6] << 8) | ptU8[7]) ^ keySchedule[1];
    var s2 = ((ptU8[8] << 24) | (ptU8[9] << 16) | (ptU8[10] << 8) | ptU8[11]) ^ keySchedule[2];
    var s3 = ((ptU8[12] << 24) | (ptU8[13] << 16) | (ptU8[14] << 8) | ptU8[15]) ^ keySchedule[3];

    var SBOX = AES_TABLES.SBOX;
    var M0 = AES_TABLES.SUB_MIX_0, M1 = AES_TABLES.SUB_MIX_1, M2 = AES_TABLES.SUB_MIX_2, M3 = AES_TABLES.SUB_MIX_3;

    var ksRow = 4;
    for (var round = 1; round < 14; round++) {
      var t0 = M0[s0 >>> 24] ^ M1[(s1 >>> 16) & 0xff] ^ M2[(s2 >>> 8) & 0xff] ^ M3[s3 & 0xff] ^ keySchedule[ksRow++];
      var t1 = M0[s1 >>> 24] ^ M1[(s2 >>> 16) & 0xff] ^ M2[(s3 >>> 8) & 0xff] ^ M3[s0 & 0xff] ^ keySchedule[ksRow++];
      var t2 = M0[s2 >>> 24] ^ M1[(s3 >>> 16) & 0xff] ^ M2[(s0 >>> 8) & 0xff] ^ M3[s1 & 0xff] ^ keySchedule[ksRow++];
      var t3 = M0[s3 >>> 24] ^ M1[(s0 >>> 16) & 0xff] ^ M2[(s1 >>> 8) & 0xff] ^ M3[s2 & 0xff] ^ keySchedule[ksRow++];
      s0 = t0; s1 = t1; s2 = t2; s3 = t3;
    }

    var t0 = ((SBOX[s0 >>> 24] << 24) | (SBOX[(s1 >>> 16) & 0xff] << 16) | (SBOX[(s2 >>> 8) & 0xff] << 8) | SBOX[s3 & 0xff]) ^ keySchedule[ksRow++];
    var t1 = ((SBOX[s1 >>> 24] << 24) | (SBOX[(s2 >>> 16) & 0xff] << 16) | (SBOX[(s3 >>> 8) & 0xff] << 8) | SBOX[s0 & 0xff]) ^ keySchedule[ksRow++];
    var t2 = ((SBOX[s2 >>> 24] << 24) | (SBOX[(s3 >>> 16) & 0xff] << 16) | (SBOX[(s0 >>> 8) & 0xff] << 8) | SBOX[s1 & 0xff]) ^ keySchedule[ksRow++];
    var t3 = ((SBOX[s3 >>> 24] << 24) | (SBOX[(s0 >>> 16) & 0xff] << 16) | (SBOX[(s1 >>> 8) & 0xff] << 8) | SBOX[s2 & 0xff]) ^ keySchedule[ksRow++];

    var out = new Uint8Array(16);
    out[0] = (t0 >>> 24) & 0xff; out[1] = (t0 >>> 16) & 0xff; out[2] = (t0 >>> 8) & 0xff; out[3] = t0 & 0xff;
    out[4] = (t1 >>> 24) & 0xff; out[5] = (t1 >>> 16) & 0xff; out[6] = (t1 >>> 8) & 0xff; out[7] = t1 & 0xff;
    out[8] = (t2 >>> 24) & 0xff; out[9] = (t2 >>> 16) & 0xff; out[10] = (t2 >>> 8) & 0xff; out[11] = t2 & 0xff;
    out[12] = (t3 >>> 24) & 0xff; out[13] = (t3 >>> 16) & 0xff; out[14] = (t3 >>> 8) & 0xff; out[15] = t3 & 0xff;
    return out;
  }

  function ghashMultiply(x, y) {
    var z0 = 0n, z1 = 0n;
    var v0_0 = (BigInt(y[0]) << 24n) | (BigInt(y[1]) << 16n) | (BigInt(y[2]) << 8n) | BigInt(y[3]);
    var v0_1 = (BigInt(y[4]) << 24n) | (BigInt(y[5]) << 16n) | (BigInt(y[6]) << 8n) | BigInt(y[7]);
    var v1_0 = (BigInt(y[8]) << 24n) | (BigInt(y[9]) << 16n) | (BigInt(y[10]) << 8n) | BigInt(y[11]);
    var v1_1 = (BigInt(y[12]) << 24n) | (BigInt(y[13]) << 16n) | (BigInt(y[14]) << 8n) | BigInt(y[15]);

    var v0 = (v0_0 << 32n) | v0_1;
    var v1 = (v1_0 << 32n) | v1_1;
    var R = 0xe100000000000000n;

    for (var i = 0; i < 16; i++) {
      var byte = x[i];
      for (var j = 7; j >= 0; j--) {
        if ((byte >> j) & 1) {
          z0 ^= v0;
          z1 ^= v1;
        }
        var lsb = v1 & 1n;
        v1 = (v1 >> 1n) | ((v0 & 1n) << 63n);
        v0 = v0 >> 1n;
        if (lsb) v0 ^= R;
      }
    }

    var out = new Uint8Array(16);
    var z0_0 = Number((z0 >> 56n) & 0xffn), z0_1 = Number((z0 >> 48n) & 0xffn), z0_2 = Number((z0 >> 40n) & 0xffn), z0_3 = Number((z0 >> 32n) & 0xffn);
    var z0_4 = Number((z0 >> 24n) & 0xffn), z0_5 = Number((z0 >> 16n) & 0xffn), z0_6 = Number((z0 >> 8n) & 0xffn), z0_7 = Number(z0 & 0xffn);
    var z1_0 = Number((z1 >> 56n) & 0xffn), z1_1 = Number((z1 >> 48n) & 0xffn), z1_2 = Number((z1 >> 40n) & 0xffn), z1_3 = Number((z1 >> 32n) & 0xffn);
    var z1_4 = Number((z1 >> 24n) & 0xffn), z1_5 = Number((z1 >> 16n) & 0xffn), z1_6 = Number((z1 >> 8n) & 0xffn), z1_7 = Number(z1 & 0xffn);
    out.set([z0_0,z0_1,z0_2,z0_3,z0_4,z0_5,z0_6,z0_7,z1_0,z1_1,z1_2,z1_3,z1_4,z1_5,z1_6,z1_7]);
    return out;
  }

  function computeGhash(H, aad, ct) {
    var S = new Uint8Array(16);
    var aadU8 = toU8(aad);
    var ctU8 = toU8(ct);

    function process(data) {
      if (!data || !data.length) return;
      for (var i = 0; i < data.length; i += 16) {
        var block = new Uint8Array(16);
        for (var j = 0; j < 16 && (i + j) < data.length; j++) block[j] = data[i + j];
        for (var j = 0; j < 16; j++) S[j] ^= block[j];
        S = ghashMultiply(S, H);
      }
    }
    process(aadU8);
    process(ctU8);

    var lenBlock = new Uint8Array(16);
    var aadBits = BigInt(aadU8.length * 8);
    var ctBits = BigInt(ctU8.length * 8);
    for (var i = 0; i < 8; i++) {
      lenBlock[7 - i] = Number((aadBits >> BigInt(i * 8)) & 0xffn);
      lenBlock[15 - i] = Number((ctBits >> BigInt(i * 8)) & 0xffn);
    }
    for (var j = 0; j < 16; j++) S[j] ^= lenBlock[j];
    return ghashMultiply(S, H);
  }

  function pureGcmEncrypt(keyU8, ivU8, ptU8, aadU8) {
    var k = toU8(keyU8);
    var iv = toU8(ivU8);
    var pt = toU8(ptU8);
    var aad = toU8(aadU8);

    var rk = aesExpandKey(k);
    var H = aesEncryptBlock(new Uint8Array(16), rk);

    var J0 = new Uint8Array(16);
    J0.set(iv.subarray(0, 12));
    J0[15] = 1;

    var ct = new Uint8Array(pt.length);
    var CB = new Uint8Array(J0);
    var ctr = 1;

    for (var i = 0; i < pt.length; i += 16) {
      ctr++;
      CB[12] = (ctr >> 24) & 0xff; CB[13] = (ctr >> 16) & 0xff; CB[14] = (ctr >> 8) & 0xff; CB[15] = ctr & 0xff;
      var encCB = aesEncryptBlock(CB, rk);
      for (var j = 0; j < 16 && (i + j) < pt.length; j++) {
        ct[i + j] = pt[i + j] ^ encCB[j];
      }
    }

    var S = computeGhash(H, aad, ct);
    var encJ0 = aesEncryptBlock(J0, rk);
    var tag = new Uint8Array(16);
    for (var j = 0; j < 16; j++) tag[j] = S[j] ^ encJ0[j];

    var out = new Uint8Array(ct.length + 16);
    out.set(ct);
    out.set(tag, ct.length);
    return out;
  }

  function pureGcmDecrypt(keyU8, ivU8, ctWithTagU8, aadU8) {
    var k = toU8(keyU8);
    var iv = toU8(ivU8);
    var ctWithTag = toU8(ctWithTagU8);
    var aad = toU8(aadU8);

    if (ctWithTag.length < 16) throw new Error('Ciphertext too short');
    var ctLen = ctWithTag.length - 16;
    var ct = ctWithTag.subarray(0, ctLen);
    var tag = ctWithTag.subarray(ctLen);

    var rk = aesExpandKey(k);
    var H = aesEncryptBlock(new Uint8Array(16), rk);

    var J0 = new Uint8Array(16);
    J0.set(iv.subarray(0, 12));
    J0[15] = 1;

    var S = computeGhash(H, aad, ct);
    var encJ0 = aesEncryptBlock(J0, rk);
    var expectedTag = new Uint8Array(16);
    for (var j = 0; j < 16; j++) expectedTag[j] = S[j] ^ encJ0[j];

    var diff = 0;
    for (var j = 0; j < 16; j++) diff |= (tag[j] ^ expectedTag[j]);
    if (diff !== 0) throw new Error('AES-GCM tag verification failed');

    var pt = new Uint8Array(ctLen);
    var CB = new Uint8Array(J0);
    var ctr = 1;
    for (var i = 0; i < ctLen; i += 16) {
      ctr++;
      CB[12] = (ctr >> 24) & 0xff; CB[13] = (ctr >> 16) & 0xff; CB[14] = (ctr >> 8) & 0xff; CB[15] = ctr & 0xff;
      var encCB = aesEncryptBlock(CB, rk);
      for (var j = 0; j < 16 && (i + j) < ctLen; j++) {
        pt[i + j] = ct[i + j] ^ encCB[j];
      }
    }
    return pt;
  }

  function createPureSubtle() {
    return {
      generateKey: function(algorithm, extractable, keyUsages) {
        var algName = typeof algorithm === 'string' ? algorithm : (algorithm && algorithm.name ? algorithm.name : '');
        if (algName === 'ECDH') {
          var rand = new Uint8Array(32);
          if (typeof crypto !== 'undefined' && crypto.getRandomValues) crypto.getRandomValues(rand);
          else for (var i = 0; i < 32; i++) rand[i] = (Math.random() * 256) | 0;
          var d = ecMod(u8ToBigInt(rand), EC_N - 1n) + 1n;
          var Q = ecPointMultiply(d, { x: EC_Gx, y: EC_Gy });
          var rawPub = new Uint8Array(65);
          rawPub[0] = 0x04;
          rawPub.set(bigIntToU8(Q.x, 32), 1);
          rawPub.set(bigIntToU8(Q.y, 32), 33);

          var privKey = { type: 'private', algorithm: algorithm, extractable: extractable, usages: keyUsages, _d: d };
          var pubKey = { type: 'public', algorithm: algorithm, extractable: extractable, usages: keyUsages, _raw: rawPub.buffer.slice(0, 65) };
          return Promise.resolve({ privateKey: privKey, publicKey: pubKey });
        }
        return Promise.reject(new Error('Unsupported generateKey: ' + algName));
      },

      exportKey: function(format, key) {
        if (format === 'raw' && key._raw) {
          return Promise.resolve(key._raw);
        }
        return Promise.reject(new Error('Unsupported exportKey format: ' + format));
      },

      importKey: function(format, keyData, algorithm, extractable, keyUsages) {
        var u8 = toU8(keyData);
        var algName = typeof algorithm === 'string' ? algorithm : (algorithm && algorithm.name ? algorithm.name : '');
        if (algName === 'ECDH') {
          if (u8.length === 65 && u8[0] === 0x04) {
            var qx = u8ToBigInt(u8.subarray(1, 33));
            var qy = u8ToBigInt(u8.subarray(33, 65));
            return Promise.resolve({
              type: 'public',
              algorithm: typeof algorithm === 'object' ? algorithm : { name: 'ECDH', namedCurve: 'P-256' },
              extractable: extractable,
              usages: keyUsages,
              _point: { x: qx, y: qy },
              _raw: u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength),
            });
          }
          return Promise.reject(new Error('Invalid ECDH raw key length: ' + u8.length));
        }
        if (algName === 'AES-GCM' || algName === 'aes-gcm') {
          return Promise.resolve({
            type: 'secret',
            algorithm: typeof algorithm === 'object' ? algorithm : { name: 'AES-GCM' },
            extractable: extractable,
            usages: keyUsages,
            _key: u8,
          });
        }
        if (algName === 'HKDF' || algName === 'hkdf') {
          return Promise.resolve({
            type: 'secret',
            algorithm: typeof algorithm === 'object' ? algorithm : { name: 'HKDF' },
            extractable: extractable,
            usages: keyUsages,
            _ikm: u8,
          });
        }
        return Promise.reject(new Error('Unsupported importKey algorithm: ' + JSON.stringify(algorithm)));
      },

      deriveKey: function(algorithm, baseKey, derivedKeyType, extractable, keyUsages) {
        var algName = typeof algorithm === 'string' ? algorithm : (algorithm && algorithm.name ? algorithm.name : '');
        if (algName === 'HKDF') {
          var ikm = baseKey._ikm;
          if (!ikm) return Promise.reject(new Error('Missing baseKey._ikm for HKDF'));
          var len = (derivedKeyType.length || 256) / 8;
          var derivedBytes = pureHkdf(ikm, algorithm.salt, algorithm.info, len);
          return this.importKey('raw', derivedBytes, derivedKeyType, extractable, keyUsages);
        }
        return Promise.reject(new Error('Unsupported deriveKey: ' + algName));
      },

      deriveBits: function(algorithm, baseKey, length) {
        var algName = typeof algorithm === 'string' ? algorithm : (algorithm && algorithm.name ? algorithm.name : '');
        if (algName === 'ECDH' && algorithm.public && baseKey._d) {
          var peerPoint = algorithm.public._point;
          if (!peerPoint) return Promise.reject(new Error('Missing peer public point'));
          var S = ecPointMultiply(baseKey._d, peerPoint);
          if (!S) return Promise.reject(new Error('Invalid shared point (infinity)'));
          var sharedX = bigIntToU8(S.x, 32);
          return Promise.resolve(sharedX.buffer.slice(0, 32));
        }
        if (algName === 'HKDF' && baseKey._ikm) {
          var bytesLen = (length || 256) / 8;
          var bits = pureHkdf(baseKey._ikm, algorithm.salt, algorithm.info, bytesLen);
          return Promise.resolve(bits.buffer.slice(0, bytesLen));
        }
        return Promise.reject(new Error('Unsupported deriveBits: ' + algName));
      },

      encrypt: function(algorithm, key, data) {
        var algName = typeof algorithm === 'string' ? algorithm : (algorithm && algorithm.name ? algorithm.name : '');
        if (algName === 'AES-GCM' && key._key) {
          try {
            var enc = pureGcmEncrypt(key._key, algorithm.iv, data, algorithm.additionalData);
            return Promise.resolve(enc.buffer.slice(0, enc.length));
          } catch(e) { return Promise.reject(e); }
        }
        return Promise.reject(new Error('Unsupported encrypt algorithm: ' + algName));
      },

      decrypt: function(algorithm, key, data) {
        var algName = typeof algorithm === 'string' ? algorithm : (algorithm && algorithm.name ? algorithm.name : '');
        if (algName === 'AES-GCM' && key._key) {
          try {
            var dec = pureGcmDecrypt(key._key, algorithm.iv, data, algorithm.additionalData);
            return Promise.resolve(dec.buffer.slice(0, dec.length));
          } catch(e) { return Promise.reject(e); }
        }
        return Promise.reject(new Error('Unsupported decrypt algorithm: ' + algName));
      },

      digest: function(algorithm, data) {
        var algName = typeof algorithm === 'string' ? algorithm : (algorithm && algorithm.name ? algorithm.name : '');
        if (algName === 'SHA-256' || algName === 'sha-256') {
          var hash = pureSha256(data);
          return Promise.resolve(hash.buffer.slice(0, 32));
        }
        return Promise.reject(new Error('Unsupported digest: ' + algName));
      },
    };
  }

  // ─── Fingerprint helper ──────────────────────────────────────────────────────
  function buildFingerprint() {
    var tz = 'UTC';
    try { if (typeof Intl !== 'undefined' && Intl.DateTimeFormat) tz = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'; } catch (e) {}
    var lang = 'en';
    try { if (typeof navigator !== 'undefined' && navigator.language) lang = navigator.language.split('-')[0]; } catch (e) {}
    var hc = 4;
    try { if (typeof navigator !== 'undefined' && navigator.hardwareConcurrency) hc = navigator.hardwareConcurrency; } catch (e) {}
    return {
      tz: tz, lang: lang, langs: '', pf: 'na', hc: hc, dm: 0,
      dpr: (typeof window !== 'undefined' && window.devicePixelRatio) ? window.devicePixelRatio : 2,
      sw: (typeof window !== 'undefined' && window.screen) ? (window.screen.width || 390) : 390,
      sh: (typeof window !== 'undefined' && window.screen) ? (window.screen.height || 844) : 844,
      cd: (typeof window !== 'undefined' && window.screen) ? (window.screen.colorDepth || 24) : 24,
      tp: (typeof navigator !== 'undefined' && navigator.maxTouchPoints) ? navigator.maxTouchPoints : 5,
      cvs: 'na', wgl: 'na', jit: '32,38,54,48,47',
    };
  }

  // ─── Pure JS Base64 (Hermes safe) ────────────────────────────────────────────
  var B64_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  function pureAtob(s) {
    if (!s) return '';
    s = String(s).replace(/-/g, '+').replace(/_/g, '/').replace(/[^A-Za-z0-9+/]/g, '');
    var out = '', i = 0;
    while (i < s.length) {
      var c0 = B64_CHARS.indexOf(s[i++]), c1 = B64_CHARS.indexOf(s[i++]);
      var c2 = i <= s.length ? B64_CHARS.indexOf(s[i++]) : 64;
      var c3 = i <= s.length ? B64_CHARS.indexOf(s[i++]) : 64;
      if (c1 >= 0) out += String.fromCharCode((c0 << 2) | (c1 >> 4));
      if (c2 >= 0 && c2 < 64) out += String.fromCharCode(((c1 & 0xf) << 4) | (c2 >> 2));
      if (c3 >= 0 && c3 < 64) out += String.fromCharCode(((c2 & 0x3) << 6) | c3);
    }
    return out;
  }

  function pureBtoa(s) {
    if (!s) return '';
    s = String(s);
    var out = '';
    for (var i = 0; i < s.length; i += 3) {
      var b0 = s.charCodeAt(i) & 0xff;
      var b1 = i + 1 < s.length ? s.charCodeAt(i + 1) & 0xff : 0;
      var b2 = i + 2 < s.length ? s.charCodeAt(i + 2) & 0xff : 0;
      out += B64_CHARS[b0 >> 2] + B64_CHARS[((b0 & 3) << 4) | (b1 >> 4)] +
        (i + 1 < s.length ? B64_CHARS[((b1 & 0xf) << 2) | (b2 >> 6)] : '=') +
        (i + 2 < s.length ? B64_CHARS[b2 & 0x3f] : '=');
    }
    return out;
  }

  // ─── BOqDcafn Sandbox Loader ──────────────────────────────────────────────────
  var _boqPromise = null;

  function loadBoqNode() {
    var vm = require('vm');
    var https = require('https');
    var noop = function () {};
    var fp = buildFingerprint();
    var pureSubtle = createPureSubtle();

    return new Promise(function (resolve, reject) {
      https.get(BOQ_URL, { headers: { 'User-Agent': USER_AGENT } }, function (res) {
        var chunks = [];
        res.on('data', function (d) { chunks.push(d); });
        res.on('end', function () {
          try {
            var code = Buffer.concat(chunks).toString();
            var clean = code
              .replace(/import\{[^}]*\}from["'][^"']+["'];?/g, 'var X = { serverOrder: ["Lisbon", "Solara", "Athens", "Joy", "Castle", "Sakura", "Canaias"], servers: [], providers: [] };')
              .replace(/export\{[^}]*\};?/g, '');

            var sb = vm.createContext({
              console: console,
              crypto: {
                subtle: pureSubtle,
                getRandomValues: function (arr) {
                  for (var i = 0; i < arr.length; i++) arr[i] = (Math.random() * 256) | 0;
                  return arr;
                },
              },
              isSecureContext: true,
              TextEncoder: TextEncoder, TextDecoder: TextDecoder,
              URL: URL, URLSearchParams: URLSearchParams,
              atob: pureAtob, btoa: pureBtoa,
              performance: { now: function () { return Date.now(); }, mark: noop, measure: noop },
              fetch: function (url, opts) {
                return new Promise(function (fResolve, fReject) {
                  var u = new URL(url);
                  var req = https.request({
                    hostname: u.hostname,
                    port: parseInt(u.port) || 443,
                    path: u.pathname + (u.search || ''),
                    method: (opts && opts.method) || 'GET',
                    headers: Object.assign({
                      'Accept': '*/*',
                      'Origin': 'https://cinejoy.to',
                      'Referer': 'https://cinejoy.to/',
                      'User-Agent': USER_AGENT,
                    }, (opts && opts.headers) || {})
                  }, function (fRes) {
                    var rChunks = [];
                    fRes.on('data', function (d) { rChunks.push(d); });
                    fRes.on('end', function () {
                      var body = Buffer.concat(rChunks);
                      fResolve({
                        ok: fRes.statusCode >= 200 && fRes.statusCode < 300,
                        status: fRes.statusCode,
                        json: function () { return Promise.resolve(JSON.parse(body.toString())); },
                        text: function () { return Promise.resolve(body.toString()); },
                        arrayBuffer: function () { return Promise.resolve(body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength)); },
                      });
                    });
                  });
                  req.on('error', fReject);
                  if (opts && opts.body) {
                    var b = Buffer.isBuffer(opts.body) ? opts.body : Buffer.from(opts.body);
                    req.write(b);
                  }
                  req.end();
                });
              },
              Object: Object, Array: Array, Math: Math, JSON: JSON, Date: Date,
              String: String, Number: Number, Boolean: Boolean, Promise: Promise,
              Map: Map, Set: Set, WeakMap: WeakMap, RegExp: RegExp, Error: Error,
              TypeError: TypeError, Symbol: Symbol, Proxy: Proxy, Reflect: Reflect,
              isNaN: isNaN, isFinite: isFinite, parseInt: parseInt, parseFloat: parseFloat,
              decodeURIComponent: decodeURIComponent, encodeURIComponent: encodeURIComponent,
              Uint8Array: Uint8Array, ArrayBuffer: ArrayBuffer, DataView: DataView,
              Int8Array: Int8Array, Uint16Array: Uint16Array, Int32Array: Int32Array,
              Uint32Array: Uint32Array, Float32Array: Float32Array, Float64Array: Float64Array,
              Uint8ClampedArray: Uint8ClampedArray,
              window: { location: { href: 'https://cinejoy.to/', hostname: 'cinejoy.to' }, navigator: { userAgent: '' }, addEventListener: noop, isSecureContext: true },
              document: { querySelector: function () { return null; }, querySelectorAll: function () { return []; }, createElement: function () { return { style: {}, classList: { add: noop } }; }, cookie: '', currentScript: null, addEventListener: noop },
              navigator: { userAgent: USER_AGENT, language: fp.lang, hardwareConcurrency: fp.hc },
              location: { href: 'https://cinejoy.to/', hostname: 'cinejoy.to', origin: 'https://cinejoy.to', pathname: '/' },
              history: { pushState: noop, replaceState: noop, state: null },
              customElements: { define: noop, get: function () { return null; } },
              HTMLElement: function () {}, Event: function (t) { this.type = t; },
              requestAnimationFrame: noop, cancelAnimationFrame: noop,
              addEventListener: noop, removeEventListener: noop, dispatchEvent: noop,
              MutationObserver: function () { this.observe = noop; this.disconnect = noop; },
              AbortController: function () { this.signal = { aborted: false, addEventListener: noop }; this.abort = noop; },
              AbortSignal: { timeout: function () { return { aborted: false, addEventListener: noop }; } },
              structuredClone: function (x) { return JSON.parse(JSON.stringify(x)); },
              self: null, globalThis: null,
            });
            sb.self = sb;
            sb.globalThis = sb;

            new vm.Script(clean).runInContext(sb);

            resolve({
              Ax: vm.runInContext('typeof Ax !== "undefined" ? Ax : null', sb),
            });
          } catch (e) {
            reject(e);
          }
        });
      }).on('error', reject);
    });
  }

  function loadBoqEval() {
    var noop = function () {};
    var fp = buildFingerprint();
    var pureSubtle = createPureSubtle();

    var polyCrypto = {
      subtle: pureSubtle,
      getRandomValues: function (arr) {
        if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
          try { return crypto.getRandomValues(arr); } catch (e) {}
        }
        for (var i = 0; i < arr.length; i++) arr[i] = (Math.random() * 256) | 0;
        return arr;
      },
    };

    var g = (typeof globalThis !== 'undefined') ? globalThis
      : (typeof global !== 'undefined') ? global
      : (typeof window !== 'undefined') ? window : {};

    // ── fetch shim: global fetch (with injected headers) or XHR fallback ─────
    var fetchShim = (function () {
      if (typeof fetch !== 'undefined') {
        return function (url, opts) {
          var o = Object.assign({}, opts);
          o.headers = Object.assign({
            'Accept': '*/*',
            'Origin': 'https://cinejoy.to',
            'Referer': 'https://cinejoy.to/',
            'User-Agent': USER_AGENT,
          }, (opts && opts.headers) || {});
          return fetch(url, o);
        };
      }
      return function (url, opts) {
        return new Promise(function (resolve, reject) {
          var xhr = new XMLHttpRequest();
          xhr.open((opts && opts.method) || 'GET', url, true);
          var hdrs = Object.assign({
            'Accept': '*/*',
            'Origin': 'https://cinejoy.to',
            'Referer': 'https://cinejoy.to/',
            'User-Agent': USER_AGENT,
          }, (opts && opts.headers) || {});
          Object.keys(hdrs).forEach(function (k) { try { xhr.setRequestHeader(k, hdrs[k]); } catch (e) {} });
          xhr.responseType = 'arraybuffer';
          xhr.onload = function () {
            var ab = xhr.response;
            var ok = xhr.status >= 200 && xhr.status < 300;
            var toText = function () {
              return typeof TextDecoder !== 'undefined'
                ? new TextDecoder().decode(ab)
                : String.fromCharCode.apply(null, new Uint8Array(ab));
            };
            resolve({
              ok: ok, status: xhr.status,
              json: function () { return Promise.resolve(JSON.parse(toText())); },
              text: function () { return Promise.resolve(toText()); },
              arrayBuffer: function () { return Promise.resolve(ab); },
            });
          };
          xhr.onerror = function () { reject(new Error('XHR network error')); };
          if (opts && opts.body) xhr.send(opts.body); else xhr.send();
        });
      };
    })();

    // Install persistent environment shims on real global
    try {
      g.crypto = polyCrypto;
      g.isSecureContext = true;
      if (typeof window !== 'undefined') {
        window.crypto = polyCrypto;
        window.isSecureContext = true;
      }
    } catch (e) {}

    return fetchShim(BOQ_URL, { headers: { 'User-Agent': USER_AGENT } })
      .then(function (res) {
        if (!res.ok) throw new Error('BOqDcafn download failed: HTTP ' + res.status);
        return res.text();
      })
      .then(function (code) {
        var clean = code
          .replace(/import\s*\{([^}]*)\}\s*from\s*["'][^"']*["'];?/g, function (_, imports) {
            return imports.split(',').map(function (seg) {
              var parts = seg.trim().split(/\s+as\s+/);
              var localName = (parts[1] || parts[0]).trim().replace(/[^a-zA-Z0-9_$]/g, '');
              return localName ? 'var ' + localName + ' = (function(){ var fn = function(){}; fn.serverOrder=["Lisbon","Solara","Athens","Joy","Castle","Sakura","Canaias"]; fn.servers=[]; fn.providers=[]; fn.captions=[]; fn.audioTracks=[]; fn.qualities=[]; fn.sourceType="hls"; fn.url=""; fn.introSkip=null; fn.prototype={}; if(typeof Proxy!=="undefined"){return new Proxy(fn,{get:function(t,k){if(k in t)return t[k];return function(){};},apply:function(t,_,a){return t.apply(null,a);}});} return fn; })();' : '';
            }).filter(Boolean).join(' ');
          })
          .replace(/export\s*\{[^}]*\}\s*;?/g, '');

        var UA = JSON.stringify(USER_AGENT);
        var shimDecls = [
          'var HTMLElement    = function HTMLElement(){};',
          'var SVGElement     = function SVGElement(){};',
          'var Element        = function Element(){};',
          'var Node           = function Node(){};',
          'var EventTarget    = function EventTarget(){};',
          'var HTMLMediaElement = function HTMLMediaElement(){};',
          'var HTMLVideoElement = function HTMLVideoElement(){};',
          'var HTMLAudioElement = function HTMLAudioElement(){};',
          'var HTMLImageElement = function HTMLImageElement(){};',
          'var HTMLCanvasElement = function HTMLCanvasElement(){};',
          'var HTMLInputElement = function HTMLInputElement(){};',
          'var HTMLButtonElement = function HTMLButtonElement(){};',
          'var HTMLFormElement = function HTMLFormElement(){};',
          'var HTMLSelectElement = function HTMLSelectElement(){};',
          'var HTMLTextAreaElement = function HTMLTextAreaElement(){};',
          'var HTMLAnchorElement = function HTMLAnchorElement(){};',
          'var HTMLScriptElement = function HTMLScriptElement(){};',
          'var HTMLLinkElement = function HTMLLinkElement(){};',
          'var HTMLIFrameElement = function HTMLIFrameElement(){};',
          'var Document = function Document(){};',
          'var Window = function Window(){};',
          'var Blob = function Blob(){};',
          'var File = function File(){};',
          'var FormData = function FormData(){};',
          'var Headers = function Headers(){};',
          'var Request = function Request(){};',
          'var XMLHttpRequest = function XMLHttpRequest(){};',
          'var WebSocket = function WebSocket(){};',
          'var Image = function Image(){};',
          'var MediaSource = function MediaSource(){};',
          'var CSSStyleSheet = function CSSStyleSheet(){};',
          'var Event          = function Event(t,i){this.type=t;this.bubbles=!!(i&&i.bubbles);this.cancelable=!!(i&&i.cancelable);};',
          'var CustomEvent    = function CustomEvent(t,i){this.type=t;this.detail=i&&i.detail;};',
          'var MutationObserver     = function MutationObserver(cb){this.observe=function(){};this.disconnect=function(){};this.takeRecords=function(){return[];};};',
          'var ResizeObserver       = function ResizeObserver(cb){this.observe=function(){};this.disconnect=function(){};};',
          'var IntersectionObserver = function IntersectionObserver(cb){this.observe=function(){};this.disconnect=function(){};};',
          'var AbortController = function AbortController(){var n=function(){};this.signal={aborted:false,addEventListener:n,removeEventListener:n};this.abort=n;};',
          'var customElements = {define:function(){},get:function(){return null;},whenDefined:function(){return Promise.resolve();}};',
          'var isSecureContext = true;',
          // TextEncoder — Hermes has no native TextEncoder; self-contained polyfill
          'var TextEncoder = (function(){ try { var _T = (typeof TextEncoder !== "undefined") ? TextEncoder : null; if(_T){ var _t = new _T(); if(_t.encode) return _T; } } catch(e){} function TE(){} TE.prototype.encode = function(s){ var str=String(s),arr=[]; for(var i=0;i<str.length;i++){var c=str.charCodeAt(i);if(c<0x80)arr.push(c);else if(c<0x800){arr.push(0xc0|(c>>6));arr.push(0x80|(c&0x3f));}else{arr.push(0xe0|(c>>12));arr.push(0x80|((c>>6)&0x3f));arr.push(0x80|(c&0x3f));}} return new Uint8Array(arr); }; return TE; })();',
          // TextDecoder — same
          'var TextDecoder = (function(){ try { var _T = (typeof TextDecoder !== "undefined") ? TextDecoder : null; if(_T){ var _t = new _T(); if(_t.decode) return _T; } } catch(e){} function TD(){} TD.prototype.decode = function(u){ if(!u)return""; var b=u instanceof Uint8Array?u:new Uint8Array(u.buffer||u),out="",i=0; while(i<b.length){var c=b[i++];if(c<0x80){out+=String.fromCharCode(c);}else if(c>0xbf&&c<0xe0){out+=String.fromCharCode(((c&0x1f)<<6)|(b[i++]&0x3f));}else{out+=String.fromCharCode(((c&0x0f)<<12)|((b[i++]&0x3f)<<6)|(b[i++]&0x3f));}} return out; }; return TD; })();',
          // Response
          'var Response = (function(){ function R(body,init){this._b=body;this.status=(init&&init.status)||200;this.ok=this.status>=200&&this.status<300;this.headers={}; if(init&&init.headers){for(var k in init.headers)this.headers[k]=init.headers[k];}} R.prototype.text=function(){return Promise.resolve(String(this._b));}; R.prototype.json=function(){return Promise.resolve(JSON.parse(this._b));}; R.prototype.arrayBuffer=function(){return Promise.resolve(this._b);}; return R; })();',
          // URLSearchParams
          'var URLSearchParams = (function(){ function U(init){this._p={};if(typeof init==="string"){var pairs=init.replace(/^[?]/,"").split("&");for(var i=0;i<pairs.length;i++){var kv=pairs[i].split("=");if(kv[0])this._p[decodeURIComponent(kv[0])]=decodeURIComponent(kv[1]||"");}}else if(init&&typeof init==="object"){for(var k in init)if(Object.prototype.hasOwnProperty.call(init,k))this._p[k]=String(init[k]);}} U.prototype.get=function(k){return Object.prototype.hasOwnProperty.call(this._p,k)?this._p[k]:null;}; U.prototype.set=function(k,v){this._p[k]=String(v);}; U.prototype.append=function(k,v){this._p[k]=String(v);}; U.prototype.has=function(k){return Object.prototype.hasOwnProperty.call(this._p,k);}; U.prototype.toString=function(){var a=[];for(var k in this._p)if(Object.prototype.hasOwnProperty.call(this._p,k))a.push(encodeURIComponent(k)+"="+encodeURIComponent(this._p[k]));return a.join("&");}; return U; })();',
          // URL — NO regex (forward-slash escaping in string literals is a trap on Hermes)
          'var URL = (function(){ try { if(typeof URL!=="undefined"&&URL.prototype&&URL.prototype.toString)return URL; }catch(e){} function U(href){ this.href=href; var ci=href.indexOf(":"); this.protocol=ci>-1?href.slice(0,ci+1):"https:"; var rest=href.slice(this.protocol.length); while(rest.length>0&&rest[0]==="/")rest=rest.slice(1); var si=rest.indexOf("/"); var hostPart=si>-1?rest.slice(0,si):rest; rest=si>-1?rest.slice(si):"/"; this.host=hostPart; var hci=hostPart.indexOf(":"); this.hostname=hci>-1?hostPart.slice(0,hci):hostPart; this.port=hci>-1?hostPart.slice(hci+1):""; var qi=rest.indexOf("?"); this.pathname=qi>-1?rest.slice(0,qi):rest; this.search=qi>-1?rest.slice(qi):""; this.hash=""; this.origin=this.protocol+"//"+this.host; } U.prototype.toString=function(){return this.href;}; U.createObjectURL=function(){return"blob:https://cinejoy.to/"+Math.random().toString(36).slice(2);}; U.revokeObjectURL=function(){}; return U; })();',
          'var structuredClone = function(x){return JSON.parse(JSON.stringify(x));};',
          'var performance     = {now:function(){return Date.now();},mark:function(){},measure:function(){}};',
          'var requestAnimationFrame = function(){};',
          'var cancelAnimationFrame  = function(){};',
          'var crypto = __cj_crypto__;',
          'var atob   = __cj_atob__;',
          'var btoa   = __cj_btoa__;',
          'var fetch  = __cj_fetch__;',
          'var navigator = {userAgent:' + UA + ',language:"en",hardwareConcurrency:4,maxTouchPoints:5,onLine:true};',
          'var location  = {href:"https://cinejoy.to/",hostname:"cinejoy.to",origin:"https://cinejoy.to",pathname:"/"};',
          'var history   = {pushState:function(){},replaceState:function(){},state:null};',
          'var document = (function(){'
          + 'var n=function(){};'
          + 'var mkEl=function(t){return{tagName:t.toUpperCase(),style:{},classList:{add:n,remove:n,contains:function(){return false;},toggle:n},setAttribute:n,getAttribute:function(){return null;},addEventListener:n,removeEventListener:n,appendChild:n,removeChild:n,children:[],innerHTML:"",textContent:"",getContext:function(){return null;},canPlayType:function(){return"";},play:function(){return Promise.resolve();},pause:n,load:n};};'
          + 'return{querySelector:function(){return null;},querySelectorAll:function(){return{forEach:n,length:0};},getElementById:function(){return null;},createElement:mkEl,createTextNode:function(t){return{textContent:t};},head:{appendChild:n},body:{appendChild:n,style:{}},cookie:"",currentScript:null,addEventListener:n,removeEventListener:n,dispatchEvent:n,readyState:"complete",hidden:false};'
          + '})();',
          'var window = (function(){'
          + 'var n=function(){};'
          + 'return{'
          + 'location:{href:"https://cinejoy.to/",hostname:"cinejoy.to",origin:"https://cinejoy.to",pathname:"/"},'
          + 'navigator:{userAgent:' + UA + ',language:"en",hardwareConcurrency:4,maxTouchPoints:5,onLine:true},'
          + 'history:{pushState:n,replaceState:n,state:null},'
          + 'screen:{width:390,height:844,colorDepth:24},'
          + 'devicePixelRatio:2,'
          + 'document:document,'
          + 'HTMLElement:HTMLElement,SVGElement:SVGElement,Element:Element,Node:Node,EventTarget:EventTarget,'
          + 'HTMLMediaElement:HTMLMediaElement,HTMLVideoElement:HTMLVideoElement,HTMLAudioElement:HTMLAudioElement,'
          + 'HTMLImageElement:HTMLImageElement,HTMLCanvasElement:HTMLCanvasElement,HTMLInputElement:HTMLInputElement,'
          + 'HTMLButtonElement:HTMLButtonElement,HTMLFormElement:HTMLFormElement,HTMLSelectElement:HTMLSelectElement,'
          + 'HTMLTextAreaElement:HTMLTextAreaElement,HTMLAnchorElement:HTMLAnchorElement,'
          + 'HTMLScriptElement:HTMLScriptElement,HTMLLinkElement:HTMLLinkElement,HTMLIFrameElement:HTMLIFrameElement,'
          + 'Document:Document,Window:Window,Blob:Blob,File:File,FormData:FormData,Headers:Headers,Request:Request,'
          + 'XMLHttpRequest:XMLHttpRequest,WebSocket:WebSocket,Image:Image,MediaSource:MediaSource,CSSStyleSheet:CSSStyleSheet,'
          + 'Response:Response,URL:URL,URLSearchParams:URLSearchParams,TextEncoder:TextEncoder,TextDecoder:TextDecoder,'
          + 'isSecureContext:true,'
          + 'performance:{now:function(){return Date.now();},mark:n,measure:n},'
          + 'crypto:__cj_crypto__,'
          + 'fetch:__cj_fetch__,'
          + 'customElements:customElements,'
          + 'addEventListener:n,removeEventListener:n,dispatchEvent:n,'
          + 'requestAnimationFrame:n,cancelAnimationFrame:n,'
          + 'setTimeout:setTimeout,clearTimeout:clearTimeout,'
          + 'setInterval:setInterval,clearInterval:clearInterval'
          + '};'
          + '})();',
          'var self       = window;',
          'var globalThis = window;',
        ].join('\n');

        var fnBody = shimDecls + '\n' + clean + '\n; return typeof Ax !== "undefined" ? Ax : null;';

        var fn = new Function(
          '__cj_crypto__',
          '__cj_atob__',
          '__cj_btoa__',
          '__cj_fetch__',
          fnBody
        );

        var Ax;
        try {
          Ax = fn.call(g, polyCrypto, pureAtob, pureBtoa, fetchShim);
        } catch (evalErr) {
          console.warn(TAG + ' BOq eval error: ' + evalErr.message);
          throw evalErr;
        }
        if (!Ax && typeof g.Ax !== 'undefined') Ax = g.Ax;

        return { Ax: Ax };
      });
  }

  function getBoqBundle() {
    if (!_boqPromise) {
      _boqPromise = (IS_NODE ? loadBoqNode() : loadBoqEval()).catch(function (e) {
        _boqPromise = null;
        throw e;
      });
    }
    return _boqPromise;
  }

  // ─── Subtitles Helper ────────────────────────────────────────────────────────
  function formatSubtitles(tracks) {
    if (!Array.isArray(tracks) || !tracks.length) return [];
    var subs = [];
    for (var i = 0; i < tracks.length; i++) {
      var t = tracks[i];
      if (!t) continue;
      var file = t.file || t.url || t.src || '';
      if (!file) continue;
      var label = t.label || t.name || t.language || t.lang || ('Subtitle ' + (i + 1));
      var lang = t.lang || t.language || label;
      if (file.indexOf('http') !== 0) {
        file = SUBS_BASE + (file.indexOf('/') === 0 ? '' : '/') + file;
      }
      subs.push({ url: file, lang: lang, label: label });
    }
    return subs;
  }

  // ─── Primary Extract Function ─────────────────────────────────────────────────
  async function extract(tmdbId, imdbId, title, isTv, season, episode, year) {
    try {
      var bundle = await getBoqBundle();
      if (!bundle || !bundle.Ax) {
        console.warn(TAG + ' Ax master extractor not available in BOq bundle');
        return null;
      }

      var mediaType = isTv ? 'tv' : 'movie';
      var params = {
        tmdbId: Number(tmdbId) || tmdbId,
        imdbId: imdbId || '',
        title: title || '',
        year: year ? Number(year) : undefined,
      };

      if (isTv && season != null && episode != null) {
        params.season = Number(season);
        params.episode = Number(episode);
      }

      console.log(TAG + ' Invoking native Ax for ' + mediaType + ' tmdb:' + tmdbId + (isTv ? (' S' + season + 'E' + episode) : ''));

      var axPromise = bundle.Ax(mediaType, params, function (status) {
        if (status && status.provider) {
          console.log(TAG + ' Server [' + status.provider + ']: ' + status.status + (status.error ? (' (' + status.error + ')') : ''));
        }
      });

      var timeoutPromise = new Promise(function (_, reject) {
        setTimeout(function () { reject(new Error('Ax extraction timeout (' + TIMEOUT_MS + 'ms)')); }, TIMEOUT_MS);
      });

      var res = await Promise.race([axPromise, timeoutPromise]);
      if (!res || !res.result || !res.result.url) {
        console.warn(TAG + ' Ax returned no playable stream (failure: ' + (res && res.failure) + ')');
        return null;
      }

      var streamUrl = res.result.url;
      var captions = formatSubtitles(res.result.captions || res.result.subtitles || []);

      console.log(TAG + ' ✅ Stream extracted successfully: ' + streamUrl.substring(0, 60) + '... (' + captions.length + ' subs)');

      return {
        url: streamUrl,
        quality: 'Auto',
        provider: 'CineJoy',
        headers: {
          Referer: 'https://cinejoy.to/',
          Origin: 'https://cinejoy.to',
          'User-Agent': USER_AGENT,
        },
        subtitles: captions,
      };
    } catch (e) {
      console.error(TAG + ' Extraction failed: ' + e.message);
      return null;
    }
  }

  // ─── Module Export ────────────────────────────────────────────────────────────
  var extractor = { extract: extract };
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = extractor;
  }
  var gObj = typeof globalThis !== 'undefined' ? globalThis
    : typeof window !== 'undefined' ? window
    : typeof global !== 'undefined' ? global : this;
  if (gObj) {
    gObj.CineJoyExtractor = extractor;
  }
})();
