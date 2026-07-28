const fs = require('fs');
const path = './dist/assets/index-C7XwYR9P.js';
const s = fs.readFileSync(path,'utf8');
const checks = ['322 842 6561','Pago automático vía Mercado Pago','Te mostramos el número para enviar el pago','Ya realicé el pago'];
checks.forEach(c=>console.log(c,'=>', s.includes(c)));
console.log('size', s.length);
