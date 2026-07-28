const Client = require('ssh2-sftp-client');
const fs = require('fs');
const path = require('path');

const host = '149.62.37.234';
const port = 65002;
const username = 'u970251027';
const password = '3016030030Zr@';
const localRoot = path.resolve(__dirname, '..', 'dist');
const remoteRoot = '/home/u970251027/domains/shelbyimportacionessas.com/public_html';

const sftp = new Client();

async function removeRemoteDir(remotePath) {
  try {
    const items = await sftp.list(remotePath);
    for (const item of items) {
      const remoteItem = `${remotePath}/${item.name}`.replace(/\\/g, '/');
      if (item.type === 'd') {
        await removeRemoteDir(remoteItem);
        await sftp.rmdir(remoteItem);
        console.log('Removed directory', remoteItem);
      } else {
        await sftp.delete(remoteItem);
        console.log('Deleted file', remoteItem);
      }
    }
  } catch (err) {
    if (err.code === 2 || err.message.includes('No such file')) {
      return;
    }
    throw err;
  }
}

async function ensureRemoteDir(dir) {
  try {
    await sftp.mkdir(dir, true);
  } catch (e) {
    // ignore existing directories
  }
}

async function uploadDirectory(localDir, remoteDir) {
  const entries = fs.readdirSync(localDir, { withFileTypes: true });
  await ensureRemoteDir(remoteDir);
  for (const entry of entries) {
    const localPath = path.join(localDir, entry.name);
    const remotePath = `${remoteDir}/${entry.name}`.replace(/\\/g, '/');
    if (entry.isDirectory()) {
      await uploadDirectory(localPath, remotePath);
    } else {
      await sftp.fastPut(localPath, remotePath);
      console.log('Uploaded', remotePath);
    }
  }
}

(async () => {
  try {
    console.log('Connecting to SFTP...');
    await sftp.connect({ host, port, username, password, readyTimeout: 20000 });
    console.log('Connected');
    console.log('Cleaning remote directory', remoteRoot);
    await removeRemoteDir(remoteRoot);
    console.log('Uploading local dist to', remoteRoot);
    await uploadDirectory(localRoot, remoteRoot);
    console.log('Deployment complete');
  } catch (err) {
    console.error('Deployment failed:', err.message || err);
    process.exit(1);
  } finally {
    await sftp.end().catch(() => {});
  }
})();
