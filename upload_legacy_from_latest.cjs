const Client = require('ssh2-sftp-client');
const fs = require('fs');
const path = require('path');
const s = new Client();
(async ()=>{
  try{
    const assetsDir = path.resolve(__dirname, 'dist', 'assets');
    const files = fs.readdirSync(assetsDir);
    const js = files.find(f => /^index-.*\.js$/.test(f));
    const css = files.find(f => /^index-.*\.css$/.test(f));
    if(!js || !css) { console.error('No index JS/CSS found in dist/assets'); process.exit(1); }
    console.log('Found local:', js, css);
    await s.connect({ host:'149.62.37.234', port:65002, username:'u970251027', password:'3016030030Zr@' });
    await s.fastPut(path.join(assetsDir, js), `public_html/assets/index-8gnvK8Sm.js`);
    await s.fastPut(path.join(assetsDir, css), `public_html/assets/index-BiW200sW.css`);
    console.log('Uploaded legacy-named assets');
  }catch(e){ console.error('error', e.message); process.exit(1); }
  finally{ await s.end().catch(()=>{}); }
})();
