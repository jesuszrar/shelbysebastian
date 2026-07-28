const https = require('https');
const url = 'https://shelbyimportacionessas.com/assets/index-C7XwYR9P.js';
https.get(url, (res)=>{
  if(res.statusCode !== 200){ console.error('Status', res.statusCode); process.exit(1); }
  let data=''; res.on('data', chunk=>data+=chunk); res.on('end', ()=>{
    const checks = ['Te mostramos el número para enviar el pago','Número','Ya realicé el pago','Pago automático vía Mercado Pago','322 842 6561'];
    for(const c of checks) {
      console.log(c, '=>', data.includes(c));
    }
  });
}).on('error', (e)=>{ console.error('Fetch error', e.message); process.exit(1); });
