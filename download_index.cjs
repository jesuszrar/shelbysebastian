const Client = require('ssh2-sftp-client');
const fs = require('fs');
const s = new Client();
(async ()=>{
  try{
    await s.connect({ host:'149.62.37.234', port:65002, username:'u970251027', password:'3016030030Zr@' });
    const remote = 'public_html/index.html';
    const local = 'remote_index.html';
    await s.fastGet(remote, local);
    console.log('Downloaded to', local);
    const content = fs.readFileSync(local, 'utf8');
    console.log(content.split('\n').slice(0,40).join('\n'));
  }catch(e){ console.error('error', e.message); process.exit(1); }
  finally{ await s.end().catch(()=>{}); }
})();
