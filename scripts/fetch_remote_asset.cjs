const https = require('https');
const http = require('http');
const paths = [
  'https://shelbyimportacionessas.com/assets/index-8gnvK8Sm.js',
  'http://shelbyimportacionessas.com/assets/index-8gnvK8Sm.js'
];

const fetch = (u) => new Promise((resolve) => {
  const mod = u.startsWith('https') ? https : http;
  mod.get(u + '?cb=' + Date.now(), (res) => {
    let data = '';
    res.on('data', (c) => data += c.toString());
    res.on('end', () => resolve({ url: u, status: res.statusCode, headers: res.headers, body: data }));
  }).on('error', (e) => resolve({ url: u, error: e.message }));
});

(async()=>{
  for(const p of paths){
    const r = await fetch(p);
    if(r.error){ console.log('ERR', p, r.error); continue; }
    console.log('\nURL:', p, 'status', r.status, 'len', r.body.length);
    console.log('content-type', r.headers['content-type']);
    console.log('has placeholder', r.body.includes('tu-backend-en-render.com'));
    console.log('has preferred', r.body.includes('shelby-backend.onrender.com'));
    console.log('snippet:', r.body.slice(0, 300));
  }
})();
