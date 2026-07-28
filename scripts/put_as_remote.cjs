const Client = require('ssh2-sftp-client');
const fs = require('fs');
const path = require('path');
const sftp = new Client();
(async()=>{
  try{
    const local = process.argv[2];
    const remoteName = process.argv[3];
    if(!local || !remoteName) { console.error('Usage: node put_as_remote.cjs <localPath> <remoteName>'); process.exit(1); }
    const localPath = path.resolve(__dirname, '..', local);
    if(!fs.existsSync(localPath)) { console.error('local not found', localPath); process.exit(1); }
    await sftp.connect({host:'149.62.37.234', port:65002, username:'u970251027', password:'3016030030Zr@'});
    const remote = '/home/u970251027/public_html/assets/' + remoteName;
    await sftp.fastPut(localPath, remote);
    console.log('uploaded', localPath, '->', remote);
    await sftp.chmod(remote, 0o644);
    console.log('chmod 644', remote);
    await sftp.end();
  }catch(e){ console.error('err', e.message); try{ await sftp.end(); }catch(_){} }
})();
