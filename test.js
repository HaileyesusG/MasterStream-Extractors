const fetch = require('node-fetch');
async function test() {
  const tmdb = 1339713;
  const embed = 'https://vidsrcme.ru/embed/' + tmdb;
  const r1 = await fetch(embed);
  const html1 = await r1.text();
  const m1 = html1.match(/id=["']player_iframe["'][^>]+src=["']([^"']+)["']/i) || html1.match(/src=["']([^"']+)["'][^>]+id=["']player_iframe["']/i);
  let i1 = m1[1]; if(i1.startsWith('//')) i1 = 'https:'+i1;
  const r2 = await fetch(i1, {headers:{'Referer':embed}});
  const html2 = await r2.text();
  const m2 = html2.match(/src\s*:\s*'([^']+)/) || html2.match(/src\s*:\s*"([^"]+)/) || html2.match(/<iframe[^>]+src=["']([^"']+)["']/i) || html2.match(/(https?:\/\/[^"'\s]+\/(?:pro)?rcp\/[^"'\s]+)/);
  let i2 = m2[1]; if(i2.startsWith('/')) i2 = 'https://'+new URL(i1).host+i2;
  const r3 = await fetch(i2, {headers:{'Referer':i1}});
  const html3 = await r3.text();
  
  const m3 = html3.match(/var master_urls\s*=\s*["']([^"']+)["']/);
  if (!m3) { console.log('no master_urls'); return; }
  let urls = m3[1];
  console.log('master_urls:', urls);
  
  if (urls.includes('__TOKENPG__')) {
    const t = await fetch('https://app2.putgate.com/generate.php').then(r => r.text());
    urls = urls.replaceAll('__TOKENPG__', t);
  }
  if (urls.includes('__TOKEN__')) {
    const hostMatch = urls.match(/https:\/\/([^\/]+)\/pl\//);
    if (hostMatch) {
      const t = await fetch('https://' + hostMatch[1] + '/generate.php').then(r => r.text());
      urls = urls.replaceAll('__TOKEN__', t);
    }
  }
  console.log('Resolved:', urls);
}
test();
