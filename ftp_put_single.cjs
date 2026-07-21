const ftp = require('basic-ftp');
const fs = require('fs');
(async ()=>{
    const [host, port, user, pass, localFile] = process.argv.slice(2);
    if(!host) { console.log('Usage: node ftp_put_single.cjs HOST PORT USER PASS LOCAL_FILE'); process.exit(1); }
    const client = new ftp.Client(); client.ftp.verbose = true;
    try{
        await client.access({host, port: parseInt(port), user, password: pass, secure: false});
        // upload to /public_html/assets
        try{ await client.ensureDir('/public_html/assets'); } catch(e){}
        await client.uploadFrom(localFile, '/public_html/assets/index-P6jIhS1D.js');
        // also upload to /public_html/index-P6jIhS1D.js
        await client.uploadFrom(localFile, '/public_html/index-P6jIhS1D.js');
        console.log('Uploaded single file to both locations');
    }catch(e){ console.error('Error', e); }
    finally{ client.close(); }
})();
