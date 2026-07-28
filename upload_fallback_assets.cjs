const Client = require('ssh2-sftp-client');
const s = new Client();
(async ()=>{
  try{
    console.log('Uploading fallback assets...');
    await s.connect({ host:'149.62.37.234', port:65002, username:'u970251027', password:'3016030030Zr@' });
    await s.fastPut('./dist/assets/index-C7XwYR9P.js', 'public_html/assets/index-8gnvK8Sm.js');
    await s.fastPut('./dist/assets/index-DtA7dWKL.css', 'public_html/assets/index-BiW200sW.css');
    console.log('Uploaded fallback assets');
  }catch(e){ console.error('error', e.message); process.exit(1); }
  finally{ await s.end().catch(()=>{}); }
})();
