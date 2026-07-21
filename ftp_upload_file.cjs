const ftp = require('basic-ftp');
(async ()=>{
    const [host, port, user, pass, local, remote] = process.argv.slice(2);
    if(!host){ console.log('Usage: node ftp_upload_file.cjs HOST PORT USER PASS LOCAL_PATH REMOTE_PATH'); process.exit(1); }
    const client = new ftp.Client(); client.ftp.verbose = true;
    try{
        await client.access({host, port: parseInt(port), user, password: pass, secure: false});
        const remoteDir = remote.replace(/\/[^/]+$/, '') || '.';
        await client.ensureDir(remoteDir);
        await client.uploadFrom(local, remote);
        console.log('Uploaded single file');
    }catch(e){ console.error('FTP upload error', e); }
    finally{ client.close(); }
})();
