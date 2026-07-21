const ftp = require('basic-ftp');
(async ()=>{
    const [host, port, user, pass, start] = process.argv.slice(2);
    const client = new ftp.Client(); client.ftp.verbose = false;
    try{
        await client.access({host, port: parseInt(port), user, password: pass, secure: false});
        async function walk(dir){
            const list = await client.list(dir);
            for(const item of list){
                const full = (dir==='/')? `/${item.name}` : `${dir}/${item.name}`;
                if(item.isDirectory){
                    await walk(full);
                } else {
                    if(item.name.includes('index-P6jIhS1D.js') || item.name.includes('index.html')){
                        console.log(full, item.size);
                    }
                }
            }
        }
        await walk(start||'/');
    }catch(e){ console.error(e); }
    finally{ client.close(); }
})();
