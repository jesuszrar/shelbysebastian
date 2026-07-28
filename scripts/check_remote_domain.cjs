const Client = require('ssh2-sftp-client');
const sftp = new Client();
(async () => {
  try {
    await sftp.connect({ host: '149.62.37.234', port: 65002, username: 'u970251027', password: '3016030030Zr@' });
    const root = '/home/u970251027/domains/shelbyimportacionessas.com/public_html';
    const list = await sftp.list(root);
    console.log('root ->', list.map((x) => x.name));
    const index = await sftp.get(`${root}/index.html`);
    const html = index.toString();
    console.log('index references new js?', html.includes('index-Bagju-w4.js'));
    console.log('index references old js?', html.includes('index-D-0QAZ09.js'));
    await sftp.end();
  } catch (e) {
    console.error('err', e.message);
    try { await sftp.end(); } catch (_ ) {}
  }
})();
