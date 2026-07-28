const Client = require('ssh2-sftp-client');
const sftp = new Client();
(async()=>{
  try{
    await sftp.connect({host:'149.62.37.234', port:65002, username:'u970251027', password:'3016030030Zr@'});
    console.log('cwd', await sftp.cwd());
    const home = await sftp.list('/home');
    console.log('/home ->', home.map(x=>x.name));
    const me = await sftp.list('/home/u970251027');
    console.log('/home/u970251027 ->', me.map(x=>x.name));
    // try common hosting paths
    for(const p of ['public_html','www','htdocs','domains','/var/www/html']){
      try{
        const list = await sftp.list(`/home/u970251027/${p}`);
        console.log(`/home/u970251027/${p} ->`, list.map(x=>x.name).slice(0,100));
      }catch(e){/*ignore*/}
    }
    await sftp.end();
  }catch(e){ console.error('err', e.message); try{ await sftp.end(); }catch(_){} }
})();
