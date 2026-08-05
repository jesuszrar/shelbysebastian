const base = 'http://localhost:3001';
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const dump = (name, result) => {
  console.log(`\n=== ${name} ===`);
  console.log('ok:', result.ok, 'status:', result.status);
  console.log(JSON.stringify(result.data, null, 2));
};
const fetchJson = async (url, opts = {}) => {
  const response = await fetch(url, opts);
  const text = await response.text();
  let data;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  return { ok: response.ok, status: response.status, data };
};
const rnd = Math.floor(Date.now() / 1000);
const email = `test+${rnd}@example.com`;
const cedula = `9${Math.floor(100000000 + Math.random() * 899999999)}`;
const password = 'P4ssword!123';
const name = 'Test User';
console.log('base url:', base);
let result;
result = await fetchJson(`${base}/health`);
dump('/health', result);
result = await fetchJson(`${base}/api/auth/register`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ email, password, data: { name, cedula } }),
});
dump('/api/auth/register', result);
if (!result.ok) process.exit(1);
const session = result.data?.session;
const userId = session?.user?.id;
const token = session?.access_token;
if (!token || !userId) {
  console.error('register did not return a valid session or user id');
  process.exit(1);
}
result = await fetchJson(`${base}/api/auth/login`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ email, password }),
});
dump('/api/auth/login', result);
const authHeader = { Authorization: `Bearer ${token}` };
result = await fetchJson(`${base}/api/profile`, { method: 'GET', headers: authHeader });
dump('/api/profile', result);
result = await fetchJson(`${base}/api/auth/refresh`, { method: 'POST', headers: authHeader });
dump('/api/auth/refresh', result);
const product = { id: `prod-${rnd}`, name: 'Test Product', category: 'Adhesivas', price: '12000', stock: 10, image: '', description: 'desc', specs: [] };
result = await fetchJson(`${base}/api/data/products`, {
  method: 'POST',
  headers: { ...authHeader, 'Content-Type': 'application/json' },
  body: JSON.stringify(product),
});
dump('POST /api/data/products', result);
const prodId = result.data?.[0]?.id ?? product.id;
result = await fetchJson(`${base}/api/data/products?filters=${encodeURIComponent(JSON.stringify([{ column: 'id', value: prodId }]))}`, { method: 'GET', headers: authHeader });
dump('GET product by id', result);
result = await fetchJson(`${base}/api/data/products?filters=${encodeURIComponent(JSON.stringify([{ column: 'id', value: prodId }]))}`, {
  method: 'PATCH',
  headers: { ...authHeader, 'Content-Type': 'application/json' },
  body: JSON.stringify({ price: '15000' }),
});
dump('PATCH product', result);
result = await fetchJson(`${base}/api/data/products?filters=${encodeURIComponent(JSON.stringify([{ column: 'id', value: prodId }]))}`, { method: 'DELETE', headers: authHeader });
dump('DELETE product', result);
const couponCode = `TESTCOUPON${rnd}`;
const coupon = { code: couponCode, type: 'fixed', value: '1500', active: true, minimumSubtotal: '5000', expiresAt: new Date(Date.now() + 3600 * 1000).toISOString() };

// Elevate current user to admin via profile patch if available
result = await fetchJson(`${base}/api/data/profiles?filters=${encodeURIComponent(JSON.stringify([{ column: 'id', value: userId }]))}`, {
  method: 'PATCH',
  headers: { ...authHeader, 'Content-Type': 'application/json' },
  body: JSON.stringify({ is_admin: true }),
});
dump('PATCH profile to admin', result);

result = await fetchJson(`${base}/api/data/coupons`, {
  method: 'POST',
  headers: { ...authHeader, 'Content-Type': 'application/json' },
  body: JSON.stringify(coupon),
});
dump('POST coupon', result);
result = await fetchJson(`${base}/api/data/coupons?filters=${encodeURIComponent(JSON.stringify([{ column: 'code', value: couponCode }]))}`, { method: 'GET', headers: authHeader });
dump('GET coupon', result);
result = await fetchJson(`${base}/api/data/coupons?filters=${encodeURIComponent(JSON.stringify([{ column: 'code', value: couponCode }]))}`, {
  method: 'PATCH',
  headers: { ...authHeader, 'Content-Type': 'application/json' },
  body: JSON.stringify({ active: false }),
});
dump('PATCH coupon', result);
result = await fetchJson(`${base}/api/data/coupons?filters=${encodeURIComponent(JSON.stringify([{ column: 'code', value: couponCode }]))}`, { method: 'DELETE', headers: authHeader });
dump('DELETE coupon', result);
result = await fetchJson(`${base}/api/functions/redeem-coupon`, {
  method: 'POST',
  headers: { ...authHeader, 'Content-Type': 'application/json' },
  body: JSON.stringify({ code: couponCode, subtotal: 10000, shipping: 0 }),
});
dump('/api/functions/redeem-coupon', result);
const orderId = `order-${rnd}`;
const order = { id: orderId, items: [{ id: 'prod-1', name: 'Sample', quantity: 1, unit_price: 10000 }], total: 10000, shipping: 0, status: 'pending', paymentMethod: 'card', customerName: 'Test', customerEmail: email, customerPhone: '3001234567', customerCity: 'Bogota', customerAddress: 'Calle 1', notes: '', userId };
result = await fetchJson(`${base}/api/data/orders`, {
  method: 'POST',
  headers: { ...authHeader, 'Content-Type': 'application/json' },
  body: JSON.stringify(order),
});
dump('POST order', result);
result = await fetchJson(`${base}/api/data/orders?filters=${encodeURIComponent(JSON.stringify([{ column: 'id', value: orderId }]))}`, {
  method: 'PATCH',
  headers: { ...authHeader, 'Content-Type': 'application/json' },
  body: JSON.stringify({ status: 'payment_approved' }),
});
dump('PATCH order', result);
result = await fetchJson(`${base}/api/data/orders?filters=${encodeURIComponent(JSON.stringify([{ column: 'id', value: orderId }]))}`, { method: 'DELETE', headers: authHeader });
dump('DELETE order', result);
result = await fetchJson(`${base}/api/payments/create-wompi-payment`, {
  method: 'POST',
  headers: { ...authHeader, 'Content-Type': 'application/json' },
  body: JSON.stringify({ products: order.items, total: order.total, customerEmail: order.customerEmail, reference: orderId, paymentMethod: 'card', redirectUrl: 'https://localhost/success' }),
});
dump('create wompi payment', result);
if (result.ok && result.data?.transactionId) {
  const tx = result.data.transactionId;
  const statusRes = await fetchJson(`${base}/api/payments/transaction-status?transactionId=${encodeURIComponent(tx)}`, { method: 'GET', headers: authHeader });
  dump('transaction status', statusRes);
}
console.log('\nEND TESTS');
