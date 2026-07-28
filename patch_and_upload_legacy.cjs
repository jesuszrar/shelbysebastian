const fs = require('fs');
const Client = require('ssh2-sftp-client');
const s = new Client();
(async ()=>{
  try{
    const src = 'remote_index_legacy.js';
    if (!fs.existsSync(src)) { console.error('local legacy file missing'); process.exit(1); }
    let content = fs.readFileSync(src, 'utf8');
    // replacements
    content = content.replace(/Te mostramos el número para enviar el pago/g, 'Nequi y Daviplata se pagan automáticamente mediante Mercado Pago. No requieren transferencia manual.');
    content = content.replace(/Número/g, '');
    content = content.replace(/322\s*842\s*6561/g, '');
    // write patched
    const out = 'remote_index_legacy_patched.js';
    fs.writeFileSync(out, content, 'utf8');
    // upload
    await s.connect({ host:'149.62.37.234', port:65002, username:'u970251027', password:'3016030030Zr@' });
    await s.fastPut(out, 'public_html/assets/index-8gnvK8Sm.js');
    console.log('Patched and uploaded legacy asset');
  }catch(e){ console.error('err', e.message); process.exit(1); }
  finally{ await s.end().catch(()=>{}); }
})();
