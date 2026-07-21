const ftp = require('basic-ftp');
const path = require('path');
(async ()=>{
    const [host, port, user, pass, local] = process.argv.slice(2);
    if(!host){ console.log('Usage: node ftp_upload_to_assets.cjs HOST PORT USER PASS LOCAL_PATH'); process.exit(1); }
    const client = new ftp.Client(); client.ftp.verbose = true;
    try{
        await client.access({host, port: parseInt(port), user, password: pass, secure: false});
        // ensure public_html and assets exist and navigate into assets
        await client.cd('/');
        await client.ensureDir('public_html');
        await client.cd('public_html');
        await client.ensureDir('assets');
        await client.cd('assets');
        const filename = path.basename(local);
        await client.uploadFrom(local, filename);
        console.log('Uploaded to public_html/assets/'+filename);
    }catch(e){ console.error('FTP upload error', e); }
    finally{ client.close(); }
})();
