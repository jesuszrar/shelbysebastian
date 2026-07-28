const Client = require('ssh2-sftp-client');
const fs = require('fs');
const path = require('path');

const host = process.argv[2];
const port = parseInt(process.argv[3] || '65002');
const username = process.argv[4];
const password = process.argv[5];
const localAssets = process.argv[6] || path.resolve(__dirname, '..', 'dist', 'assets');
const remoteDir = process.argv[7] || 'public_html/assets';

if (!host || !username || !password) {
  console.error('Usage: node clean_upload_assets.cjs HOST PORT USER PASS [LOCAL_ASSETS] [REMOTE_DIR]');
  process.exit(1);
}

(async () => {
  const s = new Client();
  try {
    await s.connect({ host, port, username, password });
    console.log('Connected, cwd', await s.cwd());

    // ensure remote dir
    try { await s.mkdir(remoteDir, true); } catch (_) {}

    // list remote files
    const list = await s.list(remoteDir);
    const indexFiles = list.filter(f => /^index-.*\.js$/.test(f.name)).map(f => `${remoteDir}/${f.name}`);
    console.log('Remote index files to remove:', indexFiles.join(', ') || '(none)');
    for (const f of indexFiles) {
      try { await s.delete(f); console.log('Deleted', f); } catch (e) { console.warn('Could not delete', f, e.message); }
    }

    // upload local assets
    console.log('Local assets path:', localAssets);
    const entries = fs.readdirSync(localAssets, { withFileTypes: true });
    console.log('Local entries:', entries.map(e=>e.name).join(', '));
    for (const entry of entries) {
      const localPath = path.join(localAssets, entry.name);
      const remotePath = `${remoteDir}/${entry.name}`;
      try {
        const stat = fs.statSync(localPath);
        if (stat.isFile()) {
          await s.fastPut(localPath, remotePath);
          console.log('Uploaded', remotePath);
        } else {
          console.log('Skipping non-file', entry.name);
        }
      } catch (e) {
        console.error('Stat/upload failed for', entry.name, e.message);
      }
    }

    console.log('Done');
  } catch (e) {
    console.error('Error', e.message);
    process.exit(1);
  } finally {
    try { await s.end(); } catch (_) {}
  }
})();
