const https = require('https');
https.get('https://shelbyimportacionessas.com/', (res) => {
  let data = '';
  res.on('data', (c) => data += c.toString());
  res.on('end', () => {
    const m = data.match(/<script[^>]+src=["']([^"']*index-[^"']*\.js)["']/i);
    console.log('status', res.statusCode, 'script', m ? m[1] : 'not found');
    if(m) console.log('script absolute', new URL(m[1], 'https://shelbyimportacionessas.com/').href);
  });
}).on('error',(e)=> console.error(e.message));
