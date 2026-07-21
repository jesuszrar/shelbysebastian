const ftp = require('basic-ftp');
const fs = require('fs');
(async ()=>{
  const [host, port, user, pass] = process.argv.slice(2);
  if(!host){ console.log('Usage: node ftp_download_assets.cjs HOST PORT USER PASS'); process.exit(1); }
  const client = new ftp.Client(); client.ftp.verbose = true;
  try{
    await client.access({host, port: parseInt(port), user, password: pass, secure: false});
    await client.ensureDir('/public_html/assets');
    await client.downloadTo('remote_index.js', '/public_html/assets/index-P6jIhS1D.js');
    try{ await client.downloadTo('remote_index_fixed.js', '/public_html/assets/index-P6jIhS1D-fixed-162784.js'); } catch(e){ console.log('fixed missing', e.message); }
    console.log('Downloads complete');
  }catch(e){ console.error('FTP error', e); process.exit(2); }
  finally{ client.close(); }
})();
