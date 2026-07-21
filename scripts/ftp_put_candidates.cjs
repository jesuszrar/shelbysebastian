const ftp = require('basic-ftp');
const path = require('path');
(async ()=>{
  const [host, port, user, pass, localFile] = process.argv.slice(2);
  if(!host || !localFile){ console.log('Usage: node ftp_put_candidates.cjs HOST PORT USER PASS LOCAL_FILE'); process.exit(1); }
  const client = new ftp.Client(); client.ftp.verbose = true;
  const basename = path.basename(localFile);
  const targets = ['/public_html/assets','/public_html/public_html/assets','/public_html/public_html/public_html/assets'];
  try{
    await client.access({host, port: parseInt(port), user, password: pass, secure: false});
    for(const t of targets){
      try{
        await client.ensureDir(t);
        await client.uploadFrom(localFile, `${t}/${basename}`);
        console.log('uploaded to', `${t}/${basename}`);
      }catch(e){ console.log('failed', t, e.message); }
    }
  }catch(e){ console.error(e); }
  finally{ client.close(); }
})();
