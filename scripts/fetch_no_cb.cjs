const https = require('https');
const url = 'https://shelbyimportacionessas.com/assets/index-8gnvK8Sm.js';
https.get(url, (res) => {
  let data = '';
  res.on('data', (c) => data += c.toString());
  res.on('end', () => {
    console.log('status', res.statusCode, 'len', data.length);
    console.log('content-type', res.headers['content-type']);
    console.log('startsWith', data.slice(0,80));
  });
}).on('error',(e)=> console.error('err', e.message));
