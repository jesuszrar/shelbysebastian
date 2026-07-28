const Client = require('ssh2-sftp-client');
const fs = require('fs');
const path = require('path');
const sftp = new Client();
(async()=>{
  try{
    await sftp.connect({host:'149.62.37.234', port:65002, username:'u970251027', password:'3016030030Zr@'});
    const remote = '/home/u970251027/public_html/assets/index-8gnvK8Sm.js';
    const info = await sftp.stat(remote);
    console.log('remote size', info.size, 'modifyTime', new Date(info.modifyTime));
    const local = path.resolve(__dirname, '..', 'dist', 'assets', 'index-8gnvK8Sm.js');
    const st = fs.statSync(local);
    console.log('local size', st.size, 'mtime', st.mtime);
    await sftp.end();
  }catch(e){ console.error('err', e.message); try{ await sftp.end(); }catch(_){} }
})();
