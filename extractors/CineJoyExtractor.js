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

  // ── Self-contained minified @noble/hashes bundle for ultra-fast V8 scrypt ──
  "use strict";(()=>{function ft(e){return e instanceof Uint8Array||ArrayBuffer.isView(e)&&e.constructor.name==="Uint8Array"&&"BYTES_PER_ELEMENT"in e&&e.BYTES_PER_ELEMENT===1}var v=e=>e?`"${e}" `:"";function y(e,t=""){if(typeof e!="number")throw new TypeError(v(t)+"expected number, got "+typeof e);if(!Number.isSafeInteger(e)||e<0)throw new RangeError(v(t)+"expected integer >= 0, got "+e);return e}function $(e,t,n=""){if(ft(e)&&(t===void 0||e.length===t))return e;t!==void 0&&y(t,"length");let o=ft(e),r=t!==void 0?` of length ${t}`:"",s=o?`length=${e.length}`:`type=${typeof e}`,f=v(n)+"expected Uint8Array"+r+", got "+s;throw o?new RangeError(f):new TypeError(f)}function Y(e){if(typeof e!="function"||typeof e.create!="function")throw new TypeError("expected hash wrapped by utils.createHasher");if(y(e.outputLen),y(e.blockLen),e.outputLen<1||e.blockLen<1)throw new Error("hash blockLen / outputLen must be >= 1")}var at=(e,t)=>{if(e===null||typeof e!="object"||Array.isArray(e))throw new TypeError((t==="object"?"":`"${t}" `)+"expected object, got type="+typeof e)};function R(e,t=!0){if(e.destroyed)throw new Error("hash was destroyed");if(t&&e.finished)throw new Error("digest() was already called")}function q(e,t){$(e,void 0,"output");let n=t.outputLen;if(!(e.length>=n))throw new RangeError('"output" expected length >= '+n)}function Q(e){return new Uint32Array(e.buffer,e.byteOffset,Math.floor(e.byteLength/4))}function L(...e){for(let t=0;t<e.length;t++)e[t].fill(0)}function W(e){return new DataView(e.buffer,e.byteOffset,e.byteLength)}function m(e,t){return e<<32-t|e>>>t}function d(e,t){return e<<t|e>>>32-t>>>0}var wt=new Uint8Array(new Uint32Array([287454020]).buffer)[0]===68;function gt(e){return e<<24&4278190080|e<<8&16711680|e>>>8&65280|e>>>24&255}function mt(e){for(let t=0;t<e.length;t++)e[t]=gt(e[t]);return e}var tt=wt?e=>e:mt;function Lt(e){if(typeof e!="string")throw new TypeError("string expected");return new Uint8Array(new TextEncoder().encode(e))}function et(e,t=""){return typeof e=="string"?Lt(e):$(e,void 0,t)}function X(e,t,n="opts"){return at(e,"defaults"),t!==void 0&&at(t,n),Object.assign(e,t)}function it(e,t={}){if(typeof e!="function")throw new TypeError('"hashCons" expected function, got type='+typeof e);t=X({},t,"info");let n=(r,s)=>e(s).update(r).digest(),o=e(void 0);return n.outputLen=o.outputLen,n.blockLen=o.blockLen,n.canXOF=o.canXOF,n.create=r=>e(r),Object.assign(n,t),Object.freeze(n)}var xt=e=>({oid:Uint8Array.from([6,9,96,134,72,1,101,3,4,2,e])});var V=class{oHash;iHash;blockLen;outputLen;canXOF=!1;finished=!1;destroyed=!1;constructor(t,n){if(Y(t),$(n,void 0,"key"),this.iHash=t.create(),typeof this.iHash.update!="function")throw new Error("expected Hash instance");this.blockLen=this.iHash.blockLen,this.outputLen=this.iHash.outputLen;let o=this.blockLen,r=new Uint8Array(o);r.set(n.length>o?t.create().update(n).digest():n);for(let s=0;s<r.length;s++)r[s]^=54;this.iHash.update(r),this.oHash=t.create();for(let s=0;s<r.length;s++)r[s]^=106;this.oHash.update(r),L(r)}update(t){return R(this),this.iHash.update(t),this}digestInto(t){R(this),q(t,this),this.finished=!0;let n=t.subarray(0,this.outputLen);this.iHash.digestInto(n),this.oHash.update(n),this.oHash.digestInto(n),this.destroy()}digest(){let t=new Uint8Array(this.oHash.outputLen);return this.digestInto(t),t}_cloneInto(t){t||=Object.create(Object.getPrototypeOf(this),{});let{oHash:n,iHash:o,finished:r,destroyed:s,blockLen:f,outputLen:c,canXOF:i}=this;return t=t,t.finished=r,t.destroyed=s,t.blockLen=f,t.outputLen=c,t.canXOF=i,t.oHash=n._cloneInto(t.oHash),t.iHash=o._cloneInto(t.iHash),t}clone(){return this._cloneInto()}destroy(){this.destroyed=!0,this.oHash.destroy(),this.iHash.destroy()}},dt=(()=>{let e=((t,n,o)=>new V(t,n).update(o).digest());return e.create=(t,n)=>new V(t,n),e})();function At(e,t,n,o){Y(e);let r=X({dkLen:32,asyncTick:10},o),{c:s,dkLen:f,asyncTick:c}=r;if(y(s,"c"),y(f,"dkLen"),y(c,"asyncTick"),s<1)throw new Error('"c" (iterations) must be >= 1');if(f<1)throw new Error('"dkLen" must be >= 1');if(f>(2**32-1)*e.outputLen)throw new Error("derived key too long");let i=et(t,"password"),x=et(n,"salt"),h=new Uint8Array(f),{iHash:a,oHash:b,outputLen:u}=dt.create(e,i),p=new Uint8Array(u),l=Et(a,b,x,p);return{c:s,dkLen:f,asyncTick:c,DK:h,outputLen:u,eng:l}}function Et(e,t,n,o){let r=new Uint8Array(4),s=W(r),f=e._cloneInto().update(n),c=t._cloneInto(),i=e._cloneInto,x=t._cloneInto;return{u1:(h,a)=>{s.setInt32(0,h,!1),f._cloneInto(c).update(r).digestInto(o),t._cloneInto(c).update(o).digestInto(o),a.set(o.subarray(0,a.length))},rounds:(h,a)=>{for(let b=1;b<h;b++){i.call(e,c).update(o).digestInto(o),x.call(t,c).update(o).digestInto(o);for(let u=0;u<a.length;u++)a[u]^=o[u]}},output:h=>(e.destroy(),t.destroy(),f.destroy(),c.destroy(),L(o),h)}}function nt(e,t,n,o){let{c:r,dkLen:s,DK:f,outputLen:c,eng:i}=At(e,t,n,o);for(let x=1,h=0;h<s;x++,h+=c){let a=f.subarray(h,h+c);i.u1(x,a),i.rounds(r,a)}return i.output(f)}var kt=e=>e/2**32|0,Bt=e=>e>>>0;function ht(e,t,n,o){let r=kt(n),s=Bt(n);e.setUint32(t,o?s:r,o),e.setUint32(t+4,o?r:s,o)}function ut(e,t,n){return e&t^~e&n}function lt(e,t,n){return e&t^e&n^t&n}var Z=class{blockLen;outputLen;canXOF=!1;padOffset;isLE;buffer;view;finished=!1;length=0;pos=0;destroyed=!1;constructor(t,n,o,r){this.blockLen=t,this.outputLen=n,this.padOffset=o,this.isLE=r,this.buffer=new Uint8Array(t),this.view=W(this.buffer)}update(t){R(this),$(t);let{view:n,buffer:o,blockLen:r}=this,s=t.length,f=!1;for(let c=0;c<s;){let i=Math.min(r-this.pos,s-c);if(i===r){let x=W(t);for(;r<=s-c;c+=r)this.process(x,c);f=!0;continue}o.set(c===0&&i===s?t:t.subarray(c,c+i),this.pos),this.pos+=i,c+=i,this.pos===r&&(this.process(n,0),this.pos=0,f=!0)}return this.length+=t.length,f&&this.roundClean(),this}digestInto(t){R(this),q(t,this),this.finished=!0;let{buffer:n,view:o,blockLen:r,isLE:s}=this,{pos:f}=this;n[f++]=128,n.fill(0,f),this.padOffset>r-f&&(this.process(o,0),n.fill(0)),ht(o,r-8,this.length*8,s),this.process(o,0),this.roundClean();let c=t===n?o:W(t),i=this.outputLen,x=i/4,h=this.get();if(i%4||x>h.length)throw new Error("invalid outputLen");for(let a=0;a<x;a++)c.setUint32(4*a,h[a],s)}digest(){let{buffer:t,outputLen:n}=this;this.digestInto(t);let o=t.slice(0,n);return this.destroy(),o}_cloneIntoMeta(t){let{buffer:n,length:o,finished:r,destroyed:s,pos:f}=this;return t.destroyed=s,t.finished=r,t.length=o,t.pos=f,f&&t.buffer.set(n),t}clone(){return this._cloneInto()}destroy(){this.destroyed=!0,this.set(0,0,0,0,0,0,0,0),L(this.buffer)}},bt=Uint32Array.from([1779033703,3144134277,1013904242,2773480762,1359893119,2600822924,528734635,1541459225]);var Ut=Uint32Array.from([1116352408,1899447441,3049323471,3921009573,961987163,1508970993,2453635748,2870763221,3624381080,310598401,607225278,1426881987,1925078388,2162078206,2614888103,3248222580,3835390401,4022224774,264347078,604807628,770255983,1249150122,1555081692,1996064986,2554220882,2821834349,2952996808,3210313671,3336571891,3584528711,113926993,338241895,666307205,773529912,1294757372,1396182291,1695183700,1986661051,2177026350,2456956037,2730485921,2820302411,3259730800,3345764771,3516065817,3600352804,4094571909,275423344,430227734,506948616,659060556,883997877,958139571,1322822218,1537002063,1747873779,1955562222,2024104815,2227730452,2361852424,2428436474,2756734187,3204031479,3329325298]),E=new Uint32Array(64),ot=class extends Z{A=0;B=0;C=0;D=0;E=0;F=0;G=0;H=0;constructor(t,n){super(64,t,8,!1),this.A=n[0]|0,this.B=n[1]|0,this.C=n[2]|0,this.D=n[3]|0,this.E=n[4]|0,this.F=n[5]|0,this.G=n[6]|0,this.H=n[7]|0}get(){let{A:t,B:n,C:o,D:r,E:s,F:f,G:c,H:i}=this;return[t,n,o,r,s,f,c,i]}set(t,n,o,r,s,f,c,i){this.A=t|0,this.B=n|0,this.C=o|0,this.D=r|0,this.E=s|0,this.F=f|0,this.G=c|0,this.H=i|0}_cloneInto(t){return(t||=new this.constructor).set(...this.get()),this._cloneIntoMeta(t)}process(t,n){for(let a=0;a<16;a++,n+=4)E[a]=t.getUint32(n,!1);for(let a=16;a<64;a++){let b=E[a-15],u=E[a-2],p=m(b,7)^m(b,18)^b>>>3,l=m(u,17)^m(u,19)^u>>>10;E[a]=l+E[a-7]+p+E[a-16]|0}let{A:o,B:r,C:s,D:f,E:c,F:i,G:x,H:h}=this;for(let a=0;a<64;a++){let b=m(c,6)^m(c,11)^m(c,25),u=h+b+ut(c,i,x)+Ut[a]+E[a]|0,l=(m(o,2)^m(o,13)^m(o,22))+lt(o,r,s)|0;h=x,x=i,i=c,c=f+u|0,f=s,s=r,r=o,o=u+l|0}o=o+this.A|0,r=r+this.B|0,s=s+this.C|0,f=f+this.D|0,c=c+this.E|0,i=i+this.F|0,x=x+this.G|0,h=h+this.H|0,this.set(o,r,s,f,c,i,x,h)}roundClean(){L(E)}destroy(){this.destroyed=!0,this.set(0,0,0,0,0,0,0,0),L(this.buffer)}},rt=class extends ot{constructor(){super(32,bt)}};var z=it(()=>new rt,xt(1));function pt(e,t,n,o,r,s){let f=e[t++]^n[o++],c=e[t++]^n[o++],i=e[t++]^n[o++],x=e[t++]^n[o++],h=e[t++]^n[o++],a=e[t++]^n[o++],b=e[t++]^n[o++],u=e[t++]^n[o++],p=e[t++]^n[o++],l=e[t++]^n[o++],H=e[t++]^n[o++],g=e[t++]^n[o++],K=e[t++]^n[o++],P=e[t++]^n[o++],N=e[t++]^n[o++],J=e[t++]^n[o++],w=f,A=c,k=i,B=x,U=h,S=a,T=b,_=u,C=p,I=l,F=H,D=g,O=K,M=P,G=N,j=J;for(let ct=0;ct<8;ct+=2)U^=d(w+O|0,7),C^=d(U+w|0,9),O^=d(C+U|0,13),w^=d(O+C|0,18),I^=d(S+A|0,7),M^=d(I+S|0,9),A^=d(M+I|0,13),S^=d(A+M|0,18),G^=d(F+T|0,7),k^=d(G+F|0,9),T^=d(k+G|0,13),F^=d(T+k|0,18),B^=d(j+D|0,7),_^=d(B+j|0,9),D^=d(_+B|0,13),j^=d(D+_|0,18),A^=d(w+B|0,7),k^=d(A+w|0,9),B^=d(k+A|0,13),w^=d(B+k|0,18),T^=d(S+U|0,7),_^=d(T+S|0,9),U^=d(_+T|0,13),S^=d(U+_|0,18),D^=d(F+I|0,7),C^=d(D+F|0,9),I^=d(C+D|0,13),F^=d(I+C|0,18),O^=d(j+G|0,7),M^=d(O+j|0,9),G^=d(M+O|0,13),j^=d(G+M|0,18);r[s++]=f+w|0,r[s++]=c+A|0,r[s++]=i+k|0,r[s++]=x+B|0,r[s++]=h+U|0,r[s++]=a+S|0,r[s++]=b+T|0,r[s++]=u+_|0,r[s++]=p+C|0,r[s++]=l+I|0,r[s++]=H+F|0,r[s++]=g+D|0,r[s++]=K+O|0,r[s++]=P+M|0,r[s++]=N+G|0,r[s++]=J+j|0}function st(e,t,n,o,r){let s=o+0,f=o+16*r;for(let c=0;c<16;c++)n[f+c]=e[t+(2*r-1)*16+c];for(let c=0;c<r;c++,s+=16,t+=16)pt(n,f,e,t,n,s),c>0&&(f+=16),pt(n,s,e,t+=16,n,f)}function St(e,t,n){let o=X({dkLen:32,asyncTick:10,maxmem:1073742848},n),{N:r,r:s,p:f,dkLen:c,asyncTick:i,maxmem:x,onProgress:h}=o;if(y(r,"N"),y(s,"r"),y(f,"p"),y(c,"dkLen"),y(i,"asyncTick"),y(x,"maxmem"),h!==void 0&&typeof h!="function")throw new Error('"onProgress" must be a function');if(s<1)throw new Error('"r" expected integer >= 1');let a=128*s,b=a/4,u=Math.pow(2,32);if(r<=1||(r&r-1)!==0||r>u)throw new Error('"N" expected a power of 2, and 2^1 <= N <= 2^32');if(f<1||f>(u-1)*32/a)throw new Error('"p" expected integer 1..((2^32 - 1) * 32) / (128 * r)');if(c<1||c>(u-1)*32)throw new Error('"dkLen" expected integer 1..(2^32 - 1) * 32');let p=a*(r+f+1);if(p>x)throw new Error('"maxmem" limit was hit: memUsed(128*r*(N+p+1))='+p+", maxmem="+x);let l=nt(z,e,t,{c:1,dkLen:a*f}),H=Q(l),g=Q(new Uint8Array(a*r)),K=Q(new Uint8Array(a)),P=()=>{};if(h){let N=2*r*f,J=Math.max(Math.floor(N/1e4),1),w=0;P=()=>{if(w++,h&&(!(w%J)||w===N))try{h(w/N)}catch(A){throw L(l,g,K),A}}}return{N:r,r:s,p:f,dkLen:c,blockSize32:b,V:g,B32:H,B:l,tmp:K,blockMixCb:P,asyncTick:i}}function Tt(e,t,n,o,r){let s=nt(z,e,n,{c:1,dkLen:t});return L(n,o,r),s}function yt(e,t,n){let{N:o,r,p:s,dkLen:f,blockSize32:c,V:i,B32:x,B:h,tmp:a,blockMixCb:b}=St(e,t,n);tt(x);for(let u=0;u<s;u++){let p=c*u;for(let l=0;l<c;l++)i[l]=x[p+l];for(let l=0,H=0;l<o-1;l++)st(i,H,i,H+=c,r),b();st(i,(o-1)*c,x,p,r),b();for(let l=0;l<o;l++){let H=(x[p+c-16]&o-1)>>>0;for(let g=0;g<c;g++)a[g]=x[p+g]^i[H*c+g];st(a,0,x,p,r),b()}}return tt(x),Tt(e,f,h,i,a)}window.nobleScrypt=yt;window.nobleSha256=z;})();

  function countZeroBits(data) {
    let count = 0;
    for (const b of data) {
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
