const ftp = require('basic-ftp');
const fs = require('fs');
const path = require('path');

(async () => {
  const [host, port, user, pass, localDist] = process.argv.slice(2);
  if (!host) {
    console.log('Usage: node ftp_final.cjs HOST PORT USER PASS LOCAL_DIST');
    process.exit(1);
  }

  const client = new ftp.Client();
  client.ftp.verbose = false;

  try {
    console.log('📡 Conectando...');
    await client.access({
      host,
      port: parseInt(port),
      user,
      password: pass,
      secure: false,
    });

    // Remove leading/trailing slashes from paths
    const cd_path = 'public_html';
    await client.cd(cd_path);

    // Walk and collect files
    const allFiles = [];
    function walk(dir, prefix = '') {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const e of entries) {
        const fullPath = path.join(dir, e.name);
        const relPath = prefix ? `${prefix}/${e.name}` : e.name;
        if (e.isFile()) {
          allFiles.push({ local: fullPath, remote: relPath });
        } else if (e.isDirectory() && e.name !== '.git') {
          walk(fullPath, relPath);
        }
      }
    }
    walk(localDist);

    console.log(`📦 ${allFiles.length} archivos encontrados\n`);

    let uploaded = 0;
    for (const file of allFiles) {
      const dir = path.dirname(file.remote);
      
      // Ensure directory structure exists
      if (dir && dir !== '.') {
        const parts = dir.split('/');
        let current = '';
        for (const part of parts) {
          current = current ? `${current}/${part}` : part;
          try {
            await client.ensureDir(current);
          } catch (e) {
            // Directory might exist, ignore
          }
        }
      }

      try {
        await client.uploadFrom(file.local, file.remote);
        process.stdout.write('.');
        uploaded++;
      } catch (e) {
        process.stdout.write('✗');
        console.error(`\n  ✗ ${file.remote}: ${e.message}`);
      }
    }

    console.log(`\n\n✅ Completado: ${uploaded}/${allFiles.length} archivos subidos`);
  } catch (e) {
    console.error('❌ Error:', e.message);
    process.exit(1);
  } finally {
    client.close();
  }
})();
