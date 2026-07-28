const https = require('https');
const url = 'https://shelbyimportacionessas.com/';
https.get(url, (res)=>{
  let data=''; res.on('data', chunk=>data+=chunk); res.on('end', ()=>{
    const lines = data.split(/\n/);
    for(const l of lines){ if(/<script|assets\//i.test(l)) console.log(l.trim()); }
  });
}).on('error', (e)=>{ console.error('Fetch error', e.message); process.exit(1); });
