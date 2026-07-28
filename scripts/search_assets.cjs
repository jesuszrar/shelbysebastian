const fs = require('fs');
const path = require('path');
const dir = path.resolve(__dirname, '..','dist','assets');
const files = fs.readdirSync(dir).filter(f=>f.endsWith('.js'));
let foundPlaceholder = false;
let foundPreferred = false;
for(const f of files){
  const p = path.join(dir,f);
  const t = fs.readFileSync(p,'utf8');
  if(t.includes('tu-backend-en-render.com')){
    console.log('placeholder in', f);
    foundPlaceholder = true;
  }
  if(t.includes('shelby-backend.onrender.com')){
    console.log('preferred in', f);
    foundPreferred = true;
  }
}
console.log('summary', {foundPlaceholder, foundPreferred});
