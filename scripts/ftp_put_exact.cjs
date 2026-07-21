const ftp = require('basic-ftp');
(async ()=>{
  const [host, port, user, pass, localFile, remotePath] = process.argv.slice(2);
  if(!host || !localFile || !remotePath){ console.log('Usage: node ftp_put_exact.cjs HOST PORT USER PASS LOCAL_FILE REMOTE_FULL_PATH'); process.exit(1); }
  const client = new ftp.Client(); client.ftp.verbose = true;
  try{
    await client.access({host, port: parseInt(port), user, password: pass, secure: false});
    const dir = remotePath.split('/').slice(0,-1).join('/') || '/';
    await client.ensureDir(dir);
    await client.uploadFrom(localFile, remotePath);
    console.log('uploaded', remotePath);
  }catch(e){ console.error('err', e.message); }
  finally{ client.close(); }
})();
