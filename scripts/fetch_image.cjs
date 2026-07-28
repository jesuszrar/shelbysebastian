const https = require('https');
const url = 'https://shelbyimportacionessas.com/assets/hero-warehouse-LyuwHcCU.jpg';
https.get(url, (res) => {
  console.log('status', res.statusCode, 'content-type', res.headers['content-type']);
  res.on('data', ()=>{});
  res.on('end', ()=> console.log('done'));
}).on('error',(e)=> console.error('err', e.message));
