const ftp = require('basic-ftp');
const fs = require('fs');
const path = require('path');

(async () => {
  const [host, port, user, pass, localDist] = process.argv.slice(2);
  if (!host) {
    console.log('Usage: node ftp_sync_dist_v2.cjs HOST PORT USER PASS LOCAL_DIST');
    process.exit(1);
  }

  const client = new ftp.Client();
  client.ftp.verbose = true;

  try {
    console.log(`Connecting to ${host}:${port}...`);
    await client.access({
      host,
      port: parseInt(port),
      user,
      password: pass,
      secure: false,
    });

    console.log('Connected. Navigating to public_html...');
    await client.cd('public_html');

    // Get all files recursively
    const files = [];
    function walkDir(dir, prefix = '') {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        const remotePath = prefix ? `${prefix}/${entry.name}` : entry.name;
        if (entry.isFile()) {
          files.push({ local: fullPath, remote: remotePath, type: 'file' });
        } else if (entry.isDirectory()) {
          files.push({ local: fullPath, remote: remotePath, type: 'dir' });
          walkDir(fullPath, remotePath);
        }
      }
    }
    walkDir(localDist);

    console.log(`Found ${files.length} items to sync`);

    // Create directories first
    const dirs = files.filter(f => f.type === 'dir');
    for (const dir of dirs) {
      try {
        await client.ensureDir(dir.remote);
        console.log(`✓ Dir: ${dir.remote}`);
      } catch (e) {
        console.log(`  Dir exists: ${dir.remote}`);
      }
    }

    // Upload files
    const fileItems = files.filter(f => f.type === 'file');
    for (const file of fileItems) {
      try {
        await client.uploadFrom(file.local, file.remote);
        console.log(`✓ Upload: ${file.remote}`);
      } catch (e) {
        console.error(`✗ Failed: ${file.remote} - ${e.message}`);
      }
    }

    console.log(`\n✅ Sync complete! Uploaded ${fileItems.length} files.`);
  } catch (e) {
    console.error('FTP error:', e.message);
    process.exit(1);
  } finally {
    client.close();
  }
})();
