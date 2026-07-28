const Client = require('ssh2-sftp-client');
const sftp = new Client();
(async()=>{
  try{
    await sftp.connect({host:'149.62.37.234', port:65002, username:'u970251027', password:'3016030030Zr@'});
    const assets = await sftp.list('/home/u970251027/public_html/assets');
    console.log('assets count', assets.length);
    console.log(assets.map(x=>x.name));
    await sftp.end();
  }catch(e){ console.error('err', e.message); try{ await sftp.end(); }catch(_){} }
})();
