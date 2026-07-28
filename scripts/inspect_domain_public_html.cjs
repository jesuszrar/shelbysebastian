const Client = require('ssh2-sftp-client');
const host = '149.62.37.234';
const port = 65002;
const username = 'u970251027';
const password = '3016030030Zr@';
const remoteDir = '/home/u970251027/domains/shelbyimportacionessas.com/public_html';

const s = new Client();
(async () => {
  try {
    await s.connect({ host, port, username, password, readyTimeout: 20000 });
    console.log('Connected');
    const list = await s.list(remoteDir);
    console.log('ROOT LIST:', list.map((item) => `${item.type} ${item.name}`).join('\n'));
    const assets = await s.list(`${remoteDir}/assets`);
    console.log('ASSETS LIST:', assets.map((item) => `${item.type} ${item.name}`).join('\n'));
    const index = await s.get(`${remoteDir}/index.html`);
    const text = index.toString('utf8');
    console.log('INDEX ASSET LINES:');
    text.split(/\r?\n/).filter((line) => /assets\/index-.*\.(js|css)/.test(line)).forEach((line) => console.log(line.trim()));
  } catch (err) {
    console.error('ERROR', err.message || err);
    process.exit(1);
  } finally {
    await s.end().catch(() => {});
  }
})();
