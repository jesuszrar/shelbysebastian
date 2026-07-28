const fs = require('fs');
const path = require('path');
const dist = path.resolve(__dirname, 'dist');
console.log('dist', dist);
const entries = fs.readdirSync(dist, { withFileTypes: true });
for (const entry of entries) {
  console.log(entry.name, entry.isFile(), entry.isDirectory(), entry.type);
  if (entry.isDirectory()) {
    const subdir = path.join(dist, entry.name);
    const sub = fs.readdirSync(subdir, { withFileTypes: true });
    for (const subEntry of sub) {
      console.log('  ', subEntry.name, subEntry.isFile(), subEntry.isDirectory(), subEntry.type);
    }
  }
}
