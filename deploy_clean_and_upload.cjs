const Client = require('ssh2-sftp-client');
const fs = require('fs');
const path = require('path');

const host = '149.62.37.234';
const port = 65002;
const username = 'u970251027';
const password = '3016030030Zr@';
const localDist = path.resolve(__dirname, 'dist');
const remoteDir = 'public_html';

async function removeRemoteRecursively(s, remotePath) {
  try {
    const list = await s.list(remotePath);
    for (const item of list) {
      const full = `${remotePath}/${item.name}`.replace(/\\\\/g, '/');
      if (item.type === 'd') {
        await removeRemoteRecursively(s, full);
        try { await s.rmdir(full); console.log('Removed dir', full); } catch (e) { console.warn('rmdir failed', full, e.message); }
      } else {
        try { await s.delete(full); console.log('Deleted', full); } catch (e) { console.warn('delete failed', full, e.message); }
      }
    }
  } catch (err) {
    // If list fails (e.g., directory does not exist), ignore
    console.warn('Could not list', remotePath, err.message);
  }
}

(async () => {
  const s = new Client();
  try {
    console.log('Connecting...');
    await s.connect({ host, port, username, password, readyTimeout: 20000 });
    console.log('Connected');

    // Ensure remote dir exists
    try { await s.mkdir(remoteDir, true); } catch (e) {}

    console.log('Removing remote contents under', remoteDir);
    await removeRemoteRecursively(s, remoteDir);

    console.log('Uploading local dist to', remoteDir);
    const entries = fs.readdirSync(localDist, { withFileTypes: true });
    for (const entry of entries) {
      const localPath = path.join(localDist, entry.name);
      if (entry.isFile()) {
        const remotePath = `${remoteDir}/${entry.name}`.replace(/\\\\/g, '/');
        await s.fastPut(localPath, remotePath);
        console.log('Uploaded', remotePath);
      } else if (entry.isDirectory()) {
        const remoteSubdir = `${remoteDir}/${entry.name}`.replace(/\\\\/g, '/');
        try { await s.mkdir(remoteSubdir, true); } catch (e) {}
        const subEntries = fs.readdirSync(localPath, { withFileTypes: true });
        for (const subEntry of subEntries) {
          if (subEntry.isFile()) {
            const subLocalPath = path.join(localPath, subEntry.name);
            const remotePath = `${remoteSubdir}/${subEntry.name}`.replace(/\\\\/g, '/');
            await s.fastPut(subLocalPath, remotePath);
            console.log('Uploaded', remotePath);
          }
        }
      }
    }

    console.log('Done');
  } catch (error) {
    console.error('Deploy failed', error.message);
    process.exitCode = 1;
  } finally {
    await s.end().catch(()=>{});
  }
})();
