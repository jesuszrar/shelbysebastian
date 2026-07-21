const ftp = require('basic-ftp');
const fs = require('fs');
(async ()=>{
  const [host, port, user, pass, start] = process.argv.slice(2);
  const client = new ftp.Client(); client.ftp.verbose = false;
  const matches = [];
  try{
    await client.access({host, port: parseInt(port), user, password: pass, secure: false});
    const root = start || '/public_html';
    async function walk(dir){
      const list = await client.list(dir);
      for(const item of list){
        const full = dir === '/' ? `/${item.name}` : `${dir}/${item.name}`;
        if(item.isDirectory){
          await walk(full);
        } else {
          if(item.name.toLowerCase()==='index.html' || item.name.startsWith('index-P6jIhS1D') || item.name==='index-P6jIhS1D.js'){
            matches.push({path:full,size:item.size});
          }
        }
      }
    }
    await walk(root);
  }catch(e){ console.error(e); }
  finally{ client.close(); fs.writeFileSync('dist/ftp_matches.json', JSON.stringify(matches,null,2)); }
})();
