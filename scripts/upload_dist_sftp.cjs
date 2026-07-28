const Client = require('ssh2-sftp-client');
const fs = require('fs');
const path = require('path');

const host = '149.62.37.234';
const port = 65002;
const username = 'u970251027';
const password = '3016030030Zr@';
const localRoot = path.resolve(__dirname, '..', 'dist');
// Hostinger actual domain root for shelbyimportacionessas.com
const remoteRoot = '/home/u970251027/domains/shelbyimportacionessas.com/public_html';

const sftp = new Client();

async function ensureRemoteDir(dir) {
  try {
    await sftp.mkdir(dir, true);
  } catch (e) {
    // ignore
  }
}

async function uploadDir(localDir, remoteDir) {
  const entries = fs.readdirSync(localDir, { withFileTypes: true });
  await ensureRemoteDir(remoteDir);
  for (const entry of entries) {
    const localPath = path.join(localDir, entry.name);
    const remotePath = (remoteDir === '/' || remoteDir === '') ? `/${entry.name}` : `${remoteDir}/${entry.name}`;
    if (entry.isDirectory()) {
      await uploadDir(localPath, remotePath);
    } else {
      try {
        await sftp.fastPut(localPath, remotePath);
        console.log('uploaded', remotePath);
      } catch (err) {
        console.error('error uploading', remotePath, err.message);
      }
    }
  }
}

(async () => {
  try {
    await sftp.connect({ host, port, username, password });
    console.log('connected, cwd:', await sftp.cwd());
    await uploadDir(localRoot, remoteRoot);
    console.log('upload finished');
    await sftp.end();
  } catch (err) {
    console.error('sftp error', err.message);
    try { await sftp.end(); } catch(_){}
    process.exit(1);
  }
})();
