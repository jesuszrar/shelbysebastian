const https = require('https');
const fs = require('fs');
const crypto = require('crypto');
const os = require('os');
const path = require('path');

const url = 'https://shelbyimportacionessas.com/assets/index-P6jIhS1D.js?cb=' + Date.now();
const remotePath = path.join(os.tmpdir(), 'remote_index.js');
const local = path.join(__dirname, '..', 'dist', 'assets', 'index-P6jIhS1D.js');

function sha(filePath) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const stream = fs.createReadStream(filePath);
    stream.on('data', (d) => hash.update(d));
    stream.on('end', () => resolve(hash.digest('hex')));
    stream.on('error', reject);
  });
}

function download(url, dest) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(dest);
    https.get(url, (res) => {
      if (res.statusCode !== 200) return reject(new Error('Bad status ' + res.statusCode));
      res.pipe(file);
      file.on('finish', () => file.close(resolve));
    }).on('error', (err) => reject(err));
  });
}

(async () => {
  try {
    console.log('Downloading', url, '->', remotePath);
    await download(url, remotePath);
    const remoteHash = await sha(remotePath);
    const localHash = await sha(local);
    const result = { remote: remoteHash, local: localHash, match: remoteHash === localHash };
    const outPath = path.join(__dirname, '..', 'compare_result.json');
    fs.writeFileSync(outPath, JSON.stringify(result, null, 2));
    console.log('WROTE', outPath);
  } catch (e) {
    console.error('ERROR', e.message);
    process.exit(2);
  }
})();
