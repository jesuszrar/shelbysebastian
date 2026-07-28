const Client = require('ssh2-sftp-client');
const fs = require('fs');
const path = require('path');

const host = '149.62.37.234';
const port = 65002;
const username = 'u970251027';
const password = '3016030030Zr@';
const homeDir = '/home/u970251027';
const publicHtml = '/home/u970251027/public_html';

(async () => {
  const s = new Client();
  try {
    await s.connect({ host, port, username, password, readyTimeout: 20000 });
    console.log('Connected');
    const root = await s.list(homeDir);
    console.log('HOME DIR LIST:');
    root.forEach(item => console.log(`${item.type} ${item.name}`));

    const domains = await s.list(`${homeDir}/domains`);
    console.log('\nDOMAINS DIR LIST:');
    domains.forEach(item => console.log(`${item.type} ${item.name}`));

    const candidates = [];
    const domainNames = domains.filter(item => item.type === 'd').map(item => item.name);
    for (const name of domainNames) {
      const candidate = `${homeDir}/domains/${name}/public_html`;
      try {
        const list = await s.list(candidate);
        console.log(`\nFOUND DOMAIN PUBLIC_HTML: ${candidate}`);
        list.forEach(item => console.log(`${item.type} ${item.name}`));
        candidates.push(candidate);
      } catch (e) {
        console.warn(`Could not list ${candidate}: ${e.message}`);
      }
    }

    const verifyPaths = [publicHtml, ...candidates];
    for (const p of verifyPaths) {
      try {
        const fname = `verify-${path.basename(p)}-${Date.now()}.txt`;
        const content = `verify path ${p}`;
        await s.put(Buffer.from(content), `${p}/${fname}`);
        console.log(`\nWrote verify file to ${p}/${fname}`);
      } catch (e) {
        console.warn(`Could not write verify file to ${p}: ${e.message}`);
      }
    }
  } catch (error) {
    console.error('ERROR', error.message);
    process.exitCode = 1;
  } finally {
    await s.end().catch(() => {});
  }
})();
