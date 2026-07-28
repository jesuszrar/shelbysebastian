const Client = require('ssh2-sftp-client');
const fs = require('fs');
const path = require('path');
const sftp = new Client();
(async()=>{
  try{
    const dist = path.resolve(__dirname,'..','dist');
    const htmlPath = path.join(dist,'index.html');
    if(!fs.existsSync(htmlPath)){ console.error('dist/index.html not found'); process.exit(1); }
    const html = fs.readFileSync(htmlPath,'utf8');
    const assetsDir = path.join(dist,'assets');
    const jsMatch = html.match(/<script[^>]+src=["']([^"']*index-[^"']*\.js)["'][^>]*><\/script>/i);
    if(!jsMatch){ console.error('script tag not found in dist/index.html'); process.exit(1); }
    const jsRel = jsMatch[1].replace(/^\//,'');
    const jsLocalPath = path.join(dist, jsRel);
    if(!fs.existsSync(jsLocalPath)){ console.error('local js not found', jsLocalPath); process.exit(1); }
    const jsContent = fs.readFileSync(jsLocalPath,'utf8');
    const inlined = html.replace(jsMatch[0], `<script type="module">\n${jsContent}\n</script>`);
    const tmp = path.join(dist,'index-inline.html');
    fs.writeFileSync(tmp,inlined,'utf8');
    console.log('wrote', tmp);
    await sftp.connect({host:'149.62.37.234', port:65002, username:'u970251027', password:'3016030030Zr@'});
    const remote = '/home/u970251027/public_html/index.html';
    await sftp.fastPut(tmp, remote);
    console.log('uploaded inline index.html');
    await sftp.chmod(remote, 0o644);
    await sftp.end();
  }catch(e){ console.error('err', e.message); try{ await sftp.end(); }catch(_){} }
})();
