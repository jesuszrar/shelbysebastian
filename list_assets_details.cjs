const Client = require('ssh2-sftp-client');
const s = new Client();
(async ()=>{
  try{
    await s.connect({ host:'149.62.37.234', port:65002, username:'u970251027', password:'3016030030Zr@' });
    const list = await s.list('public_html/assets');
    list.forEach(f => console.log(f.name, f.size, f.modifyTime));
  }catch(e){ console.error('error', e.message); process.exit(1); }
  finally{ await s.end().catch(()=>{}); }
})();
