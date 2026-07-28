const Client = require('ssh2-sftp-client');
const fs = require('fs');
const path = require('path');
const sftp = new Client();
(async()=>{
  try{
    await sftp.connect({host:'149.62.37.234', port:65002, username:'u970251027', password:'3016030030Zr@'});
    const localJs = path.resolve(__dirname, '..', 'dist', 'assets', 'index-8gnvK8Sm.js');
    const remoteJs = '/home/u970251027/public_html/main.js';
    await sftp.fastPut(localJs, remoteJs);
    console.log('uploaded main.js');
    const remoteIndex = '/home/u970251027/public_html/index.html';
    const tmp = path.resolve(__dirname, '..', 'downloaded_assets', 'index.html');
    await sftp.fastGet(remoteIndex, tmp);
    let html = fs.readFileSync(tmp,'utf8');
    html = html.replace(/<script[^>]+src=["']([^"']*index-[^"']*\.js)["'][^>]*><\/script>/i, '<script type="module" crossorigin src="/main.js"></script>');
    fs.writeFileSync(tmp, html, 'utf8');
    await sftp.fastPut(tmp, remoteIndex);
    console.log('patched index.html to /main.js');
    await sftp.end();
  }catch(e){ console.error('err', e.message); try{ await sftp.end(); }catch(_){} }
})();
