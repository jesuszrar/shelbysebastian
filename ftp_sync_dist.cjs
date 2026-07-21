const ftp = require('basic-ftp');
const fs = require('fs');
const path = require('path');
(async ()=>{
    const [host, port, user, pass, localDist] = process.argv.slice(2);
    if(!host){ console.log('Usage: node ftp_sync_dist.cjs HOST PORT USER PASS LOCAL_DIST'); process.exit(1); }
    const client = new ftp.Client(); client.ftp.verbose = true;
    try{
        await client.access({host, port: parseInt(port), user, password: pass, secure: false});
        // ensure root
        await client.ensureDir('public_html');
        await client.cd('public_html');
        // upload root files
        const entries = fs.readdirSync(localDist, {withFileTypes:true});
        for(const e of entries){
            const localPath = path.join(localDist, e.name);
            if(e.isFile()){
                console.log('Upload root file', e.name);
                await client.uploadFrom(localPath, e.name);
            } else if(e.isDirectory()){
                if(e.name === 'assets'){
                    await client.ensureDir('assets');
                    await client.cd('assets');
                    const assets = fs.readdirSync(localPath);
                    for(const f of assets){
                        console.log('Upload asset', f);
                        await client.uploadFrom(path.join(localPath,f), f);
                    }
                    await client.cd('..');
                }
            }
        }
        console.log('Sync complete');
    }catch(e){ console.error('FTP sync error', e); }
    finally{ client.close(); }
})();
