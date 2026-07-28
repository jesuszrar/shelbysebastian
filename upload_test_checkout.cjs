const Client = require('ssh2-sftp-client');
const fs = require('fs');
const s = new Client();
(async ()=>{
  try{
    const content = fs.readFileSync('./dist/index.html','utf8');
    fs.writeFileSync('dist_test_index.html', content, 'utf8');
    await s.connect({ host:'149.62.37.234', port:65002, username:'u970251027', password:'3016030030Zr@' });
    await s.fastPut('dist_test_index.html', 'public_html/test_checkout.html');
    console.log('Uploaded test_checkout.html');
  }catch(e){ console.error('err', e.message); process.exit(1); }
  finally{ await s.end().catch(()=>{}); }
})();
