const Client = require('ssh2-sftp-client');
const fs = require('fs');
const s = new Client();
(async ()=>{
  try{
    await s.connect({ host:'149.62.37.234', port:65002, username:'u970251027', password:'3016030030Zr@' });
    await s.fastGet('public_html/.htaccess', 'remote_htaccess_backup.txt');
    let txt = fs.readFileSync('remote_htaccess_backup.txt', 'utf8');
    const rule = `\n# Redirect legacy bundle to current bundle\nRewriteEngine On\nRewriteRule ^assets/index-8gnvK8Sm\.js$ /assets/index-DzCKIFAa.js [L]\nRewriteRule ^assets/index-BiW200sW\.css$ /assets/index-DtA7dWKL.css [L]\n`;
    if (!txt.includes('Redirect legacy bundle')) {
      txt += rule;
      fs.writeFileSync('remote_htaccess_patched.txt', txt, 'utf8');
      await s.fastPut('remote_htaccess_patched.txt', 'public_html/.htaccess');
      console.log('Patched .htaccess uploaded');
    } else {
      console.log('.htaccess already patched');
    }
  }catch(e){ console.error('err', e.message); process.exit(1); }
  finally{ await s.end().catch(()=>{}); }
})();
