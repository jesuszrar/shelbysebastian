const ftp = require('basic-ftp');
(async ()=>{
  const [host, port, user, pass, start] = process.argv.slice(2);
  const client = new ftp.Client(); client.ftp.verbose = false;
  try{
    await client.access({host, port: parseInt(port), user, password: pass, secure: false});
    const root = start || '/public_html';
    async function walk(dir){
      const list = await client.list(dir);
      for(const item of list){
        const full = dir === '/' ? `/${item.name}` : `${dir}/${item.name}`;
        if(item.isDirectory){
          console.log('DIR ', full);
          await walk(full);
        } else {
          console.log('FILE', full, item.size);
        }
      }
    }
    await walk(root);
  }catch(e){ console.error(e); }
  finally{ client.close(); }
})();
