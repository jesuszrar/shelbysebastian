const Client = require('ssh2-sftp-client');
const sftp = new Client();
(async()=>{
  try{
    await sftp.connect({host:'149.62.37.234', port:65002, username:'u970251027', password:'3016030030Zr@'});
    console.log('cwd', await sftp.cwd());
    const root = await sftp.list('/');
    console.log('/ ->', root.map(x=>x.name));
    const pub = await sftp.list('/public_html');
    console.log('/public_html ->', pub.map(x=>x.name).slice(0,100));
    const assets = await sftp.list('/public_html/assets');
    console.log('/public_html/assets ->', assets.map(x=>x.name).slice(0,200));
    await sftp.end();
  }catch(e){ console.error('err', e.message); try{ await sftp.end(); }catch(_){} }
})();
