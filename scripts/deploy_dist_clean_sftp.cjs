const Client = require('ssh2-sftp-client');
const fs = require('fs');
const path = require('path');

const host = '149.62.37.234';
const port = 65002;
const username = 'u970251027';
const password = '3016030030Zr@';
const localDist = path.resolve(__dirname, '..', 'dist');
const remoteRoot = '/home/u970251027/public_html';

async function removeRemoteDir(sftp, remotePath) {
  try {
    const items = await sftp.list(remotePath);
    for (const item of items) {
      const remoteItem = `${remotePath}/${item.name}`.replace(/\\/g, '/');
      if (item.type === 'd') {
        await removeRemoteDir(sftp, remoteItem);
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

async function uploadDirectory(sftp, localDir, remoteDir) {
  const entries = fs.readdirSync(localDir, { withFileTypes: true });
  try {
    await sftp.mkdir(remoteDir, true);
  } catch (e) {
    // ignore existing directory
  }
  for (const entry of entries) {
    const localPath = path.join(localDir, entry.name);
    const remotePath = `${remoteDir}/${entry.name}`.replace(/\\/g, '/');
    if (entry.isDirectory()) {
      await uploadDirectory(sftp, localPath, remotePath);
    } else if (entry.isFile()) {
      await sftp.fastPut(localPath, remotePath);
      console.log('Uploaded', remotePath);
    }
  }
}

(async () => {
  const sftp = new Client();
  try {
    console.log('Connecting to', host, port, '...');
    await sftp.connect({ host, port, username, password, readyTimeout: 20000 });
    console.log('Connected');

    console.log('Clearing remote directory', remoteRoot);
    await removeRemoteDir(sftp, remoteRoot);

    console.log('Uploading local dist from', localDist, 'to', remoteRoot);
    await uploadDirectory(sftp, localDist, remoteRoot);
    console.log('Deployment complete');
  } catch (error) {
    console.error('Deployment failed:', error.message || error);
    process.exitCode = 1;
  } finally {
    await sftp.end().catch(() => {});
  }
})();
