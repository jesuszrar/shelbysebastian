const ftp = require('basic-ftp');
(async ()=>{
  const [host, port, user, pass] = process.argv.slice(2);
  const client = new ftp.Client(); client.ftp.verbose = true;
  const paths = [
    '/public_html/assets/index-P6jIhS1D.js',
    '/public_html/public_html/assets/index-P6jIhS1D.js',
    '/public_html/public_html/public_html/assets/index-P6jIhS1D.js'
  ];
  try{
    await client.access({host, port: parseInt(port), user, password: pass, secure: false});
    for(const p of paths){
      try{
        const dir = p.split('/').slice(0,-1).join('/') || '/';
        const name = p.split('/').pop();
        const list = await client.list(dir);
        const found = list.find(x=>x.name===name);
        if(found){ console.log(p, 'FOUND', found.size); } else { console.log(p, 'MISSING'); }
      }catch(e){ console.log(p, 'ERR', e.message); }
    }
  }catch(e){ console.error(e); }
  finally{ client.close(); }
})();
