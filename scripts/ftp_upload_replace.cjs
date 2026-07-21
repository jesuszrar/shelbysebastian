const ftp = require('basic-ftp');
const fs = require('fs');
const path = require('path');
(async ()=>{
  const [host, port, user, pass, newName] = process.argv.slice(2);
  if(!host || !newName){ console.log('Usage: node ftp_upload_replace.cjs HOST PORT USER PASS NEW_BUNDLE_NAME'); process.exit(1); }
  const localBundle = path.join(__dirname, '..', 'dist', 'assets', 'index-P6jIhS1D.js');
  const localIndex = path.join(__dirname, '..', 'dist', 'index.html');
  const client = new ftp.Client(); client.ftp.verbose = true;
  try{
    await client.access({host, port: parseInt(port), user, password: pass, secure: false});
    // target nested webroot
    const targetDir = '/public_html/public_html/public_html';
    // ensure assets dir
    try{ await client.ensureDir(targetDir + '/assets'); } catch(e){}
    // upload bundle to nested assets
    await client.uploadFrom(localBundle, `${targetDir}/assets/${newName}`);
    // also upload to /public_html/assets for safety
    try{ await client.ensureDir('/public_html/assets'); } catch(e){}
    await client.uploadFrom(localBundle, `/public_html/assets/${newName}`);
    // modify index.html to reference new asset
    const indexContent = fs.readFileSync(localIndex, 'utf8');
    const mod = indexContent.replace(/assets\/[a-zA-Z0-9\-_.]+\.js/g, `assets/${newName}`);
    const tmpIndex = path.join(__dirname, '..', 'dist', 'index-modified.html');
    fs.writeFileSync(tmpIndex, mod, 'utf8');
    // upload modified index to nested webroot
    await client.uploadFrom(tmpIndex, `${targetDir}/index.html`);
    console.log('Uploaded new bundle and updated index.html at', targetDir);
  }catch(e){ console.error('FTP error', e); process.exit(2); }
  finally{ client.close(); }
})();
