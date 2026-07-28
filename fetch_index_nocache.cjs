const https = require('https');
const options = {
  hostname: 'shelbyimportacionessas.com',
  port: 443,
  path: '/?cb=' + Date.now(),
  method: 'GET',
  headers: {
    'Cache-Control': 'no-cache',
    'Pragma': 'no-cache',
    'User-Agent': 'node-fetch'
  }
};

const req = https.request(options, (res) => {
  let data = '';
  res.on('data', (chunk) => data += chunk);
  res.on('end', () => {
    const lines = data.split(/\n/);
    for(const l of lines){ if(/<script|assets\//i.test(l)) console.log(l.trim()); }
  });
});
req.on('error', (e) => console.error(e));
req.end();
