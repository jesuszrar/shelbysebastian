const Client = require('ssh2-sftp-client');
const fs = require('fs');
const path = require('path');
const sftp = new Client();
(async()=>{
  try{
    await sftp.connect({host:'149.62.37.234', port:65002, username:'u970251027', password:'3016030030Zr@'});
    const remote = '/home/u970251027/public_html/assets/index-8gnvK8Sm.js';
    const localDir = path.resolve(__dirname, '..', 'downloaded_assets');
    if(!fs.existsSync(localDir)) fs.mkdirSync(localDir);
    const local = path.join(localDir, 'index-8gnvK8Sm.js');
    await sftp.fastGet(remote, local);
    const text = fs.readFileSync(local,'utf8');
    console.log('downloaded len', text.length, 'has placeholder', text.includes('tu-backend-en-render.com'), 'has preferred', text.includes('shelby-backend.onrender.com'));
    await sftp.end();
  }catch(e){ console.error('err', e.message); try{ await sftp.end(); }catch(_){} }
})();
