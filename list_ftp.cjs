const ftp = require('basic-ftp');
(async () => {
  const client = new ftp.Client();
  try {
    await client.access({ host: '149.62.37.234', port: 21, user: 'u970251027', password: '3016030030Zr@', secure: false });
    await client.cd('public_html');
    const list = await client.list();
    console.log('📂 Archivos en public_html:');
    list.forEach(f => console.log('  ' + (f.isDirectory ? '[DIR] ' : '      ') + f.name));
  } finally { client.close(); }
})();
