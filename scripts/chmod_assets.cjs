const Client = require('ssh2-sftp-client');
const sftp = new Client();
(async()=>{
  try{
    await sftp.connect({host:'149.62.37.234', port:65002, username:'u970251027', password:'3016030030Zr@'});
    const files = [
      '/home/u970251027/public_html/index.html',
      '/home/u970251027/public_html/assets/index-8gnvK8Sm.js',
      '/home/u970251027/public_html/assets/index-BiW200sW.css'
    ];
    for(const f of files){
      try{ await sftp.chmod(f, 0o644); console.log('chmod', f); }catch(e){ console.error('chmod err', f, e.message); }
    }
    await sftp.end();
  }catch(e){ console.error('err', e.message); try{ await sftp.end(); }catch(_){} }
})();
