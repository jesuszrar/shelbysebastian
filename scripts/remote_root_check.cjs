const Client = require('ssh2-sftp-client');
const fs = require('fs');
const path = require('path');

const host = '149.62.37.234';
const port = 65002;
const username = 'u970251027';
const password = '3016030030Zr@';
const homeDir = '/home/u970251027';
const publicDir = '/home/u970251027/public_html';

(async () => {
  const s = new Client();
  try {
    await s.connect({ host, port, username, password, readyTimeout: 20000 });
    console.log('Connected');
    const homeList = await s.list(homeDir);
    console.log('HOME DIR LIST:');
    homeList.forEach(item => console.log(`${item.type} ${item.name}`));
    const pubList = await s.list(publicDir);
    console.log('\nPUBLIC_HTML LIST:');
    pubList.forEach(item => console.log(`${item.type} ${item.name}`));
    const index = await s.get(`${publicDir}/index.html`);
    console.log('\nREMOTE INDEX.HTML HEAD:');
    console.log(index.toString('utf8').slice(0, 500));
    const htaccess = await s.get(`${publicDir}/.htaccess`);
    console.log('\nREMOTE .HTACCESS:');
    console.log(htaccess.toString('utf8').slice(0, 200));

    const domainPublicDir = '/home/u970251027/domains/shelbyimportacionessas.com/public_html';
    try {
      const domainPubList = await s.list(domainPublicDir);
      console.log('\nDOMAIN PUBLIC_HTML LIST:');
      domainPubList.forEach(item => console.log(`${item.type} ${item.name}`));
      const domainIndex = await s.get(`${domainPublicDir}/index.html`);
      console.log('\nDOMAIN REMOTE INDEX.HTML HEAD:');
      console.log(domainIndex.toString('utf8').slice(0, 500));
    } catch (e) {
      console.warn('Could not inspect domain public_html:', e.message);
    }
    const testName = `test-deploy-${Date.now()}.txt`;
    await s.put(Buffer.from('DEPLOY_TEST_OK'), `${publicDir}/${testName}`);
    console.log('\nUploaded test file:', testName);
  } catch (error) {
    console.error('ERROR', error.message);
    process.exitCode = 1;
  } finally {
    await s.end().catch(() => {});
  }
})();
