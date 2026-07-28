const Client = require('ssh2-sftp-client');
const fs = require('fs');
const path = require('path');

const host = '149.62.37.234';
const port = 65002;
const username = 'u970251027';
const password = '3016030030Zr@';
const localDist = path.resolve(__dirname, 'dist');
const remoteDir = 'public_html';

(async () => {
  const s = new Client();
  try {
    console.log('Conectando al host...');
    await s.connect({ host, port, username, password, readyTimeout: 20000 });
    console.log('Conectado');
    await s.mkdir(remoteDir, true);

    const uploadFile = async (localPath, remotePath) => {
      const stat = fs.statSync(localPath);
      if (!stat.isFile()) return;
      const remotePathWithRoot = `${remoteDir}/${remotePath}`.replace(/\\/g, '/');
      await s.fastPut(localPath, remotePathWithRoot);
      console.log('Subido', remotePathWithRoot);
    };

    const entries = fs.readdirSync(localDist, { withFileTypes: true });
    for (const entry of entries) {
      const localPath = path.join(localDist, entry.name);
      if (entry.isFile()) {
        await uploadFile(localPath, entry.name);
      } else if (entry.isDirectory()) {
        const subEntries = fs.readdirSync(localPath, { withFileTypes: true });
        for (const subEntry of subEntries) {
          const subLocalPath = path.join(localPath, subEntry.name);
          if (subEntry.isFile()) {
            await uploadFile(subLocalPath, `${entry.name}/${subEntry.name}`);
          }
        }
      }
    }

    console.log('Despliegue completado');
  } catch (error) {
    console.error('Error en el despliegue', error.message);
    process.exitCode = 1;
  } finally {
    await s.end().catch(() => {});
  }
})();
