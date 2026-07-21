const ftp = require('basic-ftp');
const fs = require('fs');
(async ()=>{
  const [host, port, user, pass] = process.argv.slice(2);
  const client = new ftp.Client(); client.ftp.verbose = false;
  const paths = [
    '/public_html/assets/index-P6jIhS1D.js',
    '/public_html/public_html/assets/index-P6jIhS1D.js',
    '/public_html/public_html/public_html/assets/index-P6jIhS1D.js'
  ];
  const out = [];
  try{
    await client.access({host, port: parseInt(port), user, password: pass, secure: false});
    for(const p of paths){
      try{
        const dir = p.split('/').slice(0,-1).join('/') || '/';
        const name = p.split('/').pop();
        const list = await client.list(dir);
        const found = list.find(x=>x.name===name);
        if(found){ out.push({path:p, found:true, size:found.size}); } else { out.push({path:p, found:false}); }
      }catch(e){ out.push({path:p, error: e.message}); }
    }
  }catch(e){ out.push({error:e.message}); }
  finally{ client.close(); fs.writeFileSync('dist/paths_check.json', JSON.stringify(out,null,2)); }
})();
