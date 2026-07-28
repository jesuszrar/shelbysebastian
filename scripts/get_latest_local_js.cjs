const fs = require('fs');
const path = require('path');
const dir = path.resolve(__dirname, '..', 'dist', 'assets');
if (!fs.existsSync(dir)) { console.log(''); process.exit(0); }
const files = fs.readdirSync(dir).filter(f => f.startsWith('index-') && f.endsWith('.js'))
  .map(f => ({ f, m: fs.statSync(path.join(dir, f)).mtimeMs }))
  .sort((a, b) => b.m - a.m);
console.log(files.length ? files[0].f : '');
