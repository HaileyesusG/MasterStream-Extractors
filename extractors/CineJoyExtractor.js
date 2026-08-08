/**
 * CineJoyExtractor — self-contained CommonJS JS for remote hot-update.
 * Hosted at: HaileyesusG/MasterStream-Extractors/extractors/CineJoyExtractor.js
 * Works out-of-the-box on both Mobile App (React Native) and Native TV App (Android WebView).
 */
(function () {
  var TAG = '[CineJoyExtractor]';
  var FETCH_HEADERS = {
    Accept: '*/*',
    Origin: 'https://cinejoy.to',
    Referer: 'https://cinejoy.to/',
    'User-Agent':
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36',
  };

  // ── Self-contained minified @noble/hashes ES6 bundle for ultra-fast V8 scrypt ──
  "use strict";(()=>{var Lt=Object.defineProperty;var q=Math.pow,Ht=(t,e,n)=>e in t?Lt(t,e,{enumerable:!0,configurable:!0,writable:!0,value:n}):t[e]=n;var l=(t,e,n)=>Ht(t,typeof e!="symbol"?e+"":e,n);function it(t){return t instanceof Uint8Array||ArrayBuffer.isView(t)&&t.constructor.name==="Uint8Array"&&"BYTES_PER_ELEMENT"in t&&t.BYTES_PER_ELEMENT===1}var et=t=>t?`"${t}" `:"";function w(t,e=""){if(typeof t!="number")throw new TypeError(et(e)+"expected number, got "+typeof t);if(!Number.isSafeInteger(t)||t<0)throw new RangeError(et(e)+"expected integer >= 0, got "+t);return t}function R(t,e,n=""){if(it(t)&&(e===void 0||t.length===e))return t;e!==void 0&&w(e,"length");let o=it(t),r=e!==void 0?` of length ${e}`:"",s=o?`length=${t.length}`:`type=${typeof t}`,f=et(n)+"expected Uint8Array"+r+", got "+s;throw o?new RangeError(f):new TypeError(f)}function Q(t){if(typeof t!="function"||typeof t.create!="function")throw new TypeError("expected hash wrapped by utils.createHasher");if(w(t.outputLen),w(t.blockLen),t.outputLen<1||t.blockLen<1)throw new Error("hash blockLen / outputLen must be >= 1")}var xt=(t,e)=>{if(t===null||typeof t!="object"||Array.isArray(t))throw new TypeError((e==="object"?"":`"${e}" `)+"expected object, got type="+typeof t)};function W(t,e=!0){if(t.destroyed)throw new Error("hash was destroyed");if(e&&t.finished)throw new Error("digest() was already called")}function V(t,e){R(t,void 0,"output");let n=e.outputLen;if(!(t.length>=n))throw new RangeError('"output" expected length >= '+n)}function Z(t){return new Uint32Array(t.buffer,t.byteOffset,Math.floor(t.byteLength/4))}function A(...t){for(let e=0;e<t.length;e++)t[e].fill(0)}function K(t){return new DataView(t.buffer,t.byteOffset,t.byteLength)}function H(t,e){return t<<32-e|t>>>e}function h(t,e){return t<<e|t>>>32-e>>>0}var At=new Uint8Array(new Uint32Array([287454020]).buffer)[0]===68;function Et(t){return t<<24&4278190080|t<<8&16711680|t>>>8&65280|t>>>24&255}function kt(t){for(let e=0;e<t.length;e++)t[e]=Et(t[e]);return t}var nt=At?t=>t:kt;function Bt(t){if(typeof t!="string")throw new TypeError("string expected");return new Uint8Array(new TextEncoder().encode(t))}function ot(t,e=""){return typeof t=="string"?Bt(t):R(t,void 0,e)}function z(t,e,n="opts"){return xt(t,"defaults"),e!==void 0&&xt(e,n),Object.assign(t,e)}function ht(t,e={}){if(typeof t!="function")throw new TypeError('"hashCons" expected function, got type='+typeof t);e=z({},e,"info");let n=(r,s)=>t(s).update(r).digest(),o=t(void 0);return n.outputLen=o.outputLen,n.blockLen=o.blockLen,n.canXOF=o.canXOF,n.create=r=>t(r),Object.assign(n,e),Object.freeze(n)}var ut=t=>({oid:Uint8Array.from([6,9,96,134,72,1,101,3,4,2,t])});var v=class{constructor(e,n){l(this,"oHash");l(this,"iHash");l(this,"blockLen");l(this,"outputLen");l(this,"canXOF",!1);l(this,"finished",!1);l(this,"destroyed",!1);if(Q(e),R(n,void 0,"key"),this.iHash=e.create(),typeof this.iHash.update!="function")throw new Error("expected Hash instance");this.blockLen=this.iHash.blockLen,this.outputLen=this.iHash.outputLen;let o=this.blockLen,r=new Uint8Array(o);r.set(n.length>o?e.create().update(n).digest():n);for(let s=0;s<r.length;s++)r[s]^=54;this.iHash.update(r),this.oHash=e.create();for(let s=0;s<r.length;s++)r[s]^=106;this.oHash.update(r),A(r)}update(e){return W(this),this.iHash.update(e),this}digestInto(e){W(this),V(e,this),this.finished=!0;let n=e.subarray(0,this.outputLen);this.iHash.digestInto(n),this.oHash.update(n),this.oHash.digestInto(n),this.destroy()}digest(){let e=new Uint8Array(this.oHash.outputLen);return this.digestInto(e),e}_cloneInto(e){e||(e=Object.create(Object.getPrototypeOf(this),{}));let{oHash:n,iHash:o,finished:r,destroyed:s,blockLen:f,outputLen:c,canXOF:a}=this;return e=e,e.finished=r,e.destroyed=s,e.blockLen=f,e.outputLen=c,e.canXOF=a,e.oHash=n._cloneInto(e.oHash),e.iHash=o._cloneInto(e.iHash),e}clone(){return this._cloneInto()}destroy(){this.destroyed=!0,this.oHash.destroy(),this.iHash.destroy()}},lt=(()=>{let t=((e,n,o)=>new v(e,n).update(o).digest());return t.create=(e,n)=>new v(e,n),t})();function St(t,e,n,o){Q(t);let r=z({dkLen:32,asyncTick:10},o),{c:s,dkLen:f,asyncTick:c}=r;if(w(s,"c"),w(f,"dkLen"),w(c,"asyncTick"),s<1)throw new Error('"c" (iterations) must be >= 1');if(f<1)throw new Error('"dkLen" must be >= 1');if(f>(q(2,32)-1)*t.outputLen)throw new Error("derived key too long");let a=ot(e,"password"),i=ot(n,"salt"),d=new Uint8Array(f),{iHash:x,oHash:u,outputLen:b}=lt.create(t,a),y=new Uint8Array(b),p=Tt(x,u,i,y);return{c:s,dkLen:f,asyncTick:c,DK:d,outputLen:b,eng:p}}function Tt(t,e,n,o){let r=new Uint8Array(4),s=K(r),f=t._cloneInto().update(n),c=e._cloneInto(),a=t._cloneInto,i=e._cloneInto;return{u1:(d,x)=>{s.setInt32(0,d,!1),f._cloneInto(c).update(r).digestInto(o),e._cloneInto(c).update(o).digestInto(o),x.set(o.subarray(0,x.length))},rounds:(d,x)=>{for(let u=1;u<d;u++){a.call(t,c).update(o).digestInto(o),i.call(e,c).update(o).digestInto(o);for(let b=0;b<x.length;b++)x[b]^=o[b]}},output:d=>(t.destroy(),e.destroy(),f.destroy(),c.destroy(),A(o),d)}}function rt(t,e,n,o){let{c:r,dkLen:s,DK:f,outputLen:c,eng:a}=St(t,e,n,o);for(let i=1,d=0;d<s;i++,d+=c){let x=f.subarray(d,d+c);a.u1(i,x),a.rounds(r,x)}return a.output(f)}var _t=t=>t/q(2,32)|0,Ct=t=>t>>>0;function bt(t,e,n,o){let r=_t(n),s=Ct(n);t.setUint32(e,o?s:r,o),t.setUint32(e+4,o?r:s,o)}function pt(t,e,n){return t&e^~t&n}function yt(t,e,n){return t&e^t&n^e&n}var tt=class{constructor(e,n,o,r){l(this,"blockLen");l(this,"outputLen");l(this,"canXOF",!1);l(this,"padOffset");l(this,"isLE");l(this,"buffer");l(this,"view");l(this,"finished",!1);l(this,"length",0);l(this,"pos",0);l(this,"destroyed",!1);this.blockLen=e,this.outputLen=n,this.padOffset=o,this.isLE=r,this.buffer=new Uint8Array(e),this.view=K(this.buffer)}update(e){W(this),R(e);let{view:n,buffer:o,blockLen:r}=this,s=e.length,f=!1;for(let c=0;c<s;){let a=Math.min(r-this.pos,s-c);if(a===r){let i=K(e);for(;r<=s-c;c+=r)this.process(i,c);f=!0;continue}o.set(c===0&&a===s?e:e.subarray(c,c+a),this.pos),this.pos+=a,c+=a,this.pos===r&&(this.process(n,0),this.pos=0,f=!0)}return this.length+=e.length,f&&this.roundClean(),this}digestInto(e){W(this),V(e,this),this.finished=!0;let{buffer:n,view:o,blockLen:r,isLE:s}=this,{pos:f}=this;n[f++]=128,n.fill(0,f),this.padOffset>r-f&&(this.process(o,0),n.fill(0)),bt(o,r-8,this.length*8,s),this.process(o,0),this.roundClean();let c=e===n?o:K(e),a=this.outputLen,i=a/4,d=this.get();if(a%4||i>d.length)throw new Error("invalid outputLen");for(let x=0;x<i;x++)c.setUint32(4*x,d[x],s)}digest(){let{buffer:e,outputLen:n}=this;this.digestInto(e);let o=e.slice(0,n);return this.destroy(),o}_cloneIntoMeta(e){let{buffer:n,length:o,finished:r,destroyed:s,pos:f}=this;return e.destroyed=s,e.finished=r,e.length=o,e.pos=f,f&&e.buffer.set(n),e}clone(){return this._cloneInto()}destroy(){this.destroyed=!0,this.set(0,0,0,0,0,0,0,0),A(this.buffer)}},wt=Uint32Array.from([1779033703,3144134277,1013904242,2773480762,1359893119,2600822924,528734635,1541459225]);var It=Uint32Array.from([1116352408,1899447441,3049323471,3921009573,961987163,1508970993,2453635748,2870763221,3624381080,310598401,607225278,1426881987,1925078388,2162078206,2614888103,3248222580,3835390401,4022224774,264347078,604807628,770255983,1249150122,1555081692,1996064986,2554220882,2821834349,2952996808,3210313671,3336571891,3584528711,113926993,338241895,666307205,773529912,1294757372,1396182291,1695183700,1986661051,2177026350,2456956037,2730485921,2820302411,3259730800,3345764771,3516065817,3600352804,4094571909,275423344,430227734,506948616,659060556,883997877,958139571,1322822218,1537002063,1747873779,1955562222,2024104815,2227730452,2361852424,2428436474,2756734187,3204031479,3329325298]),k=new Uint32Array(64),st=class extends tt{constructor(n,o){super(64,n,8,!1);l(this,"A",0);l(this,"B",0);l(this,"C",0);l(this,"D",0);l(this,"E",0);l(this,"F",0);l(this,"G",0);l(this,"H",0);this.A=o[0]|0,this.B=o[1]|0,this.C=o[2]|0,this.D=o[3]|0,this.E=o[4]|0,this.F=o[5]|0,this.G=o[6]|0,this.H=o[7]|0}get(){let{A:n,B:o,C:r,D:s,E:f,F:c,G:a,H:i}=this;return[n,o,r,s,f,c,a,i]}set(n,o,r,s,f,c,a,i){this.A=n|0,this.B=o|0,this.C=r|0,this.D=s|0,this.E=f|0,this.F=c|0,this.G=a|0,this.H=i|0}_cloneInto(n){return(n||(n=new this.constructor)).set(...this.get()),this._cloneIntoMeta(n)}process(n,o){for(let u=0;u<16;u++,o+=4)k[u]=n.getUint32(o,!1);for(let u=16;u<64;u++){let b=k[u-15],y=k[u-2],p=H(b,7)^H(b,18)^b>>>3,g=H(y,17)^H(y,19)^y>>>10;k[u]=g+k[u-7]+p+k[u-16]|0}let{A:r,B:s,C:f,D:c,E:a,F:i,G:d,H:x}=this;for(let u=0;u<64;u++){let b=H(a,6)^H(a,11)^H(a,25),y=x+b+pt(a,i,d)+It[u]+k[u]|0,g=(H(r,2)^H(r,13)^H(r,22))+yt(r,s,f)|0;x=d,d=i,i=a,a=c+y|0,c=f,f=s,s=r,r=y+g|0}r=r+this.A|0,s=s+this.B|0,f=f+this.C|0,c=c+this.D|0,a=a+this.E|0,i=i+this.F|0,d=d+this.G|0,x=x+this.H|0,this.set(r,s,f,c,a,i,d,x)}roundClean(){A(k)}destroy(){this.destroyed=!0,this.set(0,0,0,0,0,0,0,0),A(this.buffer)}},ct=class extends st{constructor(){super(32,wt)}};var J=ht(()=>new ct,ut(1));function gt(t,e,n,o,r,s){let f=t[e++]^n[o++],c=t[e++]^n[o++],a=t[e++]^n[o++],i=t[e++]^n[o++],d=t[e++]^n[o++],x=t[e++]^n[o++],u=t[e++]^n[o++],b=t[e++]^n[o++],y=t[e++]^n[o++],p=t[e++]^n[o++],g=t[e++]^n[o++],L=t[e++]^n[o++],P=t[e++]^n[o++],X=t[e++]^n[o++],$=t[e++]^n[o++],Y=t[e++]^n[o++],m=f,E=c,B=a,U=i,S=d,T=x,_=u,C=b,I=y,F=p,D=g,O=L,M=P,G=X,j=$,N=Y;for(let at=0;at<8;at+=2)S^=h(m+M|0,7),I^=h(S+m|0,9),M^=h(I+S|0,13),m^=h(M+I|0,18),F^=h(T+E|0,7),G^=h(F+T|0,9),E^=h(G+F|0,13),T^=h(E+G|0,18),j^=h(D+_|0,7),B^=h(j+D|0,9),_^=h(B+j|0,13),D^=h(_+B|0,18),U^=h(N+O|0,7),C^=h(U+N|0,9),O^=h(C+U|0,13),N^=h(O+C|0,18),E^=h(m+U|0,7),B^=h(E+m|0,9),U^=h(B+E|0,13),m^=h(U+B|0,18),_^=h(T+S|0,7),C^=h(_+T|0,9),S^=h(C+_|0,13),T^=h(S+C|0,18),O^=h(D+F|0,7),I^=h(O+D|0,9),F^=h(I+O|0,13),D^=h(F+I|0,18),M^=h(N+j|0,7),G^=h(M+N|0,9),j^=h(G+M|0,13),N^=h(j+G|0,18);r[s++]=f+m|0,r[s++]=c+E|0,r[s++]=a+B|0,r[s++]=i+U|0,r[s++]=d+S|0,r[s++]=x+T|0,r[s++]=u+_|0,r[s++]=b+C|0,r[s++]=y+I|0,r[s++]=p+F|0,r[s++]=g+D|0,r[s++]=L+O|0,r[s++]=P+M|0,r[s++]=X+G|0,r[s++]=$+j|0,r[s++]=Y+N|0}function ft(t,e,n,o,r){let s=o+0,f=o+16*r;for(let c=0;c<16;c++)n[f+c]=t[e+(2*r-1)*16+c];for(let c=0;c<r;c++,s+=16,e+=16)gt(n,f,t,e,n,s),c>0&&(f+=16),gt(n,s,t,e+=16,n,f)}function Ft(t,e,n){let o=z({dkLen:32,asyncTick:10,maxmem:1073742848},n),{N:r,r:s,p:f,dkLen:c,asyncTick:a,maxmem:i,onProgress:d}=o;if(w(r,"N"),w(s,"r"),w(f,"p"),w(c,"dkLen"),w(a,"asyncTick"),w(i,"maxmem"),d!==void 0&&typeof d!="function")throw new Error('"onProgress" must be a function');if(s<1)throw new Error('"r" expected integer >= 1');let x=128*s,u=x/4,b=Math.pow(2,32);if(r<=1||(r&r-1)!==0||r>b)throw new Error('"N" expected a power of 2, and 2^1 <= N <= 2^32');if(f<1||f>(b-1)*32/x)throw new Error('"p" expected integer 1..((2^32 - 1) * 32) / (128 * r)');if(c<1||c>(b-1)*32)throw new Error('"dkLen" expected integer 1..(2^32 - 1) * 32');let y=x*(r+f+1);if(y>i)throw new Error('"maxmem" limit was hit: memUsed(128*r*(N+p+1))='+y+", maxmem="+i);let p=rt(J,t,e,{c:1,dkLen:x*f}),g=Z(p),L=Z(new Uint8Array(x*r)),P=Z(new Uint8Array(x)),X=()=>{};if(d){let $=2*r*f,Y=Math.max(Math.floor($/1e4),1),m=0;X=()=>{if(m++,d&&(!(m%Y)||m===$))try{d(m/$)}catch(E){throw A(p,L,P),E}}}return{N:r,r:s,p:f,dkLen:c,blockSize32:u,V:L,B32:g,B:p,tmp:P,blockMixCb:X,asyncTick:a}}function Dt(t,e,n,o,r){let s=rt(J,t,n,{c:1,dkLen:e});return A(n,o,r),s}function mt(t,e,n){let{N:o,r,p:s,dkLen:f,blockSize32:c,V:a,B32:i,B:d,tmp:x,blockMixCb:u}=Ft(t,e,n);nt(i);for(let b=0;b<s;b++){let y=c*b;for(let p=0;p<c;p++)a[p]=i[y+p];for(let p=0,g=0;p<o-1;p++)ft(a,g,a,g+=c,r),u();ft(a,(o-1)*c,i,y,r),u();for(let p=0;p<o;p++){let g=(i[y+c-16]&o-1)>>>0;for(let L=0;L<c;L++)x[L]=i[y+L]^a[g*c+L];ft(x,0,i,y,r),u()}}return nt(i),Dt(t,f,d,a,x)}window.nobleScrypt=mt;window.nobleSha256=J;})();

  function countZeroBits(data) {
    var count = 0;
    for (var i = 0; i < data.length; i++) {
      var b = data[i];
      if (b === 0) { count += 8; continue; }
      count += Math.clz32(b) - 24;
      break;
    }
    return count;
  }

  async function fetchGet(url, extra) {
    try {
      var res = await fetch(url, { headers: Object.assign({}, FETCH_HEADERS, extra || {}), redirect: 'follow' });
      if (!res.ok) return null;
      return await res.text();
    } catch (e) {
      return null;
    }
  }

  async function fetchPost(url, body) {
    try {
      var res = await fetch(url, {
        method: 'POST',
        headers: Object.assign({ 'Content-Type': 'application/json' }, FETCH_HEADERS),
        body: JSON.stringify(body),
        redirect: 'follow',
      });
      if (!res.ok) return null;
      return await res.text();
    } catch (e) {
      return null;
    }
  }

  function parseStream(decJson, server) {
    if (decJson.status !== 200 || !decJson.result) return null;
    var result = decJson.result;
    var streams = Array.isArray(result.stream) ? result.stream :
                  Array.isArray(result.streams) ? result.streams :
                  Array.isArray(result.sources) ? result.sources : [];
    if (!streams.length) return null;
    var best = streams.find(function(s) { return s.type === 'hls' || (s.playlist || '').indexOf('.m3u8') !== -1; }) || streams[0];
    var streamUrl = best.playlist || best.url || best.file || best.src || '';
    if (!streamUrl) return null;

    var subtitles = [];
    var caps = Array.isArray(best.captions) ? best.captions :
               Array.isArray(result.subtitles) ? result.subtitles :
               Array.isArray(result.tracks) ? result.tracks : [];
    for (var i = 0; i < caps.length; i++) {
      var cap = caps[i];
      var url = cap.url || cap.file || '';
      var lang = cap.language || cap.label || cap.lang || 'Unknown';
      if (url) subtitles.push({ url: url, lang: lang, label: lang });
    }
    return {
      url: streamUrl,
      quality: 'Auto',
      provider: 'CineJoy',
      headers: {
        Referer: 'https://cinejoy.to/',
        Origin: 'https://cinejoy.to',
        'User-Agent': FETCH_HEADERS['User-Agent'],
      },
      subtitles: subtitles,
    };
  }

  async function extract(tmdbId, imdbId, title, isTv, season, episode, year) {
    try {
      var serversRaw = await fetchGet('https://api.shegu.st/servers');
      if (!serversRaw) return null;
      var serversJson;
      try { serversJson = JSON.parse(serversRaw); } catch (e) { return null; }
      var servers = (serversJson.servers || []).map(function(s) { return s.name; });
      if (!servers.length) return null;

      for (var i = 0; i < servers.length; i++) {
        var server = servers[i];
        var paramsObj = {
          title: title || '',
          type: isTv ? 'series' : 'movie',
          year: year || '',
          imdb: imdbId || '',
          tmdb: String(tmdbId),
          server: server,
        };
        if (isTv && season != null && episode != null) {
          paramsObj.season = String(season);
          paramsObj.episode = String(episode);
        }
        var params = new URLSearchParams(paramsObj);
        var sourceUrl = 'https://api.shegu.st/?' + params.toString();

        var encRaw = await fetchGet('https://enc-dec.app/api/enc-cinejoy?url=' + encodeURIComponent(sourceUrl));
        if (!encRaw) continue;
        var encJson;
        try { encJson = JSON.parse(encRaw); } catch (e) { continue; }
        if (encJson.status !== 200 || !encJson.result) continue;
        var enc = encJson.result;

        var encrypted = null;
        var fastRaw = await fetchGet('https://enc-dec.app/api/fetch-cinejoy?enc=' + encodeURIComponent(enc));
        if (fastRaw) {
          try {
            var fastJson = JSON.parse(fastRaw);
            if (fastJson && fastJson.status === 200 && fastJson.result) {
              encrypted = fastJson.result;
            }
          } catch (e) {}
        }

        if (!encrypted) {
          var challengeRaw = await fetchGet('https://api.shegu.st/challenge?rid=' + enc);
          if (!challengeRaw) continue;
          var challenge;
          try { challenge = JSON.parse(challengeRaw); } catch (e) { continue; }

          var solution;
          try {
            // Priority 1: Use ScryptSolverBridge if available (React Native bridge)
            var gObj = typeof globalThis !== 'undefined' ? globalThis : (typeof window !== 'undefined' ? window : (typeof global !== 'undefined' ? global : this));
            var bridge = gObj.ScryptSolverBridge;
            if (bridge && bridge.available) {
              solution = await bridge.solve(challenge);
            } else {
              // Priority 2: Direct in-V8 scrypt solving (works in Android WebView / RemoteJsExtractor)
              var te = new TextEncoder();
              var salt = window.nobleSha256(te.encode('pow2-salt|' + challenge.s + '|' + challenge.b));
              var counter = 0;
              while (true) {
                var pw = te.encode('pow2|' + challenge.b + '|' + challenge.s + '|' + counter);
                var dk = window.nobleScrypt(pw, salt, { N: challenge.n, r: challenge.r, p: challenge.p, dkLen: 32 });
                if (countZeroBits(dk) >= challenge.d) break;
                counter++;
              }
              solution = btoa(JSON.stringify(Object.assign({}, challenge, { c: counter })));
            }
          } catch (e) {
            console.warn(TAG + ' PoW solve failed: ' + e.message);
            continue;
          }

          encrypted = await fetchGet('https://api.shegu.st/' + enc, { 'x-at': solution });
        }

        if (!encrypted || !encrypted.trim()) continue;

        var decRaw = await fetchPost('https://enc-dec.app/api/dec-cinejoy', { text: encrypted });
        if (!decRaw) continue;
        var decJson;
        try { decJson = JSON.parse(decRaw); } catch (e) { continue; }
        var result = parseStream(decJson, server);
        if (result) return result;
      }
      return null;
    } catch (e) {
      console.error(TAG + ' Error: ' + e.message);
      return null;
    }
  }

  module.exports = { extract: extract };
})();
