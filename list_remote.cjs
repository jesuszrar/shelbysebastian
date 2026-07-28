const Client = require('ssh2-sftp-client');

const s = new Client();
(async ()=>{
  try{
    await s.connect({ host:'149.62.37.234', port:65002, username:'u970251027', password:'3016030030Zr@' });
    console.log('Connected');
    const root = 'public_html';
    const listRoot = await s.list(root);
    console.log('public_html:', listRoot.map(f=>f.name).join('\n'));
    try{
      const assets = await s.list(root + '/assets');
      console.log('public_html/assets:', assets.map(f=>f.name).join('\n'));
    }catch(e){ console.log('assets folder missing or empty'); }
  }catch(e){ console.error('error', e.message); }
  finally{ await s.end().catch(()=>{}); }
})();
