const Client = require('ssh2-sftp-client');

const host = '149.62.37.234';
const port = 65002;
const username = 'u970251027';
const password = '3016030030Zr@';
const remoteDir = 'public_html';

(async () => {
  const s = new Client();
  try {
    await s.connect({ host, port, username, password, readyTimeout: 20000 });
    console.log('Connected');
    const list = await s.list(remoteDir);
    console.log('LISTING', remoteDir, list.map(item => `${item.name} (${item.type})`).join('\n'));
    if (list.some(item => item.name === 'index.html')) {
      const content = await s.get(`${remoteDir}/index.html`);
      console.log('INDEX.HTML');
      console.log(content.toString('utf8').slice(0, 1000));
    }
  } catch (error) {
    console.error('ERROR', error);
    process.exitCode = 1;
  } finally {
    await s.end().catch(() => {});
  }
})();
