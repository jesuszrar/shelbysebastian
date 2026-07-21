const ftp = require('basic-ftp');
const fs = require('fs');
const path = require('path');
(async ()=>{
  const [host, port, user, pass, newName] = process.argv.slice(2);
  if(!host || !newName){ console.log('Usage: node ftp_upload_index_variants.cjs HOST PORT USER PASS NEW_BUNDLE_NAME'); process.exit(1); }
  const localIndex = path.join(__dirname, '..', 'dist', 'index.html');
  const indexContent = fs.readFileSync(localIndex, 'utf8');
  const mod = indexContent.replace(/assets\/[a-zA-Z0-9\-_.]+\.js/g, `assets/${newName}`);
  const tmpIndex = path.join(__dirname, '..', 'dist', 'index-modified.html');
  fs.writeFileSync(tmpIndex, mod, 'utf8');
  const client = new ftp.Client(); client.ftp.verbose = true;
  try{
    await client.access({host, port: parseInt(port), user, password: pass, secure: false});
    const targets = ['/public_html/index.html','/public_html/public_html/index.html','/public_html/public_html/public_html/index.html'];
    for(const t of targets){
      try{
        // ensure dir
        const dir = t.replace(/\/g,'/').replace(/\/g,'/').split('/').slice(0,-1).join('/') || '/';
        try{ await client.ensureDir(dir); } catch(e){}
        await client.uploadFrom(tmpIndex, t);
        console.log('Uploaded modified index to', t);
      }catch(e){ console.log('Could not upload to', t, e.message); }
    }
  }catch(e){ console.error('FTP error', e); process.exit(2); }
  finally{ client.close(); }
})();
