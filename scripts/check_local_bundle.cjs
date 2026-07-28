const fs = require('fs');
const path = require('path');
const p = path.resolve(__dirname, '..', 'dist', 'assets', 'index-BTGfwLLK.js');
const s = fs.readFileSync(p,'utf8');
console.log('len', s.length);
console.log('has placeholder', s.includes('tu-backend-en-render.com'));
console.log('has preferred', s.includes('shelby-backend.onrender.com'));
