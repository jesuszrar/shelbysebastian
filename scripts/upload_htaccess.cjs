const Client = require('ssh2-sftp-client');
const path = require('path');
const sftp = new Client();
(async()=>{
  try{
    await sftp.connect({host:'149.62.37.234', port:65002, username:'u970251027', password:'3016030030Zr@'});
    const local = path.resolve(__dirname, '..', '.htaccess');
    const remote = '/home/u970251027/public_html/.htaccess';
    await sftp.fastPut(local, remote);
    console.log('uploaded .htaccess');
    await sftp.end();
  }catch(e){ console.error('err', e.message); try{ await sftp.end(); }catch(_){} }
})();
