import('dotenv/config');

const baseUrl = 'http://localhost:3001';
const endpoint = '/api/payments/create-wompi-payment';
const url = `${baseUrl}${endpoint}`;

const body = {
  products: [
    { id: 'test-product', name: 'Producto de prueba', quantity: 1, unit_price: 10000 },
  ],
  total: 10000,
  customerEmail: 'test+nequi@example.com',
  reference: `NEQUI-TEST-${Date.now()}`,
  paymentMethod: 'nequi',
  redirectUrl: 'http://localhost:5173/payment-processing?order=NEQUI-TEST',
  customerName: 'Prueba Nequi',
  customerPhone: '3001234567',
};

(async () => {
  console.log('Calling Wompi endpoint', { url, body });
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const text = await response.text();
  console.log('HTTP status', response.status, response.statusText);
  try {
    const data = text ? JSON.parse(text) : null;
    console.log('Response JSON', JSON.stringify(data, null, 2));
  } catch (err) {
    console.log('Response text', text);
  }
})();
