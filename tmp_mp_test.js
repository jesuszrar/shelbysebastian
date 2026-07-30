const https = require('https');
const data = JSON.stringify({
  orderId: 'TEST-NEQUI',
  items: [{ id: 'test', title: 'Test Product', quantity: 1, unit_price: 1000 }],
  preferredPayment: 'nequi',
});

const options = {
  hostname: 'shelbysebastian-1.onrender.com',
  path: '/api/functions/create-mp-preference',
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(data),
  },
};

const req = https.request(options, (res) => {
  console.log('STATUS', res.statusCode);
  console.log('HEADERS', JSON.stringify(res.headers, null, 2));
  let body = '';
  res.on('data', (chunk) => (body += chunk));
  res.on('end', () => {
    console.log('BODY', body);
  });
});

req.on('error', (err) => {
  console.error('ERR', err.message);
});

req.write(data);
req.end();
