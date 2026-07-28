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
    console.log('public_html contents:');
    list.forEach(item => console.log(`${item.type} ${item.name}`));
    const indexContent = await s.get(`${remoteDir}/index.html`);
    const indexText = indexContent.toString('utf8');
    const lines = indexText.split(/\r?\n/);
    const matches = lines.filter(line => /assets\/index-.*\.(js|css)/.test(line));
    console.log('\nAsset references in remote index.html:');
    matches.forEach(line => console.log(line.trim()));
    const assets = await s.list(`${remoteDir}/assets`);
    console.log('\npublic_html/assets contents:');
    assets.forEach(item => console.log(`${item.type} ${item.name}`));
  } catch (error) {
    console.error('ERROR', error);
    process.exitCode = 1;
  } finally {
    await s.end().catch(() => {});
  }
})();
