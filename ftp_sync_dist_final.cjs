const ftp = require('basic-ftp');
const fs = require('fs');
const path = require('path');

(async () => {
  const [host, port, user, pass, localDist] = process.argv.slice(2);
  if (!host) {
    console.log('Usage: node ftp_sync_dist_final.cjs HOST PORT USER PASS LOCAL_DIST');
    process.exit(1);
  }

  const client = new ftp.Client();
  client.ftp.verbose = false;

  try {
    console.log(`📡 Conectando a ${host}:${port}...`);
    await client.access({
      host,
      port: parseInt(port),
      user,
      password: pass,
      secure: false,
    });

    console.log('✓ Conectado. Navegando a public_html...');
    await client.cd('public_html');

    // Collect all files organized by directory
    const filesByDir = {};

    function walkDir(dir, prefix = '') {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        const remotePath = prefix ? `${prefix}/${entry.name}` : entry.name;
        const remoteDirPath = prefix || '/';

        if (entry.isFile()) {
          if (!filesByDir[remoteDirPath]) filesByDir[remoteDirPath] = [];
          filesByDir[remoteDirPath].push({ local: fullPath, name: entry.name });
        } else if (entry.isDirectory()) {
          if (!filesByDir[remotePath]) filesByDir[remotePath] = [];
          walkDir(fullPath, remotePath);
        }
      }
    }

    walkDir(localDist);

    // Count total files
    let totalFiles = 0;
    for (const dir in filesByDir) {
      totalFiles += filesByDir[dir].length;
    }
    console.log(`📦 Encontrados ${totalFiles} archivos en ${Object.keys(filesByDir).length} directorios\n`);

    // Upload files directory by directory
    for (const dirPath in filesByDir) {
      const files = filesByDir[dirPath];

      if (dirPath !== '/') {
        try {
          await client.ensureDir(dirPath);
          console.log(`📁 Dir: ${dirPath}/`);
        } catch (e) {
          // Directory might already exist, continue
        }

        try {
          await client.cd(dirPath);
        } catch (e) {
          console.error(`  ✗ Cannot cd to ${dirPath}: ${e.message}`);
          continue;
        }
      }

      for (const file of files) {
        try {
          await client.uploadFrom(file.local, file.name);
          console.log(`  ✓ ${file.name}`);
        } catch (e) {
          console.error(`  ✗ ${file.name}: ${e.message}`);
        }
      }

      // Go back to public_html if we went into a subdirectory
      if (dirPath !== '/') {
        try {
          await client.cd('/public_html');
        } catch (e) {
          // Ignore error
        }
      }
    }

    console.log(`\n✅ Sincronización completa!`);
  } catch (e) {
    console.error('❌ Error FTP:', e.message);
    process.exit(1);
  } finally {
    client.close();
  }
})();
